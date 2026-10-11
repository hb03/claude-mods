import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Ausstehend, Punkt, Warnung } from '../types'
import {
  AUFTRAG, WARTEZEIT, ZUSAMMENFASSUNG, abgleichen, abschliessen, ablageLesen, alteVerlaeufe, antwortIn, ausfuehrBitte, ablageText, anfrage,
  auswerten as auswertenNoetig, ausnahmeErgaenzen, ausstehende, befehlLabel, befehle, brauchtErgaenzung, datum, fragbar, fremd, istVeraltet,
  kommando, lies, mitCompact, monatsKopf, nummerieren, offene, ordnerName, ruhe, sammelText, statuszeile, stempeln, tagAnhaengen,
  ruht, ruheVermerk, uebernehmen, verlaufKopf, verlaufsEintraege, vermerk, zuZeigen, zuruecknehmen, zusammenfuehren,
} from './logik'
import type { Ruhezeit, Sicht, Teil } from './logik'

// Offene Punkte der Sitzung: nach jeder Antwort liest ein kleines Modell
// (Haiku), was noch eine Entscheidung, Freigabe oder Zuarbeit des Nutzers
// braucht, und stellt es als Frage mit Antwortmoeglichkeiten ueber die
// Eingabe - immer auch mit einer eigenen Antwort. Aufgaben bringen ihre
// Anleitung mit (Befehle, Pfade), dazu fuehrt Haiku einen kurzen Ueberblick.
// Die Liste liegt je Projekt in offene-punkte/offen.md und geht so in die
// naechste Sitzung; was entschieden wurde, landet mit Gruenden in
// offene-punkte/antworten-JJJJ-MM-TT.md. /offen zeigt alles,
// /zusammenfassung laesst das Hauptmodell die ganze Sitzung zusammenfassen.

const PANE = 'offene-punkte'
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const prueftA = atom({ plugin: 'offene-punkte', key: 'prueft' } as const, false)
const ausgeblendetA = atom({ plugin: 'offene-punkte', key: 'ausgeblendet' } as const, false)
const ueberblickA = atom({ plugin: 'offene-punkte', key: 'ueberblick' } as const, '')
const eigeneA = atom({ plugin: 'offene-punkte', key: 'eigene' } as const, '')
const spaeterA = atom({ plugin: 'offene-punkte', key: 'spaeter' } as const, '')
const warnungenAusA = atom({ plugin: 'offene-punkte', key: 'warnungenAus' } as const, [])
// Gehoert kontext-anzeige (ab 0.4.0) und wird hier nur gelesen; ohne den Mod bleibt es leer.
const warnungenA = atom({ plugin: 'kontext-anzeige', key: 'warnungen' } as const, [] as Warnung[])

// Feste Wahlmoeglichkeiten unter jeder Frage.
// Steht vorgewaehlt in der Auswahl, damit dort nicht "none" erscheint; waehlt nichts.
const KEINE = '__keine'
const EIGENE = '__eigene'
const SPAETER = '__spaeter'
const ANS_ENDE = '__ende'
const RUHE = '__ruhe:'
const ERLEDIGT = '__erledigt'
const VERWERFEN = '__verwerfen'
const AKTUELL = '__aktuell'
const BEFEHL = '__befehl:'

const ERKANNT = 'laut Gespräch erledigt'

// Einstellungen, von register gesetzt.
let modell = 'haiku'
let mindestLaenge = 400
let fragenAnzeigen = true
// Die letzte Nachricht des Nutzers - sagt Haiku, was er gerade schon beantwortet hat.
let letzteEingabe = ''
// Laeuft schon eine Auswertung, sammeln sich die naechsten Antworten hier (nie zwei Auswertungen gleichzeitig).
let warteschlange: string[] = []
let wartendeEingabe = ''
let laeuft = false
// Gewaehlte Antworten stehen als "ausstehend" am Punkt (im State, uebersteht ein Neuladen) und
// gehen gesammelt an Claude: wenn keine aktuelle Frage mehr offen ist oder WARTEZEIT nach der
// letzten Wahl. Erst dann schliesst sich der Punkt. Spaeter, Schon erledigt und Nicht relevant
// brauchen keine Nachricht und wirken sofort.
let zeitgeber: Timer | null = null
// Gerade abgeschickt, Antwort der Engine steht noch aus: nicht ein zweites Mal senden.
const unterwegs = new Set<string>()
// Wo die Dateien liegen; einmal je Sitzung ermittelt.
let ort: Promise<{ ordner: string } | null> | null = null
// Die eigene Sitzung: Punkte anderer Sitzungen im selben Projekt werden nicht gefragt.
let sitzung = ''

async function sicht($: EngineInterface): Promise<Sicht> {
  return { sitzung, jetzt: await $.clock.now() }
}

async function zeigeStatus($: EngineInterface) {
  const [punkte, prueft, s] = await Promise.all([read($, punkteA), read($, prueftA), sicht($)])
  $.ui.status(statuszeile(punkte, prueft, s))
}

// ---------------------------------------------------------------- Dateien

/**
 * Im Git-Repo: <projekt>/offene-punkte/, lokal ausgenommen ueber .git/info/exclude
 * (die .gitignore des Projekts bleibt unberuehrt). Sonst ~/.claude/offene-punkte/<projekt>/.
 */
async function ermittleOrt($: EngineInterface): Promise<{ ordner: string } | null> {
  const wurzel = (await $.session.root()).replace(/[\\/]+$/, '')
  const git = await $.fs.stat(`${wurzel}/.git`).catch(() => undefined)
  if (git?.kind === 'dir') {
    const datei = `${wurzel}/.git/info/exclude`
    const alt = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    const neu = ausnahmeErgaenzen(alt)
    if (neu !== null) await $.fs.write(datei, neu)
    return { ordner: `${wurzel}/offene-punkte` }
  }
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (home === undefined) return null
  return { ordner: `${home.replace(/[\\/]+$/, '')}/.claude/offene-punkte/${ordnerName(wurzel)}` }
}

function ablageOrt($: EngineInterface) {
  ort ??= ermittleOrt($).catch(fehler => {
    $.ui.log(`offene-punkte: kein Ablageort (${String(fehler)})`)
    return null
  })
  return ort
}

/**
 * Schreibt offen.md. Vorher wird eingelesen, was dort steht: eine andere Sitzung im selben
 * Projekt kann inzwischen Punkte angelegt oder geschlossen haben (abgleich: false beim Leeren).
 */
async function speichern($: EngineInterface, abgleich = true) {
  const o = await ablageOrt($)
  if (o === null) return
  const datei = `${o.ordner}/offen.md`
  if (abgleich) {
    const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    const dort = text === '' ? null : ablageLesen(text)
    if (dort !== null) await update($, punkteA, alt => abgleichen(alt, dort.punkte))
  }
  const [punkte, ueberblick, jetzt] = await Promise.all([read($, punkteA), read($, ueberblickA), $.clock.now()])
  await $.fs.write(datei, ablageText({ punkte, ueberblick }, jetzt))
    .catch(fehler => $.ui.log(`offene-punkte: offen.md nicht geschrieben (${String(fehler)})`))
}

async function insVerlauf($: EngineInterface, eintraege: string[], jetzt: number) {
  const o = await ablageOrt($)
  if (o === null || eintraege.length === 0) return
  const datei = `${o.ordner}/antworten-${datum(jetzt)}.md`
  const alt = await $.fs.read(datei).then(t => String(t)).catch(() => verlaufKopf(jetzt))
  await $.fs.write(datei, `${alt}\n${eintraege.join('\n')}`)
    .catch(fehler => $.ui.log(`offene-punkte: Verlauf nicht geschrieben (${String(fehler)})`))
}

/** Liste aendern; was dabei geschlossen oder wieder geoeffnet wird, geht in den Verlauf. Alles landet in der Datei. */
async function aendere($: EngineInterface, fn: (liste: Punkt[]) => Punkt[]): Promise<Punkt[]> {
  const vorher = await read($, punkteA)
  const jetzt = await $.clock.now()
  await update($, punkteA, alt => stempeln(alt, fn(alt), jetzt))
  const nachher = await read($, punkteA)
  const alt = new Map(vorher.map(p => [p.id, p]))
  await insVerlauf($, verlaufsEintraege(vorher, nachher, jetzt), jetzt)
  await speichern($)
  await zeigeStatus($)
  // Was gerade geschlossen wurde, damit der Aufrufer davon erzaehlen kann.
  return nachher.filter(p => p.status !== 'offen' && alt.get(p.id)?.status === 'offen')
}

/** Zu Beginn einer Sitzung (oder nach /clear) die Punkte aus der Datei uebernehmen. */
async function laden($: EngineInterface) {
  const [punkte, ueberblick] = await Promise.all([read($, punkteA), read($, ueberblickA)])
  if (punkte.length > 0 || ueberblick !== '') return
  const o = await ablageOrt($)
  if (o === null) return
  const text = await $.fs.read(`${o.ordner}/offen.md`).then(t => String(t)).catch(() => '')
  const a = text === '' ? null : ablageLesen(text)
  if (a === null) return
  // Was die letzte Sitzung offen liess, fuehrt jetzt diese.
  await update($, punkteA, () => uebernehmen(a.punkte, sitzung))
  await update($, ueberblickA, () => a.ueberblick)
  await zeigeStatus($)
  const n = fragbar(await read($, punkteA), await sicht($)).length
  if (n > 0) $.ui.toast(n === 1 ? '1 offener Punkt aus der letzten Sitzung übernommen · /offen' : `${n} offene Punkte aus der letzten Sitzung übernommen · /offen`)
}

/** Tagesverlaeufe, die aelter als 30 Tage sind, kommen in die Monatsdatei antworten-JJJJ-MM.md. */
async function verlaufAufraeumen($: EngineInterface) {
  const o = await ablageOrt($)
  if (o === null) return
  const namen = await $.fs.list(o.ordner).then(l => l.filter(x => x.kind === 'file').map(x => x.name)).catch((): string[] => [])
  const monate = alteVerlaeufe(namen, await $.clock.now())
  if (monate.size === 0) return
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  for (const [monat, tage] of monate) {
    const ziel = `${o.ordner}/antworten-${monat}.md`
    let inhalt = await $.fs.read(ziel).then(t => String(t)).catch(() => monatsKopf(monat))
    for (const tag of tage) {
      const text = await $.fs.read(`${o.ordner}/antworten-${tag}.md`).then(t => String(t)).catch(() => null)
      if (text !== null) inhalt = tagAnhaengen(inhalt, tag, text) ?? inhalt
    }
    await $.fs.write(ziel, inhalt)
    // Erst wenn die Monatsdatei steht; ein Tag, der dort schon steht, kommt nicht doppelt hinein.
    for (const tag of tage) {
      const datei = `${o.ordner}/antworten-${tag}.md`
      await $.process.run(windows ? ['cmd', '/c', 'del', '/q', datei.replace(/\//g, '\\')] : ['rm', '-f', datei])
        .catch(fehler => $.ui.log(`offene-punkte: ${datei} nicht entfernt (${String(fehler)})`))
    }
  }
}

// ---------------------------------------------------------------- Auswertung

/** Eine Antwort von Haiku auswerten lassen und das Ergebnis in die Liste nehmen. */
async function auswerten($: EngineInterface, antworten: string[], eingabe: string) {
  if (laeuft) {
    warteschlange.push(...antworten)
    wartendeEingabe = eingabe
    return
  }
  laeuft = true
  await update($, prueftA, () => true)
  await zeigeStatus($)
  try {
    const vorher = offene(await read($, punkteA))
    const r = await $.model.complete({
      model: modell,
      system: [{ text: AUFTRAG, cache: true }],
      prompt: anfrage(antworten, eingabe, vorher, await read($, ueberblickA)),
      maxTokens: 3000,
      timeoutMs: 45_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`offene-punkte: keine Auswertung (${r.reason})`)
      return
    }
    const a = lies(r.text)
    if (a === null) {
      $.ui.log('offene-punkte: Antwort des Modells war kein lesbares JSON')
      return
    }
    const jetzt = await $.clock.now()
    let zaehler = 0
    // Eindeutig, auch wenn zwei Auswertungen in dieselbe Millisekunde fallen.
    const vergeben = new Set((await read($, punkteA)).map(p => p.id))
    const neueId = () => {
      let id: string
      do id = `p${jetzt.toString(36)}${(zaehler++).toString(36)}`
      while (vergeben.has(id))
      vergeben.add(id)
      return id
    }
    if (a.ueberblick !== '') await update($, ueberblickA, () => a.ueberblick)
    const geschlossen = await aendere($, alt => zusammenfuehren(alt, a, jetzt, neueId))

    const bekannt = new Set(vorher.map(p => p.id))
    const neu = offene(await read($, punkteA)).filter(p => !bekannt.has(p.id)).length
    const meldungen = [
      neu === 1 ? '1 neuer offener Punkt' : neu > 1 ? `${neu} neue offene Punkte` : '',
      ...geschlossen.filter(p => p.ergebnis === ERKANNT).map(p => `„${p.titel}“ als erledigt erkannt`),
    ].filter(t => t !== '')
    if (meldungen.length > 0) {
      const zusatz = geschlossen.length > 0 ? ' · /offen zum Wiederöffnen' : ' – Frage über der Eingabe'
      $.ui.toast(meldungen.join(' · ') + zusatz, { timeoutMs: 6000 })
    }
  } finally {
    laeuft = false
    await update($, prueftA, () => false)
    await zeigeStatus($)
    const weiter = warteschlange
    warteschlange = []
    if (weiter.length > 0) await auswerten($, weiter, wartendeEingabe)
  }
}

// ---------------------------------------------------------------- Wahl

async function setzeStatus($: EngineInterface, id: string, status: Punkt['status'], ergebnis: string) {
  await aendere($, liste => liste.map(p => (p.id === id ? { ...p, status, ergebnis } : p)))
}

async function wiederOeffnen($: EngineInterface, id: string) {
  // Die alte Nummer kann inzwischen vergeben sein: bekommt eine neue.
  await aendere($, liste => nummerieren(liste.map(p => {
    if (p.id !== id) return p
    const { ergebnis: _e, nr: _n, ruht: _r, ...rest } = p
    return { ...rest, status: 'offen' as const, ohneBezug: 0, zurueckgestellt: 0, sitzung }
  })))
}

/** Ruht ein Punkt, wird er gleich wieder gefragt. */
async function aufnehmen($: EngineInterface, id: string) {
  await aendere($, liste => liste.map(p => {
    if (p.id !== id) return p
    const { ruht: _r, ...rest } = p
    return rest
  }))
}

const teileVon = (punkte: readonly Punkt[]): Teil[] => punkte.map(p => ({ titel: p.titel, text: p.ausstehend?.text ?? '' }))

const naechsteReihe = (liste: readonly Punkt[]) => Math.max(0, ...liste.map(p => p.ausstehend?.reihe ?? 0)) + 1

/** Was gesammelt auf das Senden wartet. */
const gesammelt = (punkte: readonly Punkt[]) => ausstehende(punkte, 'sammlung').filter(p => !unterwegs.has(p.id))

/** Eine Antwort, wie sie gewaehlt wurde: Status beim Schliessen, Label fuers Ergebnis, Text fuer Claude. */
type Wahl = { status: Ausstehend['status']; label: string; text: string }

const ergebnis = (w: Wahl, text: string) => (text !== '' ? `${w.label} – „${text}“` : w.label)

/** Das Gesammelte als eine Nachricht an Claude; die Punkte schliessen sich, sobald sie angekommen ist. */
async function senden($: EngineInterface) {
  zeitgeber?.cancel()
  zeitgeber = null
  const liste = gesammelt(await read($, punkteA))
  if (liste.length === 0) return
  const ids = new Set(liste.map(p => p.id))
  for (const id of ids) unterwegs.add(id)
  const text = sammelText(teileVon(liste))
  // Haiku soll bei der naechsten Auswertung wissen, was der Nutzer gerade beantwortet hat.
  letzteEingabe = text
  // Als eigene Nachricht des Nutzers; laeuft gerade eine Antwort, kommt sie danach. Ausserhalb
  // des aufrufenden Hooks: aus /offen (command.run) heraus lehnt die Engine ein submit ab.
  $.clock.after(0, () => {
    void $.prompt.submit({ text, asUser: true })
      .then(r => aendere($, l => ('drop' in r && r.drop !== undefined ? zuruecknehmen(l, ids) : abschliessen(l, ids))))
      .catch(async fehler => {
        $.ui.log(`offene-punkte: nicht gesendet (${String(fehler)})`)
        await aendere($, l => zuruecknehmen(l, ids))
      })
      .finally(() => {
        for (const id of ids) unterwegs.delete(id)
      })
  })
}

/**
 * Nach einer Wahl: ist keine aktuelle Frage mehr offen (zurueckgestellte und veraltete zaehlen
 * nicht), geht das Gesammelte los, sonst WARTEZEIT nach dieser Wahl.
 */
async function weiter($: EngineInterface) {
  const punkte = await read($, punkteA)
  if (gesammelt(punkte).length === 0) return
  const rest = fragbar(punkte, await sicht($)).filter(p => !istVeraltet(p) && p.zurueckgestellt === 0)
  if (rest.length === 0) return senden($)
  zeitgeber?.cancel()
  zeitgeber = $.clock.after(WARTEZEIT, () => {
    void senden($).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
  })
}

/** Text in die Eingabe: eine leere bekommt ihn ganz, an Angefangenes kommt er in einer neuen Zeile. */
async function eintragen($: EngineInterface, text: string) {
  const box = await $.prompt.read()
  if (box.text.trim() === '') await $.prompt.fill({ text, mode: 'replace' })
  else await $.prompt.fill({ text: `${box.text.endsWith('\n') ? '' : '\n'}${text}`, mode: 'append' })
}

/**
 * Antwort in die Eingabe statt abschicken: der Nutzer ergaenzt und schickt selbst ab. Was
 * gesammelt wartet, kommt mit; der Punkt schliesst sich mit der Nachricht.
 */
async function inEingabe($: EngineInterface, punkt: Punkt, w: Wahl) {
  zeitgeber?.cancel()
  zeitgeber = null
  const mit = gesammelt(await read($, punkteA))
  const ids = new Set(mit.map(p => p.id))
  await aendere($, liste => {
    const reihe = naechsteReihe(liste)
    return liste.map(p => {
      if (p.id === punkt.id) return { ...p, ausstehend: { status: w.status, ergebnis: w.label, text: w.text, wo: 'eingabe' as const, reihe } }
      if (ids.has(p.id) && p.ausstehend !== undefined) return { ...p, ausstehend: { ...p.ausstehend, wo: 'eingabe' as const } }
      return p
    })
  })
  await eintragen($, sammelText([...teileVon(mit), { titel: punkt.titel, text: w.text }]).trimEnd() + ' ')
}

/** Eine fertige Antwort: gesammelt - oder in die Eingabe, wenn dort schon Antworten auf das Abschicken warten. */
async function antworten($: EngineInterface, punkt: Punkt, w: Wahl) {
  if (ausstehende(await read($, punkteA), 'eingabe').length > 0) return inEingabe($, punkt, w)
  await aendere($, liste => {
    const reihe = naechsteReihe(liste)
    return liste.map(p => (p.id === punkt.id
      ? { ...p, ausstehend: { status: w.status, ergebnis: ergebnis(w, w.text), text: w.text, wo: 'sammlung' as const, reihe } }
      : p))
  })
  await weiter($)
}

/** Die eigene Antwort aus dem Textfeld. */
async function eigeneAntwort($: EngineInterface, punkt: Punkt, text: string) {
  await update($, eigeneA, () => '')
  const t = text.trim()
  if (t === '') return
  await antworten($, punkt, { status: 'erledigt', label: 'eigene Antwort', text: t })
}

/** Eine Wahl in der Frage eines Punkts ausfuehren. */
async function waehlen($: EngineInterface, punkt: Punkt, wert: string, mitTextfeld: boolean) {
  if (wert === EIGENE) {
    if (mitTextfeld) {
      await update($, eigeneA, () => punkt.id)
      return
    }
    // Kein Textfeld (Handy): in der Eingabe vorbereiten; beim Abschicken schliesst sich der Punkt.
    return inEingabe($, punkt, { status: 'erledigt', label: 'eigene Antwort', text: '' })
  }
  if (wert.startsWith(BEFEHL)) {
    // Nur vorbereitet: der Nutzer sieht die Bitte und schickt sie selbst ab; Claude fuehrt aus. Der Punkt bleibt offen.
    const befehl = befehle(punkt.anleitung)[Number(wert.slice(BEFEHL.length))]
    if (befehl !== undefined) await eintragen($, ausfuehrBitte(punkt.titel, befehl))
    return
  }
  if (wert === SPAETER) {
    // Erst fragen, wie lange: darunter stehen die Zeiten.
    await update($, spaeterA, () => punkt.id)
    return
  }
  if (wert === ANS_ENDE) {
    await update($, spaeterA, () => '')
    await aendere($, liste => liste.map(p => (p.id === punkt.id ? { ...p, zurueckgestellt: p.zurueckgestellt + 1 } : p)))
    return weiter($)
  }
  if (wert.startsWith(RUHE)) {
    await update($, spaeterA, () => '')
    const r = ruhe(wert.slice(RUHE.length) as Ruhezeit, await sicht($))
    await aendere($, liste => liste.map(p => (p.id === punkt.id ? { ...p, ruht: r } : p)))
    return weiter($)
  }
  if (wert === AKTUELL) {
    await aendere($, liste => liste.map(p => (p.id === punkt.id ? { ...p, ohneBezug: 0 } : p)))
    return
  }
  if (wert === ERLEDIGT || wert === VERWERFEN) {
    await (wert === ERLEDIGT
      ? setzeStatus($, punkt.id, 'erledigt', 'als erledigt markiert')
      : setzeStatus($, punkt.id, 'verworfen', 'nicht relevant'))
    return weiter($)
  }

  const option = punkt.optionen[Number(wert)]
  if (option === undefined) return
  if (option.antwort === '') {
    // Nichts fuer Claude: gleich schliessen.
    await setzeStatus($, punkt.id, 'erledigt', option.label)
    return weiter($)
  }
  const w: Wahl = { status: 'erledigt', label: option.label, text: option.antwort }
  // Braucht noch eigenen Text: in die Eingabe, ergaenzen und selbst abschicken.
  if (brauchtErgaenzung(option.antwort)) return inEingabe($, punkt, w)
  await antworten($, punkt, w)
}

function auswahl(punkt: Punkt) {
  return [
    ...punkt.optionen.map((o, i) => ({ value: String(i), label: o.label })),
    { value: EIGENE, label: 'Eigene Antwort …' },
    ...befehle(punkt.anleitung).map((b, i) => ({ value: `${BEFEHL}${i}`, label: befehlLabel(b) })),
    ...(istVeraltet(punkt) ? [{ value: AKTUELL, label: 'Noch aktuell' }] : []),
    { value: SPAETER, label: 'Später' },
    { value: ERLEDIGT, label: 'Schon erledigt' },
    { value: VERWERFEN, label: 'Nicht relevant' },
  ]
}

type Els = ReturnType<EngineInterface['ui']['resolve']>

/**
 * Die Wahl zu einem Punkt: eine Auswahlliste, wo die Oberflaeche eine hat,
 * sonst (Handy) ein Knopf je Antwort - dort ohnehin das Bessere zum Antippen.
 * Ist "Eigene Antwort" gewaehlt, steht darunter ein Textfeld.
 */
const ZEITEN: { wert: string; label: string }[] = [
  { wert: ANS_ENDE, label: 'Ans Ende' },
  { wert: `${RUHE}sitzung`, label: 'Nächste Sitzung' },
  { wert: `${RUHE}morgen`, label: 'Morgen' },
  { wert: `${RUHE}drei`, label: 'In 3 Tagen' },
  { wert: `${RUHE}woche`, label: 'Nächste Woche' },
]

function wahl($: EngineInterface, els: Els, surface: string, key: string, punkt: Punkt, eigene: string, spaeter: string) {
  const optionen = auswahl(punkt)
  const mitTextfeld = surface !== 'mobile' && 'Input' in els
  const { Box, Button, Text } = els
  if (spaeter === punkt.id) {
    return (
      <Box key={`${key}-spaeter`} flexDirection="row" flexWrap="wrap">
        <Text>Später: </Text>
        {ZEITEN.map(z => (
          <Button key={`${key}-${z.wert}`} label={z.label} onPress={() => void waehlen($, punkt, z.wert, false)} />
        ))}
        <Button key={`${key}-zurueck`} label="Zurück" onPress={() => void update($, spaeterA, () => '')} />
      </Box>
    )
  }
  const liste = surface !== 'mobile' && 'Select' in els
    ? (
      <els.Select
        key={key}
        label="Antwort"
        options={[{ value: KEINE, label: 'bitte wählen' }, ...optionen]}
        value={KEINE}
        onSelect={(wert: string) => void (wert === KEINE ? undefined : waehlen($, punkt, wert, mitTextfeld))}
      />
    )
    : (
      <Box key={key} flexDirection="row" flexWrap="wrap">
        {optionen.map(o => (
          <Button key={`${key}-${o.value}`} label={o.label ?? o.value} onPress={() => void waehlen($, punkt, o.value, false)} />
        ))}
      </Box>
    )
  if (!(mitTextfeld && 'Input' in els) || eigene !== punkt.id) return liste

  return (
    <Box key={`${key}-eigene`} flexDirection="column">
      <els.Input
        key={`${key}-text`}
        label="Deine Antwort: "
        placeholder="eigene Antwort, Enter schickt ab"
        submitLabel="senden"
        autoFocus
        onSubmit={(text: string) => void eigeneAntwort($, punkt, text)}
      />
      <Box key={`${key}-zurueck`} flexDirection="row">
        <Text dimColor>Esc: zurück zur Eingabe · </Text>
        <Button key={`${key}-abbrechen`} label="Abbrechen" onPress={() => void update($, eigeneA, () => '')} />
      </Box>
    </Box>
  )
}

const kopf = (p: Punkt) =>
  p.stufe === 'blockiert'
    ? { zeichen: '■ Blockiert', farbe: 'red' }
    : p.stufe === 'angebot'
      ? { zeichen: '◇ Angebot', farbe: 'gray' }
      : { zeichen: p.art === 'aufgabe' ? '◆ Zu tun' : '◆ Offen', farbe: 'yellow' }

const optionenText = (p: Punkt) =>
  p.optionen.map((o, i) => `${String.fromCharCode(97 + i)}) ${o.label}`).join(' · ')

/** /offen mit Nummer: einen Punkt erledigen, verwerfen, zurueckstellen oder eine Antwort waehlen. */
async function offenKommando($: EngineInterface, args: string): Promise<string | null> {
  const k = kommando(args)
  if (k.art === 'liste') return null
  if (k.art === 'fehler') return k.text
  if (k.art === 'senden') {
    const n = gesammelt(await read($, punkteA)).length
    await senden($)
    return n > 0 ? 'Gesammelte Antworten gesendet.' : 'Es wartet nichts.'
  }
  if (k.art === 'leeren') {
    zeitgeber?.cancel()
    zeitgeber = null
    await update($, punkteA, () => [])
    await update($, ueberblickA, () => '')
    await speichern($, false)
    await zeigeStatus($)
    return 'Liste der offenen Punkte geleert.'
  }
  const alle = await read($, punkteA)
  const punkt = offene(alle).find(p => p.nr === k.nummer)
  if (punkt === undefined) {
    const beantwortet = ausstehende(alle).find(p => p.nr === k.nummer)
    return beantwortet !== undefined
      ? `„${beantwortet.titel}“ ist schon beantwortet und geht mit den übrigen Antworten an Claude.`
      : `Punkt ${k.nummer} gibt es nicht – /offen zeigt die Nummern.`
  }
  if (k.tun === 'option') {
    const o = punkt.optionen[k.option ?? -1]
    if (o === undefined) return `„${punkt.titel}“ hat keine Antwort ${String.fromCharCode(97 + (k.option ?? 0))}) – ${optionenText(punkt)}`
    await waehlen($, punkt, String(k.option), false)
    const wartet = gesammelt(await read($, punkteA)).length
    return `„${punkt.titel}“: ${o.label}${wartet > 0 ? ` – wartet auf die übrigen Fragen (höchstens 30 s, oder /offen senden)` : ''}`
  }
  const wert = { erledigt: ERLEDIGT, weg: VERWERFEN, spaeter: ANS_ENDE, aktuell: AKTUELL }[k.tun]
  await waehlen($, punkt, wert, false)
  const was = { erledigt: 'erledigt', weg: 'verworfen', spaeter: 'zurückgestellt', aktuell: 'bleibt offen' }[k.tun]
  return `„${punkt.titel}“: ${was}.`
}

export const register: Register = (on, options) => {
  modell = String(options.modell ?? 'haiku') || 'haiku'
  mindestLaenge = Number(options.mindestLaenge ?? 400)
  fragenAnzeigen = options.fragenAnzeigen !== false
  warteschlange = []
  laeuft = false
  ort = null
  zeitgeber = null
  unterwegs.clear()
  sitzung = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'offen',
      description: 'Zeigt, was noch offen ist; /offen 2 erledigt|weg|später, /offen 2 a wählt eine Antwort, /offen leeren räumt die Liste',
    })
    await $.command.register({
      name: 'zusammenfassung',
      description: 'Fasst die ganze Sitzung zusammen: Ziel, Erledigtes, was du noch tun musst (mit Befehlen), offene Entscheidungen',
    })
    await update($, prueftA, () => false)
    sitzung = await $.session.id().catch(() => '')
    await laden($).catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
    $.clock.after(0, () => {
      void verlaufAufraeumen($).catch(fehler => $.ui.log(`offene-punkte: Verlauf nicht aufgeräumt (${String(fehler)})`))
    })
    // Punkte aus 0.5.0 haben noch keine Nummer.
    await update($, punkteA, nummerieren)
    await zeigeStatus($)
    // Nach einem Neuladen des Plugins: was gesammelt wartete, wartet weiter (der Zeitgeber ist neu).
    await weiter($).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
    return next(e)
  })

  // Nach /clear startet keine neue Sitzung im Sinne von session.start: dort die Datei nachladen.
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason === 'clear') {
      ort = null
      zeitgeber?.cancel()
      zeitgeber = null
      // Antworten, die noch nicht bei Claude sind, gehoeren zur alten Unterhaltung: wieder fragen.
      $.clock.after(0, () => {
        void (async () => {
          // Neue Unterhaltung, neue Sitzungs-ID: die eigenen Punkte gehen mit.
          const alt = sitzung
          sitzung = await $.session.id().catch(() => alt)
          await aendere($, l => uebernehmen(zuruecknehmen(l), sitzung, alt))
          await laden($)
        })().catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
      })
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    // Nur was der Nutzer selbst schreibt - eine Antwort aus der Auswahl kennt Haiku schon.
    if (e.origin.kind !== 'composer') return next(e)
    const punkte = await read($, punkteA).catch((): Punkt[] => [])
    const mit = gesammelt(punkte)
    const eingabe = ausstehende(punkte, 'eingabe')
    // Gesammelte Antworten gehen mit dieser Nachricht, vor ihr - so kennt Claude sie zuerst.
    const text = mit.length > 0 ? `${sammelText(teileVon(mit))}\n\n${e.text}` : e.text
    letzteEingabe = text
    if (mit.length + eingabe.length === 0) return next(e)

    zeitgeber?.cancel()
    zeitgeber = null
    const ids = new Set(mit.map(p => p.id))
    const weg = new Set<string>()
    const ergebnisse = new Map<string, string>()
    // Antworten aus der Eingabe: was noch in der Nachricht steht, ist beantwortet; was der Nutzer
    // herausgenommen hat, wird wieder gefragt.
    for (const p of eingabe) {
      const t = antwortIn(e.text, p.titel)
      if (t === null) {
        weg.add(p.id)
        continue
      }
      ids.add(p.id)
      ergebnisse.set(p.id, t !== '' ? `${p.ausstehend?.ergebnis} – „${t}“` : String(p.ausstehend?.ergebnis))
    }
    const r = await next(text === e.text ? e : { ...e, text })
    const angekommen = !('drop' in r && r.drop !== undefined)
    // Nicht hier warten: das Schliessen schreibt Dateien.
    $.clock.after(0, () => {
      void aendere($, l => (angekommen ? zuruecknehmen(abschliessen(l, ids, ergebnisse), weg) : zuruecknehmen(l)))
        .catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
    })
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && auswertenNoetig(e.answer, mindestLaenge)) {
      const antwort = e.answer
      const eingabe = letzteEingabe
      // Ausserhalb dieses Hooks: die Auswertung soll das Ende der Antwort nicht aufhalten.
      $.clock.after(0, () => {
        void auswerten($, [antwort], eingabe).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    return r
  })

  on('command.run', { command: 'offen' }, async ($, e) => {
    const antwort = await offenKommando($, e.args)
    if (antwort !== null) return { text: antwort }

    await update($, ausgeblendetA, () => false)
    await $.ui.open({ id: PANE, title: 'Offene Punkte' })
    const liste = offene(await read($, punkteA))
    const ueberblick = await read($, ueberblickA)
    const s = await sicht($)
    const o = await ablageOrt($)
    const kopfzeile = ueberblick !== '' ? `Überblick:\n${ueberblick}\n\n` : ''
    const fuss = o !== null ? `\n\nDatei: ${o.ordner}/offen.md · Verlauf: antworten-JJJJ-MM-TT.md` : ''
    if (liste.length === 0) return { text: `${kopfzeile}Nichts offen.${fuss}` }
    const aktiv = liste.filter(p => !ruht(p, s))
    const ruhend = liste.filter(p => ruht(p, s))

    const aktivText = aktiv.length === 0 ? 'Gerade ist nichts dran.' : aktiv.map((p, i) => {
      const anleitung = (p.anleitung ?? '') !== '' ? `\n${p.anleitung.replace(/^/gm, '   ')}` : ''
      return `${p.nr ?? i + 1}. ${p.art === 'aufgabe' ? 'Zu tun: ' : ''}${p.titel}${vermerk(p, s)} – ${p.frage}${p.info !== '' ? `\n   ${p.info}` : ''}${anleitung}\n   ${optionenText(p)}`
    }).join('\n')
    // Zurueckgelegtes nur mit Titel und Termin, damit es nicht wie eine offene Frage aussieht.
    const ruhendText = ruhend.length === 0 ? '' : `\n\nZurückgelegt (${ruhend.length}):\n` + ruhend
      .map((p, i) => `${p.nr ?? i + 1}. ${p.titel} – ${ruheVermerk(p, s)}`).join('\n')
    return {
      text: kopfzeile + aktivText + ruhendText + `\n\n/offen <Nr> a|b|c|d wählt eine Antwort · /offen <Nr> erledigt|weg|später${fuss}`,
    }
  })

  // Die ganze Sitzung zusammenfassen: eine Frage an das Hauptmodell ueber den eigenen
  // Verlauf (aus dem Prompt-Cache), ohne Werkzeuge.
  on('command.run', { command: 'zusammenfassung' }, async $ => {
    const r = await $.model.fork({ prompt: ZUSAMMENFASSUNG })
    if (r.isAnswered) return { text: r.text }
    if (r.reason === 'nothing-to-fork') return { text: 'Noch nichts zusammenzufassen – die Sitzung hat noch keine Antwort.' }
    return { text: `Zusammenfassung nicht möglich (${r.reason}).` }
  })

  // Die naechste offene Frage ueber der Eingabe, darueber Warnungen von kontext-anzeige.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [alle, aus, warnungen, s] = await Promise.all([read($, punkteA), read($, warnungenAusA), read($, warnungenA), sicht($)])
    // Ausgeblendete Warnungen kommen wieder, sobald sie einmal verschwunden waren.
    const aktuell = new Set(warnungen.map(w => w.schluessel))
    if (aus.some(x => !aktuell.has(x))) $.clock.after(0, () => void update($, warnungenAusA, l => l.filter(x => aktuell.has(x))))
    const zeigen = zuZeigen(warnungen, aus)
    const fragen = fragenAnzeigen && !(await read($, ausgeblendetA))
    const liste = fragen ? fragbar(alle, s) : []
    const punkt = liste[0]
    if (punkt === undefined && zeigen.length === 0) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    const warnZeilen = zeigen.map(w => (
      <Box key={`warn-${w.schluessel}`} flexDirection="row" flexWrap="wrap">
        <Text color="red" wrap="wrap">⚠ {w.text} </Text>
        {mitCompact(w) && <Button key={`compact-${w.schluessel}`} label="/compact" onPress={() => void eintragen($, '/compact ')} />}
        <Text> </Text>
        <Button key={`aus-${w.schluessel}`} label="Ausblenden" onPress={() => void update($, warnungenAusA, l => [...l, w.schluessel])} />
      </Box>
    ))
    if (punkt === undefined) return <Box flexDirection="column" paddingX={1}>{warnZeilen}</Box>

    const k = kopf(punkt)
    const wartend = gesammelt(alle).length
    const [eigene, spaeter] = await Promise.all([read($, eigeneA), read($, spaeterA)])

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={k.farbe} paddingX={1}>
        {warnZeilen}
        <Text>
          <Text color={k.farbe} bold>{k.zeichen}</Text>
          <Text dimColor>{liste.length > 1 ? ` (1 von ${liste.length})` : ''}{istVeraltet(punkt) ? ' – noch aktuell?' : ''}: </Text>
          <Text bold>{punkt.titel}</Text>
        </Text>
        <Text wrap="wrap">{punkt.frage}</Text>
        {(punkt.anleitung ?? '') !== '' && <Markdown key={`anleitung-${punkt.id}`} text={punkt.anleitung} />}
        {wartend > 0 && (
          <Box key="wartend" flexDirection="row">
            <Text color="cyan">{wartend === 1 ? '1 Antwort wartet' : `${wartend} Antworten warten`} auf die übrigen Fragen (höchstens 30 s) </Text>
            <Button key="senden" label="Jetzt senden" onPress={() => void senden($)} />
          </Box>
        )}
        <Box flexDirection="row">
          {wahl($, els, e.surface, `wahl-${punkt.id}`, punkt, eigene, spaeter)}
          <Text> </Text>
          <Button key="alle" label="Alle zeigen" onPress={() => void $.ui.open({ id: PANE, title: 'Offene Punkte' })} />
          <Text> </Text>
          <Button key="ausblenden" label="Ausblenden" onPress={() => void update($, ausgeblendetA, () => true)} />
        </Box>
      </Box>
    )
  })

  // /offen: alles, was offen ist, und was zuletzt erledigt wurde.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    const [punkte, prueft, ueberblick, eigene, spaeter, s] = await Promise.all([
      read($, punkteA), read($, prueftA), read($, ueberblickA), read($, eigeneA), read($, spaeterA), sicht($),
    ])
    const liste = offene(punkte).filter(p => !ruht(p, s))
    const ruhend = offene(punkte).filter(p => ruht(p, s))
    const fertig = punkte.filter(p => p.status !== 'offen').slice(-8).reverse()

    return (
      <Box flexDirection="column">
        {ueberblick !== '' && (
          <Box key="ueberblick" flexDirection="column" marginBottom={1}>
            <Text bold>Überblick</Text>
            <Markdown key="ueberblick-text" text={ueberblick} />
          </Box>
        )}
        {prueft && <Text dimColor>prüft die letzte Antwort …</Text>}
        {liste.length === 0 && <Text dimColor>{ruhend.length > 0 ? 'Gerade ist nichts dran.' : 'Nichts offen.'}</Text>}
        {liste.map((p, i) => (
          <Box key={p.id} flexDirection="column" borderStyle="round" borderColor={kopf(p).farbe} borderDimColor={istVeraltet(p)} paddingX={1}>
            <Text>
              <Text color={kopf(p).farbe} bold>{p.nr ?? i + 1}. {p.art === 'aufgabe' ? 'Zu tun: ' : ''}</Text>
              <Text bold>{p.titel}</Text>
              <Text dimColor>{vermerk(p, s)}</Text>
            </Text>
            <Text wrap="wrap" dimColor={istVeraltet(p)}>{p.frage}</Text>
            {p.info !== '' && <Text dimColor wrap="wrap">{p.info}</Text>}
            {(p.anleitung ?? '') !== '' && <Markdown key={`anl-${p.id}`} text={p.anleitung} />}
            {fremd(p, s.sitzung)
              ? <Button key={`hier-${p.id}`} label="Hier übernehmen" onPress={() => void aendere($, l => l.map(x => (x.id === p.id ? { ...x, sitzung } : x)))} />
              : wahl($, els, e.surface, `liste-${p.id}`, p, eigene, spaeter)}
          </Box>
        ))}
        {ruhend.length > 0 && <Text key="ruhend-kopf" dimColor>— zurückgelegt ({ruhend.length}) —</Text>}
        {ruhend.map(p => (
          <Box key={`r-${p.id}`} flexDirection="row" flexWrap="wrap">
            <Text dimColor>⏸ {p.titel} · {ruheVermerk(p, s)}</Text>
            <Text> </Text>
            <Button key={`aufnehmen-${p.id}`} label="Jetzt aufnehmen" onPress={() => void aufnehmen($, p.id)} />
          </Box>
        ))}
        {fertig.length > 0 && <Text dimColor>— zuletzt erledigt —</Text>}
        {fertig.map(p => (
          <Box key={`f-${p.id}`} flexDirection="row">
            <Text dimColor strikethrough={p.status === 'verworfen'}>
              {p.status === 'verworfen' ? '✗' : '✓'} {p.titel}{p.ergebnis ? `: ${p.ergebnis}` : ''}
            </Text>
            <Text> </Text>
            <Button key={`auf-${p.id}`} label="Wieder öffnen" onPress={() => void wiederOeffnen($, p.id)} />
          </Box>
        ))}
      </Box>
    )
  })
}
