// Ablageordner: Sperre, Schreiben, Speichern, Nachladen, Lebenszeichen, Verlauf - alles, was Dateien anfasst
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Punkt } from '../types'
import {
  LEBT_MS, SPERRE_ALT_MS, abgleichen, ablageDaten, ablageLesen, ablageText, alteReste, alteVerlaeufe, ausnahmeErgaenzen, befehlEntfernen,
  befehlFreigeben, befehlSperren, befehlVerschieben, datum, entscheidungenAus, fragbar, geschlossenFuehren, hoechsteImVerlauf, hoechsteNr,
  installierteVersion, laufendeVersion, laufendeVersionSetzen, manifestVersion, monatsKopf, neuerAlsLaufend, ordnerName, statuszeile, stempeln,
  tagAnhaengen, uebernehmen, verlaufKopf, verlaufsEintraege, zuGeschlossen,
} from './logik'
import type { Ablage, Geschlossen, Sicht } from './logik'
import { z } from './zustand'

// Die Zustandsreferenzen stehen in jeder Datei, die sie liest oder schreibt: der Lader der Engine
// nimmt an read/update nur Referenzen aus derselben Datei (kein Import).
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const hoechsteA = atom({ plugin: 'offene-punkte', key: 'hoechsteNr' } as const, 0)
const prueftA = atom({ plugin: 'offene-punkte', key: 'prueft' } as const, false)
const ueberblickA = atom({ plugin: 'offene-punkte', key: 'ueberblick' } as const, '')
const geschlossenA = atom({ plugin: 'offene-punkte', key: 'geschlossen' } as const, {} as Geschlossen)

export async function sicht($: EngineInterface): Promise<Sicht> {
  return { sitzung: z.sitzung, jetzt: await $.clock.now() }
}

export async function zeigeStatus($: EngineInterface) {
  const [punkte, prueft, s] = await Promise.all([read($, punkteA), read($, prueftA), sicht($)])
  $.ui.status(statuszeile(punkte, prueft, s))
}

/** Ab hier zaehlen neue Nummern: hoechste je vergebene, mindestens die hoechste in der Liste. */
export async function nummernAb($: EngineInterface): Promise<number> {
  // Auch den Stand der Datei: eine Sitzung, die sie nie geladen hat (claude -p, nach dem
  // Neuladen der Mod), fing sonst bei 0 an und vergab eine Nummer ein zweites Mal (12.10.2026).
  const o = await ablageOrt($)
  const text = o === null ? '' : await $.fs.read(`${o.ordner}/offen.md`).then(t => String(t)).catch(() => '')
  const dort = text === '' ? null : ablageLesen(text)
  if (dort !== null) await zaehlerHeben($, Math.max(dort.hoechsteNr ?? 0, hoechsteNr(dort.punkte)))
  const [h, punkte] = await Promise.all([read($, hoechsteA), read($, punkteA)])
  return Math.max(h, hoechsteNr(punkte))
}

/** Den Zaehler nachziehen (nie zurueck). */
async function zaehlerHeben($: EngineInterface, n: number) {
  await update($, hoechsteA, h => Math.max(h, n))
}

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

export function ablageOrt($: EngineInterface) {
  z.ort ??= ermittleOrt($).catch(fehler => {
    $.ui.log(`offene-punkte: kein Ablageort (${String(fehler)})`)
    return null
  })
  return z.ort
}

export function windowsHost($: EngineInterface): Promise<boolean> {
  return (z.istWindows ??= $.env.get('OS').then(os => os === 'Windows_NT').catch(() => false))
}

function schlafen($: EngineInterface, ms: number): Promise<void> {
  return new Promise<void>(fertig => { $.clock.after(ms, () => fertig()) })
}

/**
 * Nur eine Sitzung zugleich liest, gleicht ab und schreibt im Ablageordner: sonst gewinnt, wer zuletzt
 * schreibt, und das Schliessen der anderen ging verloren. Die Sperre ist ein Ordner (.sperre) - mkdir
 * gelingt genau einer. Eine Sperre aelter als SPERRE_ALT_MS ist verwaist und wird aufgehoben. Ohne
 * Prozesse (Test, Rechte) oder nach rund drei Sekunden Warten geht es ohne Sperre weiter.
 */
export async function mitSperre<T>($: EngineInterface, fn: () => Promise<T>): Promise<T> {
  const o = await ablageOrt($)
  if (o === null || !(await $.fs.exists(o.ordner).catch(() => false))) return fn()
  const pfad = `${o.ordner}/.sperre`
  const windows = await windowsHost($)
  let gesperrt = false
  for (let versuch = 0; versuch < 30; versuch++) {
    const r = await $.process.run(befehlSperren(pfad, windows)).catch(() => null)
    if (r === null) break
    if (r.exitCode === 0) {
      gesperrt = true
      break
    }
    const st = await $.fs.stat(pfad).catch(() => undefined)
    if (st === undefined) continue
    if ((await $.clock.now()) - st.mtimeMs > SPERRE_ALT_MS) {
      await $.process.run(befehlFreigeben(pfad, windows)).catch(() => undefined)
      continue
    }
    await schlafen($, 100)
  }
  if (!gesperrt) $.ui.log('offene-punkte: ohne Sperre geschrieben')
  try {
    return await fn()
  } finally {
    if (gesperrt) await $.process.run(befehlFreigeben(pfad, windows)).catch(() => undefined)
  }
}

/**
 * Schreibt eine Datei in einem Zug: erst daneben, dann an ihren Platz - wer sie gerade liest
 * (claude-web, eine aeltere Sitzung ohne Sperre), sieht nie einen halben Stand. Haelt ein Leser oder
 * der Virenscanner die Datei kurz fest, scheitert das Verschieben unter Windows: dann noch zweimal
 * versuchen, sonst direkt schreiben und die .tmp wegraeumen (bis 0.17.1 blieb sie liegen).
 */
export async function schreiben($: EngineInterface, datei: string, text: string) {
  const tmp = `${datei}.${(z.sitzung || 'neu').slice(0, 8)}.tmp`
  const windows = await windowsHost($)
  if (!(await $.fs.write(tmp, text).then(() => true).catch(() => false))) return $.fs.write(datei, text)
  for (let versuch = 0; versuch < 3; versuch++) {
    if (versuch > 0) await schlafen($, 150 * versuch)
    const r = await $.process.run(befehlVerschieben(tmp, datei, windows)).catch(() => null)
    if (r === null) break
    if (r.exitCode === 0) return
  }
  await $.fs.write(datei, text)
  await $.process.run(befehlEntfernen([tmp], windows)).catch(() => undefined)
}

/** Was in der Datei steht, in die eigene Liste fuehren - mit den Grabsteinen von dort und von hier. */
async function dateiFuehren($: EngineInterface, dort: Ablage) {
  const [eigene, jetzt] = await Promise.all([read($, punkteA), $.clock.now()])
  const geschlossen = geschlossenFuehren(eigene, jetzt, await read($, geschlossenA), dort.geschlossen)
  await update($, geschlossenA, () => geschlossen)
  await zaehlerHeben($, Math.max(dort.hoechsteNr ?? 0, hoechsteNr(dort.punkte)))
  const ab = Math.max(await read($, hoechsteA), hoechsteNr(eigene))
  await update($, punkteA, alt => abgleichen(alt, dort.punkte, ab, geschlossen))
}

async function dateiStandMerken($: EngineInterface, datei: string) {
  z.dateiStand = await $.fs.stat(datei).then(st => st.mtimeMs).catch(() => 0)
}

/**
 * Schreibt offen.md und offen.json (und neue Zeilen im Tagesverlauf) unter der Sperre. Vorher wird
 * eingelesen, was dort steht: eine andere Sitzung im selben Projekt kann inzwischen Punkte angelegt oder
 * geschlossen haben (mitAbgleich: false beim Leeren).
 */
export async function speichern($: EngineInterface, mitAbgleich = true, verlauf: string[] = []) {
  const o = await ablageOrt($)
  if (o === null) return
  const datei = `${o.ordner}/offen.md`
  await mitSperre($, async () => {
    const jetzt = await $.clock.now()
    if (verlauf.length > 0) {
      const vd = `${o.ordner}/antworten-${datum(jetzt)}.md`
      const alt = await $.fs.read(vd).then(t => String(t)).catch(() => verlaufKopf(jetzt))
      // Unter der Sperre direkt: hier schreibt niemand dazwischen.
      await $.fs.write(vd, `${alt}\n${verlauf.join('\n')}`)
        .catch(fehler => $.ui.log(`offene-punkte: Verlauf nicht geschrieben (${String(fehler)})`))
    }
    if (mitAbgleich) {
      const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
      const dort = text === '' ? null : ablageLesen(text)
      if (dort !== null) await dateiFuehren($, dort)
    }
    const liste = await read($, punkteA)
    await zaehlerHeben($, hoechsteNr(liste))
    const geschlossen = geschlossenFuehren(liste, jetzt, await read($, geschlossenA))
    await update($, geschlossenA, () => geschlossen)
    const [punkte, ueberblick, h] = await Promise.all([read($, punkteA), read($, ueberblickA), read($, hoechsteA)])
    const daten = { punkte, ueberblick, hoechsteNr: h, geschlossen }
    await Promise.all([
      schreiben($, datei, ablageText(daten, jetzt))
        .catch(fehler => $.ui.log(`offene-punkte: offen.md nicht geschrieben (${String(fehler)})`)),
      // Dieselben Daten als reine JSON-Datei fuer claude-web; der Block in offen.md bleibt fuer aeltere Sitzungen.
      schreiben($, `${o.ordner}/offen.json`, `${ablageDaten(daten, jetzt, z.installiert)}\n`)
        .catch(fehler => $.ui.log(`offene-punkte: offen.json nicht geschrieben (${String(fehler)})`)),
    ])
    await dateiStandMerken($, datei)
  })
}

/**
 * Hat eine andere Sitzung offen.md geschrieben (Aenderungszeit), kommt ihr Stand jetzt schon herein -
 * nicht erst, wenn diese Sitzung selbst schreibt. Sonst fragte sie weiter, was dort laengst beantwortet
 * ist. Liest nur (kein Schreiben, kein Pingpong); kostet ohne Aenderung einen stat.
 */
export async function nachladen($: EngineInterface) {
  const o = await ablageOrt($)
  if (o === null) return
  const datei = `${o.ordner}/offen.md`
  const st = await $.fs.stat(datei).catch(() => undefined)
  if (st === undefined || st.mtimeMs === z.dateiStand) return
  const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
  const dort = text === '' ? null : ablageLesen(text)
  // Halb gelesen (eine aeltere Sitzung schreibt ohne Sperre): beim naechsten Mal wieder.
  if (dort === null) return
  z.dateiStand = st.mtimeMs
  await dateiFuehren($, dort)
  await zeigeStatus($)
}

/**
 * Lebenszeichen: .sitzungen/<id> im Ablageordner, hoechstens einmal je Minute aus dem Eingangstakt
 * geschrieben. Wer startet, uebernimmt nur Punkte von Sitzungen ohne frisches Zeichen.
 */
export async function lebenszeichen($: EngineInterface) {
  const jetzt = await $.clock.now()
  if (z.sitzung === '' || jetzt - z.lebtGeschrieben < 60_000) return
  const o = await ablageOrt($)
  if (o === null) return
  z.lebtGeschrieben = jetzt
  await $.fs.write(`${o.ordner}/.sitzungen/${z.sitzung}`, `${jetzt}\n`).catch(() => undefined)
}

/** Beendet (Ende, /clear): das Zeichen weg, damit die naechste Sitzung die Punkte gleich uebernimmt. */
export async function lebenszeichenWeg($: EngineInterface, id: string) {
  const o = await ablageOrt($)
  if (o === null || id === '') return
  z.lebtGeschrieben = 0
  await $.process.run(befehlEntfernen([`${o.ordner}/.sitzungen/${id}`], await windowsHost($))).catch(() => undefined)
}

/** Die anderen Sitzungen im Projekt, die gerade laufen. */
async function lebende($: EngineInterface): Promise<Set<string>> {
  const o = await ablageOrt($)
  if (o === null) return new Set()
  const [l, jetzt] = await Promise.all([$.fs.list(`${o.ordner}/.sitzungen`).catch(() => []), $.clock.now()])
  return new Set(l.filter(e => e.kind === 'file' && e.name !== z.sitzung && jetzt - e.mtimeMs < LEBT_MS).map(e => e.name))
}

/** Zum Start: Reste gescheiterter Schreibvorgaenge (*.tmp, aelter als zehn Minuten) und alte Lebenszeichen wegraeumen. */
export async function resteAufraeumen($: EngineInterface) {
  const o = await ablageOrt($)
  if (o === null) return
  const jetzt = await $.clock.now()
  const reste = alteReste(await $.fs.list(o.ordner).catch(() => []), jetzt).map(n => `${o.ordner}/${n}`)
  const zeichen = (await $.fs.list(`${o.ordner}/.sitzungen`).catch(() => []))
    .filter(e => e.kind === 'file' && e.mtimeMs > 0 && jetzt - e.mtimeMs > 24 * 3600_000).map(e => `${o.ordner}/.sitzungen/${e.name}`)
  if (reste.length + zeichen.length === 0) return
  await $.process.run(befehlEntfernen([...reste, ...zeichen], await windowsHost($)))
  $.ui.log(`offene-punkte: ${reste.length} alte .tmp und ${zeichen.length} alte Lebenszeichen entfernt`)
}

/**
 * Versionsdrift: Sitzungen laufen tagelang und laden Updates erst beim Neustart. Weicht die installierte
 * Fassung von der laufenden ab, sagt es ein Toast, und offen.json traegt "installiert" fuer claude-web.
 */
export async function versionPruefen($: EngineInterface) {
  // Die laufende Fassung steht in der plugin.json des geladenen Ordners (je Fassung ein eigener im Cache) -
  // so kann sie nicht hinter dem Manifest zurückbleiben.
  const root = String($.plugin.root ?? '').replace(/[\\/]+$/, '')
  if (root !== '') laufendeVersionSetzen(manifestVersion(await $.fs.read(`${root}/.claude-plugin/plugin.json`).then(t => String(t)).catch(() => '')))
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined))
  if (home === undefined) return
  const text = await $.fs.read(`${home.replace(/[\\/]+$/, '')}/.claude/plugins/installed_plugins.json`).then(t => String(t)).catch(() => '')
  z.installiert = installierteVersion(text)
  if (neuerAlsLaufend(z.installiert)) {
    $.ui.toast(`offene-punkte ${z.installiert} ist installiert, diese Sitzung läuft noch ${laufendeVersion()} – ein Neustart lädt die neue Fassung`, { timeoutMs: 10_000 })
    $.ui.log(`offene-punkte: läuft ${laufendeVersion()}, installiert ${z.installiert}`)
  }
}

/** Eine Zeile an kosten.jsonl im Projektordner anhaengen; ab 200 kB bleibt der juengere Teil. */
export async function kostenSchreiben($: EngineInterface, zeile: string) {
  const o = await ablageOrt($)
  if (o === null) return
  const datei = `${o.ordner}/kosten.jsonl`
  const alt = await $.fs.read(datei).then(t => String(t)).catch(() => '')
  const basis = alt.length > 200_000 ? alt.slice(alt.indexOf('\n', alt.length - 150_000) + 1) : alt
  await $.fs.write(datei, `${basis}${zeile}\n`).catch(() => undefined)
}

/** Liste aendern; was dabei geschlossen oder wieder geoeffnet wird, geht in den Verlauf. Alles landet in der Datei. */
export async function aendere($: EngineInterface, fn: (liste: Punkt[]) => Punkt[]): Promise<Punkt[]> {
  const vorher = await read($, punkteA)
  const jetzt = await $.clock.now()
  await update($, punkteA, alt => stempeln(alt, fn(alt), jetzt))
  const nachher = await read($, punkteA)
  const alt = new Map(vorher.map(p => [p.id, p]))
  // Auch was fn gleich wieder aus der Liste genommen hat: sein Grabstein entsteht hier.
  await update($, geschlossenA, g => geschlossenFuehren([...vorher, ...nachher].filter(p => p.status !== 'offen'), jetzt, g))
  await speichern($, true, verlaufsEintraege(vorher, nachher, jetzt))
  await zeigeStatus($)
  // Was gerade geschlossen wurde, damit der Aufrufer davon erzaehlen kann.
  return nachher.filter(p => p.status !== 'offen' && alt.get(p.id)?.status === 'offen')
}

/** Zu Beginn einer Sitzung (oder nach /clear) die Punkte aus der Datei uebernehmen. */
export async function laden($: EngineInterface) {
  const [punkte, ueberblick] = await Promise.all([read($, punkteA), read($, ueberblickA)])
  if (punkte.length > 0 || ueberblick !== '') return
  const o = await ablageOrt($)
  if (o === null) return
  const text = await $.fs.read(`${o.ordner}/offen.md`).then(t => String(t)).catch(() => '')
  const a = text === '' ? null : ablageLesen(text)
  if (a === null) return
  await zaehlerHeben($, a.hoechsteNr ?? 0)
  const jetzt = await $.clock.now()
  const geschlossen = geschlossenFuehren(a.punkte, jetzt, await read($, geschlossenA), a.geschlossen)
  await update($, geschlossenA, () => geschlossen)
  z.dateiStand = await $.fs.stat(`${o.ordner}/offen.md`).then(st => st.mtimeMs).catch(() => 0)
  // Was die letzte Sitzung offen liess, fuehrt jetzt diese - nicht aber, was eine laufende Sitzung fuehrt.
  const lebend = await lebende($)
  await update($, punkteA, () => uebernehmen(zuGeschlossen(a.punkte, geschlossen), z.sitzung, undefined, lebend))
  await update($, ueberblickA, () => a.ueberblick)
  await zeigeStatus($)
  const n = fragbar(await read($, punkteA), await sicht($)).length
  if (n > 0) $.ui.toast(n === 1 ? '1 offener Punkt aus der letzten Sitzung übernommen · /offen' : `${n} offene Punkte aus der letzten Sitzung übernommen · /offen`)
}

/** Was seit diesem Zeitpunkt entschieden wurde, aus den Tagesverlaeufen (auch anderer Sitzungen im Projekt). */
export async function entscheidungenSeit($: EngineInterface, seit: number): Promise<string> {
  const o = await ablageOrt($)
  if (o === null) return ''
  const ab = `antworten-${datum(seit)}.md`
  const namen = await $.fs.list(o.ordner).then(l => l.filter(x => x.kind === 'file').map(x => x.name)).catch((): string[] => [])
  const tage = namen.filter(n => /^antworten-\d{4}-\d{2}-\d{2}\.md$/.test(n) && n >= ab).sort().slice(-7)
  const texte = await Promise.all(tage.map(n => $.fs.read(`${o.ordner}/${n}`).then(t => String(t)).catch(() => '')))
  return entscheidungenAus(texte)
}

/**
 * Zum Start: der Zaehler kennt auch Nummern, die nur noch im Verlauf stehen (offen.md
 * geloescht oder aelter) - eine Nummer wird nie zweimal vergeben.
 */
export async function zaehlerLaden($: EngineInterface) {
  const o = await ablageOrt($)
  if (o === null) return
  const namen = await $.fs.list(o.ordner).then(l => l.filter(x => x.kind === 'file').map(x => x.name)).catch((): string[] => [])
  for (const name of namen.filter(n => /^antworten-[\d-]+\.md$/.test(n))) {
    const text = await $.fs.read(`${o.ordner}/${name}`).then(t => String(t)).catch(() => '')
    await zaehlerHeben($, hoechsteImVerlauf(text))
  }
}

/** Tagesverlaeufe, die aelter als 30 Tage sind, kommen in die Monatsdatei antworten-JJJJ-MM.md. */
export async function verlaufAufraeumen($: EngineInterface) {
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
