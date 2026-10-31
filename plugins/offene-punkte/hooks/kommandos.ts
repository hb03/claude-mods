// /offen-Befehle, Block-Eintraege, Gedanken, Uebergabe, eingang.txt
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Option, Punkt } from '../types'
import {
  EINGANG_RUHE_MS, EINGANG_TAKT_MS, EINGANG_WACH_MS, UEBERGABE, abgelehnteAenderungen, aenderungenZuIds, ausstehende, befehlEntfernen,
  befehlVerschieben, eingangZeilen, fragbar, fremd, gedankeBitte, gedankeKurz, gedankenLesen, gedankenPruefBitte, gedankenText, gedankeZustand,
  geschlossenFuehren, indexZeile, klaerungsBitte, kommando, kostenAuswerten, naechsteGedankenNr, nichtsFragbar, notiz, nummerieren, offene,
  ruheVermerk, ueberblickKontext, uebergabeDateien, uebergabeIndex, uebergabeKontext, uebergabeName, uebergabeText, zeitText, zusammenfuehren,
} from './logik'
import type { Auswertung, Gedanke, GedankenDatei, Geschlossen, NrAenderung } from './logik'
import { AKTUELL, ANS_ENDE, ERLEDIGT, RUHE, VERWERFEN, WARTET, z } from './zustand'
import { abschicken, antworten, ergebnis, gesammelt, naechsteReihe, senden, waehlen } from './antworten'
import type { Wahl } from './antworten'
import { ablageOrt, aendere, lebenszeichen, mitSperre, nachladen, nummernAb, nutzung, schreiben, sicht, speichern, windowsHost, zeigeStatus } from './dateien'
import { ueberblickErneuern } from './haiku'
import { optionenText } from './oberflaeche'

// Die Zustandsreferenzen stehen in jeder Datei, die sie liest oder schreibt: der Lader der Engine
// nimmt an read/update nur Referenzen aus derselben Datei (kein Import).
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const ueberblickA = atom({ plugin: 'offene-punkte', key: 'ueberblick' } as const, '')
const abschickenA = atom({ plugin: 'offene-punkte', key: 'abschicken' } as const, { sekunden: 0, inEingabe: false })
const gedankenStandA = atom({ plugin: 'offene-punkte', key: 'gedankenStand' } as const, 0)
const geschlossenA = atom({ plugin: 'offene-punkte', key: 'geschlossen' } as const, {} as Geschlossen)

async function uebergabeOrdner($: EngineInterface): Promise<string | null> {
  const o = await ablageOrt($)
  return o === null ? null : `${o.ordner}/uebergaben`
}

async function uebergabenIn($: EngineInterface, archiv: string): Promise<string[]> {
  const l = await $.fs.list(archiv).catch(() => [])
  return uebergabeDateien(l.filter(x => x.kind === 'file').map(x => x.name))
}

function wartende($: EngineInterface, archiv: string): Promise<string> {
  return $.fs.read(`${archiv}/${WARTET}`).then(t => String(t).trim()).catch(() => '')
}

/**
 * /offen übergabe: ein Fork des Hauptmodells (aus dem Prompt-Cache) schreibt die Uebergabe ins Archiv
 * uebergaben/, wartet.txt merkt sie fuer die naechste neue Unterhaltung vor. Erst wenn beides
 * nachweislich steht, folgt /clear (ohne „nur“); scheitert etwas, bleibt die Sitzung, wie sie ist.
 */
async function uebergabeSchreiben($: EngineInterface, clear: boolean): Promise<string> {
  if (z.turnLaeuft) return 'Claude arbeitet noch – /offen übergabe, wenn die Antwort fertig ist.'
  const archiv = await uebergabeOrdner($)
  if (archiv === null) return 'Kein Ablageort für die Übergabe.'
  $.ui.toast('Übergabe wird geschrieben …', { timeoutMs: 4000 })
  const r = await $.model.fork({ prompt: UEBERGABE })
  if (!r.isAnswered) {
    return r.reason === 'nothing-to-fork'
      ? 'Noch nichts zu übergeben – die Sitzung hat noch keine Antwort.'
      : `Übergabe nicht geschrieben (${r.reason}); die Sitzung bleibt, wie sie ist.`
  }
  if (r.text.trim() === '') return 'Übergabe nicht geschrieben (leere Antwort); die Sitzung bleibt, wie sie ist.'
  const [jetzt, vorhanden] = await Promise.all([$.clock.now(), uebergabenIn($, archiv)])
  const name = uebergabeName(jetzt, vorhanden)
  const datei = `${archiv}/${name}`
  const text = uebergabeText(r.text, jetzt, z.sitzung)
  // Zurueckgelesen statt vertraut: ein /clear auf eine halb geschriebene Datei waere nicht mehr gutzumachen.
  const steht = await $.fs.write(datei, text).then(() => $.fs.read(datei)).then(t => String(t) === text).catch(() => false)
  const vorgemerkt = steht && await $.fs.write(`${archiv}/${WARTET}`, `${name}\n`).then(() => wartende($, archiv)).then(w => w === name).catch(() => false)
  if (!vorgemerkt) return `Übergabe nicht gespeichert (${datei}); die Sitzung bleibt, wie sie ist.`
  const index = await $.fs.read(`${archiv}/index.md`).then(t => String(t)).catch(() => '')
  await $.fs.write(`${archiv}/index.md`, uebergabeIndex(index, name, r.text, jetzt))
    .catch(fehler => $.ui.log(`offene-punkte: Übergaben-Index nicht geschrieben (${String(fehler)})`))
  $.ui.log(`offene-punkte: Übergabe ${datei}`)
  if (!clear) return `Übergabe gespeichert: ${datei}\nDie nächste neue Unterhaltung (nach /clear oder Neustart) bekommt sie mit der ersten Nachricht.`
  // Nicht im Hook selbst: aus /offen (command.run) heraus lehnt die Engine einen weiteren Befehl ab.
  $.clock.after(0, () => void clearNachUebergabe($))
  return `Übergabe gespeichert: ${datei}\n/clear folgt – die neue Unterhaltung bekommt sie mit deiner ersten Nachricht.`
}

/** /clear nach der Uebergabe; nimmt die Engine es nicht an, liegt es in der (leeren) Eingabe. */
async function clearNachUebergabe($: EngineInterface) {
  try {
    await $.command.run({ command: 'clear' })
  } catch (fehler) {
    $.ui.log(`offene-punkte: /clear nicht ausgeführt (${String(fehler)})`)
    const box = await $.prompt.read().catch(() => null)
    const gefuellt = box !== null && box.text.trim() === ''
      && await $.prompt.fill({ text: '/clear', mode: 'replace' }).then(f => f.isFilled).catch(() => false)
    $.ui.toast(gefuellt ? 'Übergabe gespeichert – /clear liegt in der Eingabe, Enter löscht den Verlauf.' : 'Übergabe gespeichert – jetzt /clear eingeben.', { timeoutMs: 10_000 })
  }
}

async function uebergabenListe($: EngineInterface): Promise<string> {
  const archiv = await uebergabeOrdner($)
  if (archiv === null) return 'Kein Ablageort für Übergaben.'
  const namen = await uebergabenIn($, archiv)
  if (namen.length === 0) return 'Noch keine Übergaben – /offen übergabe schreibt eine und leert danach den Verlauf (/offen übergabe nur: ohne /clear).'
  const [index, wartet] = await Promise.all([$.fs.read(`${archiv}/index.md`).then(t => String(t)).catch(() => ''), wartende($, archiv)])
  const zeilen = namen.slice(0, 20).map((n, i) => `${i + 1}. ${indexZeile(index, n)}${n === wartet ? ' – wartet auf die nächste Unterhaltung' : ''}`)
  const mehr = namen.length > 20 ? `\n… und ${namen.length - 20} ältere` : ''
  return `Übergaben (${namen.length}, neueste zuerst):\n${zeilen.join('\n')}${mehr}\n\n/offen übergabe <Nr> zeigt eine · Ordner: ${archiv}`
}

async function uebergabeZeigen($: EngineInterface, nummer: number): Promise<string> {
  const archiv = await uebergabeOrdner($)
  if (archiv === null) return 'Kein Ablageort für Übergaben.'
  const namen = await uebergabenIn($, archiv)
  const name = namen[nummer - 1]
  if (name === undefined) return namen.length === 0 ? 'Noch keine Übergaben.' : `Keine Übergabe ${nummer} – es gibt ${namen.length} (/offen übergaben).`
  const text = await $.fs.read(`${archiv}/${name}`).then(t => String(t)).catch(() => '')
  return text === '' ? `${archiv}/${name} nicht lesbar.` : `${text.trimEnd()}\n\nDatei: ${archiv}/${name}`
}

/**
 * Die erste Nachricht einer neuen Unterhaltung (Start ohne Verlauf, /clear): eine wartende Uebergabe
 * geht ganz an Claude und gilt damit als abgeholt; sonst der Ueberblick der letzten Sitzung, wenn es
 * einen gibt. Beides nur einmal - danach ist es Teil des Verlaufs.
 */
export async function startKontext($: EngineInterface): Promise<string> {
  const archiv = await uebergabeOrdner($)
  if (archiv === null) return ''
  const name = await wartende($, archiv)
  if (name !== '') {
    const datei = `${archiv}/${name}`
    const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    await $.fs.write(`${archiv}/${WARTET}`, '')
      .catch(fehler => $.ui.log(`offene-punkte: ${WARTET} nicht geleert (${String(fehler)})`))
    if (text !== '') return uebergabeKontext(text, datei, archiv)
  }
  const u = await read($, ueberblickA)
  if (u === '') return ''
  const mitArchiv = (await uebergabenIn($, archiv)).length > 0
  return ueberblickKontext(u, mitArchiv ? archiv : null)
}

/** Sagt in einer neuen Unterhaltung, dass eine Uebergabe bereitliegt. */
export async function uebergabeAnkuendigen($: EngineInterface) {
  const archiv = await uebergabeOrdner($)
  if (archiv === null || (await wartende($, archiv)) === '') return
  $.ui.toast('Übergabe liegt bereit – sie geht mit deiner ersten Nachricht an Claude · /offen übergaben', { timeoutMs: 8000 })
}

/**
 * eingang.txt im Projektordner: je Zeile ein /offen-Befehl ohne das „/offen“, von claude-web oder
 * einem Skript angehaengt. Die Sitzung fuehrt die Zeilen aus und nimmt sie aus der Datei; was
 * waehrenddessen dazukam, bleibt stehen. So antwortet claude-web ohne tmux und ohne Modellrunde.
 */
export async function eingangLesen($: EngineInterface) {
  if (z.eingangLaeuft) return
  z.eingangLaeuft = true
  try {
    const o = await ablageOrt($)
    if (o === null) return
    const datei = `${o.ordner}/eingang.txt`
    const gelesen = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    if (eingangZeilen(gelesen).length === 0) return
    // Mehrere Sitzungen im Projekt lesen dieselbe Datei: wer sie zuerst beiseite schiebt, fuehrt sie aus -
    // sonst ging jeder Befehl einmal je Sitzung durch. Was claude-web danach anhaengt, legt eine neue an.
    const windows = await windowsHost($)
    const meins = `${datei}.${(z.sitzung || 'neu').slice(0, 8)}.tmp`
    const r = await $.process.run(befehlVerschieben(datei, meins, windows)).catch(() => null)
    if (r !== null && r.exitCode !== 0) return
    const text = r === null ? gelesen : await $.fs.read(meins).then(t => String(t)).catch(() => '')
    const zeilen = eingangZeilen(text)
    const ergebnisse: string[] = []
    for (const z of zeilen) {
      const r = await offenKommando($, z, 'eingang').catch(fehler => `Fehler: ${String(fehler)}`)
      ergebnisse.push(`${z} → ${r ?? 'Liste'}`)
    }
    if (r !== null) await $.process.run(befehlEntfernen([meins], windows)).catch(() => undefined)
    else {
      // Ohne Prozesse wie bis 0.17.1: das Ausgefuehrte aus der Datei nehmen, Neues bleibt stehen.
      const danach = await $.fs.read(datei).then(t => String(t)).catch(() => '')
      await $.fs.write(datei, danach.startsWith(text) ? danach.slice(text.length) : danach)
        .catch(fehler => $.ui.log(`offene-punkte: eingang.txt nicht geleert (${String(fehler)})`))
    }
    if (zeilen.length === 0) return
    $.ui.log(`offene-punkte: Eingang: ${ergebnisse.join(' · ')}`)
    $.ui.toast(`Eingang: ${zeilen.length === 1 ? '1 Befehl' : `${zeilen.length} Befehle`} ausgeführt · /offen`, { timeoutMs: 5000 })
  } finally {
    z.eingangLaeuft = false
  }
}

export function eingangPlanen($: EngineInterface, takt = EINGANG_RUHE_MS) {
  z.eingangTakt?.cancel()
  z.eingangTakt = $.clock.after(takt, () => {
    void eingangLesen($)
      .catch(fehler => $.ui.log(`offene-punkte: Eingang (${String(fehler)})`))
      .then(() => Promise.all([nachladen($), lebenszeichen($)]))
      .catch(fehler => $.ui.log(`offene-punkte: Nachladen (${String(fehler)})`))
      .then(() => $.clock.now())
      .then(jetzt => eingangPlanen($, z.turnLaeuft || jetzt - z.letzterMensch < EINGANG_WACH_MS ? EINGANG_TAKT_MS : EINGANG_RUHE_MS))
      .catch(() => eingangPlanen($))
  })
}

export async function setzeStatus($: EngineInterface, id: string, status: Punkt['status'], ergebnis: string) {
  await aendere($, liste => liste.map(p => (p.id === id ? { ...p, status, ergebnis } : p)))
}

export async function wiederOeffnen($: EngineInterface, id: string) {
  // Die Nummer bleibt (sie wird nie neu vergeben); Punkte aus aelteren Fassungen bekommen eine.
  const ab = await nummernAb($)
  await aendere($, liste => nummerieren(liste.map(p => {
    if (p.id !== id) return p
    const { ergebnis: _e, ruht: _r, auto: _a, ...rest } = p
    return { ...rest, status: 'offen' as const, ohneBezug: 0, zurueckgestellt: 0, sitzung: z.sitzung }
  }), ab))
}

/** Ruht ein Punkt, wird er gleich wieder gefragt. */
export async function aufnehmen($: EngineInterface, id: string) {
  await aendere($, liste => liste.map(p => {
    if (p.id !== id) return p
    const { ruht: _r, ...rest } = p
    return rest
  }))
}

/** Punkte anlegen und aendern - aus dem Block in der Antwort. Schliessen laeuft ueber die Marken (schlussMarken). */
export async function punkteEintragen($: EngineInterface, neu: Auswertung['neu'], aenderungen: readonly NrAenderung[]) {
  const [jetzt, ab, vorher] = await Promise.all([$.clock.now(), nummernAb($), read($, punkteA)])
  const vergeben = new Set(vorher.map(p => p.id))
  let i = 0
  const neueId = () => {
    let id: string
    do id = `b${jetzt.toString(36)}${(i++).toString(36)}`
    while (vergeben.has(id))
    vergeben.add(id)
    return id
  }
  // Erwaehnt sind hier alle: ein Eintrag laesst keinen Punkt altern.
  const alle = offene(vorher).map(p => p.id)
  const aktualisiert = aenderungenZuIds(vorher, aenderungen)
  const abgelehnt = abgelehnteAenderungen(vorher, aenderungen)
  await aendere($, l => zusammenfuehren(l, { neu, aktualisiert, erledigt: [], erwaehnt: alle, ueberblick: '' }, jetzt, neueId, ab, z.sitzung))
  const bekannt = new Set(vorher.map(p => p.id))
  const angelegt = (await read($, punkteA)).filter(p => !bekannt.has(p.id))
  if (angelegt.length > 0) $.ui.toast(angelegt.length === 1 ? '1 neuer offener Punkt – Frage über der Eingabe' : `${angelegt.length} neue offene Punkte – Frage über der Eingabe`, { timeoutMs: 5000 })
  // Aus dem Block kennt Claude die vergebenen Nummern nicht: er erfaehrt sie mit der naechsten Nachricht.
  if (angelegt.length > 0) {
    z.hinweiseFuerClaude.push(`offene-punkte: Dein Block hat angelegt: ${angelegt.map(p => `#${p.nr ?? '?'} „${p.titel}“`).join(', ')}. Mit diesen Nummern schließt du sie.`)
  }
  // Claude hat einen schon erledigten (oder gerade beantworteten) Punkt geaendert: er ist wieder offen.
  const warZu = new Set(vorher.filter(p => p.status !== 'offen').map(p => p.id))
  const wieder = aktualisiert.filter(a => warZu.has(a.id)).map(a => vorher.find(p => p.id === a.id)!)
  if (wieder.length > 0) $.ui.toast(wieder.map(p => `↺ #${p.nr} „${p.titel}“ wieder offen`).join(' · ') + ' – Claude hat ihn geändert', { timeoutMs: 6000 })
  // Verworfen oder unbekannt: nicht still verlieren - der Nutzer sieht es, Claude erfährt es mit der naechsten Nachricht.
  if (abgelehnt.length > 0) {
    const zeilen = abgelehnt.map(a => {
      const p = vorher.find(x => x.nr === a.nr)
      return p !== undefined
        ? `#${a.nr} „${p.titel}“ ist vom Nutzer verworfen (nicht relevant)`
        : `#${a.nr} gibt es nicht`
    })
    $.ui.toast(`Änderung nicht übernommen: ${zeilen.join(' · ')}`, { timeoutMs: 8000 })
    z.hinweiseFuerClaude.push(`offene-punkte: Deine Änderung kam nicht an – ${zeilen.join('; ')}. Brauchst du das noch vom Nutzer, leg einen neuen Punkt an.`)
  }
}

/** gedanken.md im Projektordner - die Datei ist der Stand, claude-web schreibt sie auch: immer frisch lesen. */
export async function gedankenDatei($: EngineInterface): Promise<{ datei: string; d: GedankenDatei } | null> {
  const o = await ablageOrt($)
  if (o === null) return null
  const datei = `${o.ordner}/gedanken.md`
  const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
  return { datei, d: gedankenLesen(text) }
}

async function gedankenSchreiben($: EngineInterface, datei: string, d: GedankenDatei) {
  // Unter der Sperre: claude-web schreibt gedanken.md auch und beachtet dieselbe Sperre (0.18.0).
  await mitSperre($, () => schreiben($, datei, gedankenText(d)))
  await update($, gedankenStandA, n => n + 1)
}

/** Den Vermerk eines Gedankens setzen; null, wenn es ihn nicht gibt. */
export async function gedankeVermerken($: EngineInterface, nr: number, vermerk: string): Promise<Gedanke | null> {
  const g = await gedankenDatei($)
  const eintrag = g?.d.gedanken.find(x => x.nr === nr)
  if (g === null || eintrag === undefined) return null
  eintrag.vermerk = vermerk
  await gedankenSchreiben($, g.datei, g.d)
  return eintrag
}

/** senden / interview / punkt / erledigt / weg zu einem Gedanken - aus /offen, dem Pane und eingang.txt. */
export async function gedankeTun($: EngineInterface, nr: number, tun: 'senden' | 'interview' | 'punkt' | 'erledigt' | 'weg', text = ''): Promise<string> {
  const g = await gedankenDatei($)
  const eintrag = g?.d.gedanken.find(x => x.nr === nr)
  if (g === null || eintrag === undefined) return `Gedanke G${nr} gibt es nicht – /offen gedanken zeigt die Nummern.`
  const jetzt = await $.clock.now()
  if (tun === 'senden' || tun === 'interview') {
    const bitte = gedankeBitte(eintrag, tun)
    await gedankeVermerken($, nr, tun === 'senden' ? 'gesendet' : 'im Planungsinterview')
    $.clock.after(0, () => {
      void $.prompt.submit({ text: bitte, asUser: true }).catch(fehler => $.ui.log(`offene-punkte: Gedanke nicht gesendet (${String(fehler)})`))
    })
    return `G${nr} ${tun === 'senden' ? 'geht an Claude' : 'geht ins Planungsinterview'}.`
  }
  if (tun === 'punkt') {
    // Wie /offen neu: ein eigener Punkt ohne feste Antworten, den die Auswertung in Ruhe laesst.
    const [alle, ab] = await Promise.all([read($, punkteA), nummernAb($)])
    const ids = new Set(alle.map(p => p.id))
    let i = 0
    let id: string
    do id = `g${jetzt.toString(36)}${(i++).toString(36)}`
    while (ids.has(id))
    await aendere($, liste => nummerieren([...liste, notiz(eintrag.text, id, jetzt, z.sitzung)], ab))
    const neu = (await read($, punkteA)).find(p => p.id === id)
    await gedankeVermerken($, nr, `als Punkt #${neu?.nr ?? '?'}`)
    return `G${nr} ist jetzt Punkt ${neu?.nr ?? '?'}: „${neu?.titel ?? ''}“`
  }
  const tag = zeitText(jetzt).slice(0, 6)
  const vermerk = tun === 'erledigt' ? `erledigt ${tag}${text !== '' ? ` · ${text}` : ''}` : `verworfen${text !== '' ? ` · ${text}` : ''}`
  await gedankeVermerken($, nr, vermerk)
  return `G${nr}: ${vermerk}.`
}

/** /offen mit Nummer: einen Punkt erledigen, verwerfen, zurueckstellen oder eine Antwort waehlen. */
export async function offenKommando($: EngineInterface, args: string, quelle: 'befehl' | 'eingang' = 'befehl'): Promise<string | null> {
  const k = kommando(args)
  if (k.art !== 'fehler') void nutzung($, quelle, k.art === 'punkt' ? k.tun : k.art === 'gedanke' ? `gedanke-${k.tun}` : k.art).catch(() => undefined)
  if (k.art === 'liste') return null
  if (k.art === 'fehler') return k.text
  if (k.art === 'senden') {
    const n = gesammelt(await read($, punkteA)).length
    if (z.vorschlag !== '') {
      await abschicken($)
      return 'Vorgelegte Antworten gesendet.'
    }
    await senden($)
    return n > 0 ? 'Gesammelte Antworten gesendet.' : 'Es wartet nichts.'
  }
  if (k.art === 'leeren') {
    z.zeitgeber?.cancel()
    z.zeitgeber = null
    // Grabsteine fuer alles, was offen war: sonst schriebe eine andere Sitzung die Punkte gleich wieder auf.
    const jetzt = await $.clock.now()
    const weg = (await read($, punkteA)).map(p => (p.status === 'offen' ? { ...p, status: 'verworfen' as const, ergebnis: 'Liste geleert', geaendert: jetzt } : p))
    await update($, geschlossenA, g => geschlossenFuehren(weg, jetzt, g))
    await update($, punkteA, () => [])
    await update($, ueberblickA, () => '')
    await speichern($, false)
    await zeigeStatus($)
    return 'Liste der offenen Punkte geleert.'
  }
  if (k.art === 'neu') {
    const [alle, jetzt, ab] = await Promise.all([read($, punkteA), $.clock.now(), nummernAb($)])
    const ids = new Set(alle.map(p => p.id))
    let i = 0
    let id: string
    do id = `n${jetzt.toString(36)}${(i++).toString(36)}`
    while (ids.has(id))
    await aendere($, liste => nummerieren([...liste, notiz(k.text, id, jetzt, z.sitzung)], ab))
    const neu = (await read($, punkteA)).find(p => p.id === id)
    return neu === undefined ? 'Punkt nicht angelegt.' : `Punkt ${neu.nr ?? '?'} angelegt: „${neu.titel}“`
  }
  if (k.art === 'gedanke-neu') {
    const g = await gedankenDatei($)
    if (g === null) return 'Kein Ablageort für Gedanken.'
    const nr = naechsteGedankenNr(g.d)
    const neu: Gedanke = { nr, zeit: zeitText(await $.clock.now()), vermerk: 'offen', text: k.text }
    g.d.gedanken.push(neu)
    await gedankenSchreiben($, g.datei, g.d)
    return `Gedanke G${nr} notiert: „${gedankeKurz(neu)}“ – /offen gedanke ${nr} senden|interview|punkt`
  }
  if (k.art === 'gedanken') {
    const g = await gedankenDatei($)
    const liste = (g?.d.gedanken ?? []).filter(x => gedankeZustand(x) !== 'verarbeitet')
    if (liste.length === 0) return 'Keine Gedanken offen – /offen gedanke <Text> notiert einen.'
    return `Gedanken (${liste.length}):\n${liste.map(x => `G${x.nr} · ${x.zeit} · ${x.vermerk}: ${gedankeKurz(x, 120)}`).join('\n')}\n\n/offen gedanke <Nr> senden|interview|punkt|erledigt|weg · /offen gedanken prüfen`
  }
  if (k.art === 'gedanken-pruefen') {
    const g = await gedankenDatei($)
    const inArbeit = (g?.d.gedanken ?? []).filter(x => gedankeZustand(x) === 'in Arbeit')
    if (inArbeit.length === 0) return 'Kein Gedanke in Arbeit.'
    // Wie /offen klaeren: ein Maschinen-Turn, in dem nur die Marken zaehlen.
    z.eingabeArt = 'maschine'
    const text = gedankenPruefBitte(inArbeit)
    $.clock.after(0, () => {
      void $.prompt.submit({ text, asUser: true }).catch(fehler => $.ui.log(`offene-punkte: Prüfung nicht gesendet (${String(fehler)})`))
    })
    return `Prüfung von ${inArbeit.length} ${inArbeit.length === 1 ? 'Gedanken' : 'Gedanken'} geht an Claude.`
  }
  if (k.art === 'gedanke') return gedankeTun($, k.nummer, k.tun, k.text)
  if (k.art === 'uebergabe') return uebergabeSchreiben($, k.clear)
  if (k.art === 'uebergaben') return uebergabenListe($)
  if (k.art === 'uebergabe-zeigen') return uebergabeZeigen($, k.nummer)
  if (k.art === 'kosten') {
    const o = await ablageOrt($)
    const text = o === null ? '' : await $.fs.read(`${o.ordner}/kosten.jsonl`).then(t => String(t)).catch(() => '')
    return kostenAuswerten(text, await $.clock.now(), k.tage)
  }
  if (k.art === 'ueberblick') {
    const u = await ueberblickErneuern($, 'befehl')
    return u !== '' ? `Überblick neu:\n${u}` : 'Überblick nicht erneuert (kein Verlauf, oder Haiku gerade nicht erlaubt).'
  }
  if (k.art === 'klaeren') {
    const s = await sicht($)
    const punkte = await read($, punkteA)
    // alle: auch Zurückgelegtes und Punkte anderer (oft längst beendeter) Sitzungen - die werden dafür
    // übernommen, sonst prallten Claudes Marken an ihnen ab („gehört einer anderen Sitzung“).
    const liste = k.alle ? offene(punkte) : fragbar(punkte, s)
    if (liste.length === 0) return nichtsFragbar(punkte, s, ', /offen klären alle übernimmt und klärt sie')
    const fremde = new Set(liste.filter(p => fremd(p, s.sitzung)).map(p => p.id))
    if (fremde.size > 0) await aendere($, l => l.map(p => (fremde.has(p.id) ? { ...p, sitzung: z.sitzung } : p)))
    const uebrig = k.alle ? 0 : offene(punkte).length - liste.length
    const text = klaerungsBitte(liste)
    // Ein eigener Submit laeuft nicht durch den eigenen prompt.submit-Hook: die Antwort darauf gilt
    // als Maschinen-Turn (nur Marken und Block, kein Nachfassen, kein Altern).
    z.eingabeArt = 'maschine'
    $.clock.after(0, () => {
      void $.prompt.submit({ text, asUser: true }).catch(fehler => $.ui.log(`offene-punkte: Klärung nicht gesendet (${String(fehler)})`))
    })
    const zusatz = fremde.size > 0 ? ` (${fremde.size} aus anderen Sitzungen hierher übernommen)`
      : uebrig > 0 ? ` (${uebrig} weitere aus anderen Sitzungen oder zurückgelegt: /offen klären alle)` : ''
    return `Klärung von ${liste.length} ${liste.length === 1 ? 'Punkt' : 'Punkten'} geht an Claude${zusatz}.`
  }
  if (k.art === 'alle') {
    // Sammelschluss ohne Modellrunde (claude-web, Aufraeumen); im Verlauf je Punkt nur eine Kurzzeile.
    const [punkte, s] = await Promise.all([read($, punkteA), sicht($)])
    const ids = new Set(fragbar(punkte, s).map(p => p.id))
    if (ids.size === 0) return nichtsFragbar(punkte, s, ', /offen <Nr> erledigt|weg schließt einzelne')
    const status = k.tun === 'weg' ? 'verworfen' as const : 'erledigt' as const
    const ergebnis = `gesammelt ${status}${k.grund !== '' ? ` – ${k.grund}` : ''}`
    await aendere($, liste => liste.map(p => (ids.has(p.id) ? { ...p, status, ergebnis } : p)))
    return `${ids.size} ${ids.size === 1 ? 'Punkt' : 'Punkte'} ${status}.`
  }
  const alle = await read($, punkteA)
  const punkt = offene(alle).find(p => p.nr === k.nummer)
  // Wieder öffnen, was ohne Zutun geschlossen wurde (claude-web: Knopf „wieder öffnen“)
  const zu = punkt === undefined && k.tun === 'aktuell' ? alle.find(p => p.nr === k.nummer && p.status !== 'offen') : undefined
  if (zu !== undefined) {
    await wiederOeffnen($, zu.id)
    return `„${zu.titel}“ ist wieder offen.`
  }
  if (punkt === undefined) {
    const beantwortet = ausstehende(alle).find(p => p.nr === k.nummer)
    if (beantwortet !== undefined) return `„${beantwortet.titel}“ ist schon beantwortet und geht mit den übrigen Antworten an Claude.`
    const geschlossen = alle.filter(p => p.nr === k.nummer && p.status !== 'offen')
      .sort((a, b) => (b.geaendert ?? b.erstellt) - (a.geaendert ?? a.erstellt))[0]
    return geschlossen !== undefined
      ? `#${k.nummer} „${geschlossen.titel}“ ist schon ${geschlossen.status === 'verworfen' ? 'verworfen' : 'erledigt'}${geschlossen.ergebnis ? ` (${geschlossen.ergebnis.slice(0, 120)})` : ''} – /offen ${k.nummer} aktuell öffnet ihn wieder.`
      : `Punkt ${k.nummer} gibt es nicht – /offen zeigt die Nummern.`
  }
  if (k.tun === 'antwort') {
    // Freie Antwort (auch von claude-web): schliesst den Punkt und geht sofort - direkt in die Sammlung,
    // nicht ueber die Eingabe (dort bliebe sie liegen, bis jemand Enter drueckt).
    const w: Wahl = { status: 'erledigt', label: 'eigene Antwort', text: k.text }
    await aendere($, liste => {
      const reihe = naechsteReihe(liste)
      return liste.map(p => (p.id === punkt.id
        ? { ...p, ausstehend: { status: w.status, ergebnis: ergebnis(w, w.text), text: w.text, wo: 'sammlung' as const, reihe } }
        : p))
    })
    await senden($)
    return `„${punkt.titel}“: Antwort geht an Claude.`
  }
  if (k.tun === 'optionen') {
    // Mehrere Antworten zusammen (Punkte mit Mehrfachauswahl): Saetze hintereinander als eine Antwort
    const gewaehlt = k.optionen.map(i => punkt.optionen[i])
    if (gewaehlt.some(o => o === undefined)) return `„${punkt.titel}“ hat nicht alle diese Antworten – ${optionenText(punkt)}`
    const os = gewaehlt as Option[]
    const w: Wahl = { status: 'erledigt', label: os.map(o => o.label).join(' + '),
                      text: os.map(o => o.antwort || o.label).join(' ') }
    await antworten($, punkt, w)
    return `„${punkt.titel}“: ${w.label}`
  }
  if (k.tun === 'option') {
    const o = punkt.optionen[k.option ?? -1]
    if (o === undefined) return `„${punkt.titel}“ hat keine Antwort ${String.fromCharCode(97 + (k.option ?? 0))}) – ${optionenText(punkt)}`
    await waehlen($, punkt, String(k.option), false)
    const wartet = gesammelt(await read($, punkteA)).length
    const ab = await read($, abschickenA)
    if (ab.sekunden > 0) {
      return `„${punkt.titel}“: ${o.label} – alle Fragen beantwortet, geht in ${ab.sekunden} s an Claude${ab.inEingabe ? ' (steht in der Eingabe, Enter schickt sofort)' : ' (oder /offen senden)'}`
    }
    return `„${punkt.titel}“: ${o.label}${wartet > 0 ? ` – wartet auf die übrigen Fragen (höchstens 30 s, oder /offen senden)` : ''}`
  }
  if (k.tun === 'spaeter' && k.bis !== undefined) {
    await waehlen($, punkt, `${RUHE}${k.bis}`, false)
    const p = (await read($, punkteA)).find(x => x.id === punkt.id)
    const wie = p !== undefined ? ruheVermerk(p, { sitzung: '', jetzt: await $.clock.now() }) : ''
    return `„${punkt.titel}“: ${wie || 'zurückgelegt.'}`
  }
  const wert = { erledigt: ERLEDIGT, weg: VERWERFEN, spaeter: ANS_ENDE, aktuell: AKTUELL }[k.tun]
  await waehlen($, punkt, wert, false)
  const was = { erledigt: 'erledigt', weg: 'verworfen', spaeter: 'zurückgestellt', aktuell: 'wieder aktuell' }[k.tun]
  return `„${punkt.titel}“: ${was}.`
}
