import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Punkt } from '../types'
import {
  AUFTRAG, ZUSAMMENFASSUNG, ablageLesen, ausfuehrBitte, ablageText, anfrage, auswerten as auswertenNoetig, ausnahmeErgaenzen,
  befehlLabel, befehle, brauchtErgaenzung, datum, istVeraltet, kommando, lies, offene, ordnerName, statuszeile,
  verlaufKopf, verlaufsEintraege, vermerk, zusammenfuehren,
} from './logik'

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

// Feste Wahlmoeglichkeiten unter jeder Frage.
// Steht vorgewaehlt in der Auswahl, damit dort nicht "none" erscheint; waehlt nichts.
const KEINE = '__keine'
const EIGENE = '__eigene'
const SPAETER = '__spaeter'
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
// Eigene Antwort, die (ohne Textfeld) in der Eingabe vorbereitet wurde: schliesst den Punkt beim Abschicken.
let vorbereitet: { id: string; anfang: string } | null = null
// Wo die Dateien liegen; einmal je Sitzung ermittelt.
let ort: Promise<{ ordner: string } | null> | null = null

const antwortAnfang = (p: Punkt) => `Zum offenen Punkt „${p.titel}“: `

async function zeigeStatus($: EngineInterface) {
  const [punkte, prueft] = await Promise.all([read($, punkteA), read($, prueftA)])
  $.ui.status(statuszeile(punkte, prueft))
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

async function speichern($: EngineInterface) {
  const o = await ablageOrt($)
  if (o === null) return
  const [punkte, ueberblick, jetzt] = await Promise.all([read($, punkteA), read($, ueberblickA), $.clock.now()])
  await $.fs.write(`${o.ordner}/offen.md`, ablageText({ punkte, ueberblick }, jetzt))
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
  await update($, punkteA, alt => fn(alt))
  const nachher = await read($, punkteA)
  const jetzt = await $.clock.now()
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
  await update($, punkteA, () => a.punkte)
  await update($, ueberblickA, () => a.ueberblick)
  await zeigeStatus($)
  const n = offene(a.punkte).length
  if (n > 0) $.ui.toast(n === 1 ? '1 offener Punkt aus der letzten Sitzung übernommen · /offen' : `${n} offene Punkte aus der letzten Sitzung übernommen · /offen`)
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
    const neueId = () => `p${jetzt.toString(36)}${(zaehler++).toString(36)}`
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
  await aendere($, liste => liste.map(p => {
    if (p.id !== id) return p
    const { ergebnis: _e, ...rest } = p
    return { ...rest, status: 'offen' as const, ohneBezug: 0, zurueckgestellt: 0 }
  }))
}

/** Die eigene Antwort abschicken: Punkt schliessen, Antwort an Claude. */
async function eigeneAntwort($: EngineInterface, punkt: Punkt, text: string) {
  await update($, eigeneA, () => '')
  const t = text.trim()
  if (t === '') return
  await setzeStatus($, punkt.id, 'erledigt', `eigene Antwort: ${t}`)
  await $.prompt.submit({ text: antwortAnfang(punkt) + t, asUser: true })
}

/** Eine Wahl in der Frage eines Punkts ausfuehren. */
async function waehlen($: EngineInterface, punkt: Punkt, wert: string, mitTextfeld: boolean) {
  if (wert === EIGENE) {
    if (mitTextfeld) {
      await update($, eigeneA, () => punkt.id)
      return
    }
    // Kein Textfeld (Handy): in der Eingabe vorbereiten; beim Abschicken schliesst sich der Punkt.
    vorbereitet = { id: punkt.id, anfang: antwortAnfang(punkt) }
    await $.prompt.fill({ text: antwortAnfang(punkt), mode: 'replace' })
    return
  }
  if (wert.startsWith(BEFEHL)) {
    // Nur vorbereitet: der Nutzer sieht die Bitte und schickt sie selbst ab; Claude fuehrt aus. Der Punkt bleibt offen.
    const befehl = befehle(punkt.anleitung)[Number(wert.slice(BEFEHL.length))]
    if (befehl !== undefined) await $.prompt.fill({ text: ausfuehrBitte(punkt.titel, befehl), mode: 'replace' })
    return
  }
  if (wert === SPAETER) {
    await aendere($, liste => liste.map(p => (p.id === punkt.id ? { ...p, zurueckgestellt: p.zurueckgestellt + 1 } : p)))
    return
  }
  if (wert === AKTUELL) {
    await aendere($, liste => liste.map(p => (p.id === punkt.id ? { ...p, ohneBezug: 0 } : p)))
    return
  }
  if (wert === ERLEDIGT) return setzeStatus($, punkt.id, 'erledigt', 'als erledigt markiert')
  if (wert === VERWERFEN) return setzeStatus($, punkt.id, 'verworfen', 'nicht relevant')

  const option = punkt.optionen[Number(wert)]
  if (option === undefined) return
  await setzeStatus($, punkt.id, 'erledigt', option.antwort !== '' ? `${option.label} – „${option.antwort}“` : option.label)
  if (option.antwort === '') return
  const text = antwortAnfang(punkt) + option.antwort
  if (brauchtErgaenzung(option.antwort)) {
    // Braucht noch eigenen Text: in die Eingabe, ergaenzen und selbst abschicken.
    await $.prompt.fill({ text: text.trimEnd() + ' ', mode: 'replace' })
    return
  }
  // Als eigene Nachricht des Nutzers; laeuft gerade eine Antwort, kommt sie danach.
  await $.prompt.submit({ text, asUser: true })
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
function wahl($: EngineInterface, els: Els, surface: string, key: string, punkt: Punkt, eigene: string) {
  const optionen = auswahl(punkt)
  const mitTextfeld = surface !== 'mobile' && 'Input' in els
  const { Box, Button, Text } = els
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
  if (k.art === 'leeren') {
    await aendere($, () => [])
    await update($, ueberblickA, () => '')
    await speichern($)
    return 'Liste der offenen Punkte geleert.'
  }
  const punkt = offene(await read($, punkteA))[k.nummer - 1]
  if (punkt === undefined) return `Punkt ${k.nummer} gibt es nicht – /offen zeigt die Nummern.`
  if (k.tun === 'option') {
    const o = punkt.optionen[k.option ?? -1]
    if (o === undefined) return `„${punkt.titel}“ hat keine Antwort ${String.fromCharCode(97 + (k.option ?? 0))}) – ${optionenText(punkt)}`
    await waehlen($, punkt, String(k.option), false)
    return `„${punkt.titel}“: ${o.label}`
  }
  const wert = { erledigt: ERLEDIGT, weg: VERWERFEN, spaeter: SPAETER, aktuell: AKTUELL }[k.tun]
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
  vorbereitet = null
  ort = null

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
    await laden($).catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
    await zeigeStatus($)
    return next(e)
  })

  // Nach /clear startet keine neue Sitzung im Sinne von session.start: dort die Datei nachladen.
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason === 'clear') {
      ort = null
      $.clock.after(0, () => {
        void laden($).catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
      })
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    // Nur was der Nutzer selbst schreibt - eine Antwort aus der Auswahl kennt Haiku schon.
    if (e.origin.kind === 'composer') {
      letzteEingabe = e.text
      const v = vorbereitet
      if (v !== null && e.text.startsWith(v.anfang)) {
        vorbereitet = null
        const rest = e.text.slice(v.anfang.length).trim()
        // Nicht hier warten: das Schliessen schreibt Dateien, die Nachricht soll sofort raus.
        if (rest !== '') {
          $.clock.after(0, () => {
            void setzeStatus($, v.id, 'erledigt', `eigene Antwort: ${rest}`).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
          })
        }
      }
    }
    return next(e)
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
    const o = await ablageOrt($)
    const kopfzeile = ueberblick !== '' ? `Überblick:\n${ueberblick}\n\n` : ''
    const fuss = o !== null ? `\n\nDatei: ${o.ordner}/offen.md · Verlauf: antworten-JJJJ-MM-TT.md` : ''
    if (liste.length === 0) return { text: `${kopfzeile}Nichts offen.${fuss}` }

    return {
      text: kopfzeile + liste.map((p, i) => {
        const anleitung = (p.anleitung ?? '') !== '' ? `\n${p.anleitung.replace(/^/gm, '   ')}` : ''
        return `${i + 1}. ${p.art === 'aufgabe' ? 'Zu tun: ' : ''}${p.titel}${vermerk(p)} – ${p.frage}${p.info !== '' ? `\n   ${p.info}` : ''}${anleitung}\n   ${optionenText(p)}`
      }).join('\n') + `\n\n/offen <Nr> a|b|c|d wählt eine Antwort · /offen <Nr> erledigt|weg|später${fuss}`,
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

  // Die naechste offene Frage ueber der Eingabe.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!fragenAnzeigen || e.props.hasSurvey || (await read($, ausgeblendetA))) return next(e)
    const liste = offene(await read($, punkteA))
    const punkt = liste[0]
    if (punkt === undefined) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    const k = kopf(punkt)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={k.farbe} paddingX={1}>
        <Text>
          <Text color={k.farbe} bold>{k.zeichen}</Text>
          <Text dimColor>{liste.length > 1 ? ` (1 von ${liste.length})` : ''}{istVeraltet(punkt) ? ' – noch aktuell?' : ''}: </Text>
          <Text bold>{punkt.titel}</Text>
        </Text>
        <Text wrap="wrap">{punkt.frage}</Text>
        {(punkt.anleitung ?? '') !== '' && <Markdown key={`anleitung-${punkt.id}`} text={punkt.anleitung} />}
        <Box flexDirection="row">
          {wahl($, els, e.surface, `wahl-${punkt.id}`, punkt, await read($, eigeneA))}
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
    const [punkte, prueft, ueberblick, eigene] = await Promise.all([read($, punkteA), read($, prueftA), read($, ueberblickA), read($, eigeneA)])
    const liste = offene(punkte)
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
        {liste.length === 0 && <Text dimColor>Nichts offen.</Text>}
        {liste.map((p, i) => (
          <Box key={p.id} flexDirection="column" borderStyle="round" borderColor={kopf(p).farbe} borderDimColor={istVeraltet(p)} paddingX={1}>
            <Text>
              <Text color={kopf(p).farbe} bold>{i + 1}. {p.art === 'aufgabe' ? 'Zu tun: ' : ''}</Text>
              <Text bold>{p.titel}</Text>
              <Text dimColor>{vermerk(p)}</Text>
            </Text>
            <Text wrap="wrap" dimColor={istVeraltet(p)}>{p.frage}</Text>
            {p.info !== '' && <Text dimColor wrap="wrap">{p.info}</Text>}
            {(p.anleitung ?? '') !== '' && <Markdown key={`anl-${p.id}`} text={p.anleitung} />}
            {wahl($, els, e.surface, `liste-${p.id}`, p, eigene)}
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
