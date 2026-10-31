// offen.md, offen.json, Tagesverläufe, Sperre und Lebenszeichen
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { nrText } from './marken'
import { ABGLEICH_TAKT_MS, laufend } from './grund'
import { optionenLesen, stufe, text } from './auftraege'
import { ERKANNT, begrenzen, doppelteLoesen, geschlossenLesen, hoechsteNr, nummerieren, offene, vermerk, zuruecknehmen } from './punkte'
import type { Geschlossen } from './punkte'

/** Was zwischen den Sitzungen in der Datei steht. */
export type Ablage = {
  punkte: Punkt[]
  ueberblick: string
  /** Höchste je vergebene Nummer; fehlt bei älteren Dateien (dann die höchste in der Liste). */
  hoechsteNr?: number
  /** Geschlossene Punkte je Kennung (ab 0.17.2); fehlt bei älteren Dateien. */
  geschlossen?: Geschlossen
}

const DATEN_ANFANG = '<!-- offene-punkte-daten'

export const zweistellig = (n: number) => String(n).padStart(2, '0')

export const datum = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`
}

export const uhrzeit = (ms: number): string => {
  const d = new Date(ms)
  return `${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`
}

const optionenText = (p: Punkt) => (p.mehrfach === true ? '   (mehrere möglich)\n' : '') + p.optionen
  .map((o, i) => `   ${String.fromCharCode(97 + i)}) ${o.label}${o.antwort !== '' ? ` – „${o.antwort}“` : ''}`)
  .join('\n')

/**
 * Die Datei mit den offenen Punkten: oben lesbar, unten die Daten für die
 * nächste Sitzung in einem HTML-Kommentar.
 */
/** Die zuletzt geschlossenen Punkte, neueste zuerst (nach Schließzeit, nicht nach Listenplatz). */
export const zuletztFertig = (punkte: readonly Punkt[], n = 8): Punkt[] =>
  punkte.filter(p => p.status !== 'offen').sort((x, y) => (y.geaendert ?? y.erstellt) - (x.geaendert ?? x.erstellt)).slice(0, n)

/** Die Daten für die nächste Sitzung und für claude-web (offen.json) - mit Fassung und Zeitpunkt des Schreibens. */
export const ablageDaten = (a: Ablage, jetzt: number, installiert = ''): string =>
  JSON.stringify({
    punkte: a.punkte, ueberblick: a.ueberblick, hoechsteNr: Math.max(a.hoechsteNr ?? 0, hoechsteNr(a.punkte)),
    ...(a.geschlossen !== undefined && Object.keys(a.geschlossen).length > 0 ? { geschlossen: a.geschlossen } : {}),
    version: laufend, stand: jetzt,
    // Die installierte Fassung, wenn sie von der laufenden abweicht: die Sitzung braucht einen Neustart.
    ...(installiert !== '' && installiert !== laufend ? { installiert } : {}),
  })

export function ablageText(a: Ablage, jetzt: number): string {
  // Auch was beantwortet, aber noch nicht bei Claude ist: es kommt in der nächsten Sitzung wieder.
  const liste = offene(zuruecknehmen(a.punkte))
  const fertig = zuletztFertig(a.punkte)
  const teile = [`# Offene Punkte\n\nStand: ${datum(jetzt)} ${uhrzeit(jetzt)} · wird von offene-punkte geschrieben, Änderungen hier gehen verloren.`]
  if (a.ueberblick !== '') teile.push(`## Überblick\n\n${a.ueberblick}`)
  teile.push(liste.length === 0
    ? '## Offen\n\nNichts offen.'
    : '## Offen\n\n' + liste.map((p, i) => [
      `### ${p.nr ?? i + 1}. ${p.art === 'aufgabe' ? 'Zu tun: ' : ''}${p.titel}${vermerk(p, { sitzung: '', jetzt })}`,
      p.frage,
      p.info !== '' ? `_${p.info}_` : '',
      (p.abwaegung ?? '') !== '' ? `Abwägung: ${p.abwaegung}` : '',
      p.anleitung,
      p.optionen.length > 0 ? `Möglichkeiten:\n${optionenText(p)}` : '',
    ].filter(t => t !== '').join('\n\n')).join('\n\n'))
  if (fertig.length > 0) teile.push('## Zuletzt erledigt\n\n' + fertig.map(p => `- ${p.status === 'verworfen' ? '✗' : p.auto !== undefined ? '🤖' : '✓'} ${p.titel}${p.ergebnis ? `: ${p.ergebnis}` : ''}`).join('\n'))
  // "-->" darf im Kommentar nicht vorkommen; in JSON-Zeichenketten ist > dasselbe Zeichen.
  const daten = ablageDaten(a, jetzt).replace(/-->/g, '--\\u003e')
  teile.push(`${DATEN_ANFANG}\n${daten}\n-->`)

  return teile.join('\n\n') + '\n'
}

/** Liest die Daten aus der Datei; was nicht passt, fällt weg. */
export function ablageLesen(inhalt: string): Ablage | null {
  const start = inhalt.lastIndexOf(DATEN_ANFANG)
  if (start < 0) return null
  const ende = inhalt.indexOf('\n-->', start)
  if (ende < 0) return null
  let d: unknown
  try {
    d = JSON.parse(inhalt.slice(start + DATEN_ANFANG.length, ende))
  } catch {
    return null
  }
  if (typeof d !== 'object' || d === null) return null
  const roh = d as { punkte?: unknown; ueberblick?: unknown; hoechsteNr?: unknown; geschlossen?: unknown }
  const punkte: Punkt[] = []
  for (const x of Array.isArray(roh.punkte) ? roh.punkte : []) {
    if (typeof x !== 'object' || x === null) continue
    const p = x as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.titel !== 'string' || typeof p.frage !== 'string') continue
    const status = p.status === 'erledigt' || p.status === 'verworfen' ? p.status : 'offen'
    punkte.push({
      id: p.id,
      ...(typeof p.nr === 'number' ? { nr: p.nr } : {}),
      titel: p.titel,
      frage: p.frage,
      info: text(p.info, 300),
      art: p.art === 'aufgabe' ? 'aufgabe' : 'entscheidung',
      stufe: stufe(p.stufe) ?? 'normal',
      abwaegung: text(p.abwaegung, 800),
      anleitung: text(p.anleitung, 4000),
      optionen: optionenLesen(p.optionen),
      ...(p.mehrfach === true ? { mehrfach: true } : {}),
      status,
      zurueckgestellt: typeof p.zurueckgestellt === 'number' ? p.zurueckgestellt : 0,
      ohneBezug: typeof p.ohneBezug === 'number' ? p.ohneBezug : 0,
      erstellt: typeof p.erstellt === 'number' ? p.erstellt : 0,
      ...(typeof p.ergebnis === 'string' ? { ergebnis: p.ergebnis } : {}),
      ...(typeof p.sitzung === 'string' ? { sitzung: p.sitzung } : {}),
      ...(typeof p.geaendert === 'number' ? { geaendert: p.geaendert } : {}),
      ...(typeof p.geprueft === 'number' ? { geprueft: p.geprueft } : {}),
      ...(ruheLesen(p.ruht) ?? {}),
      ...(p.vonNutzer === true ? { vonNutzer: true } : {}),
      ...(autoLesen(p.auto) ?? {}),
    })
  }

  const ab = typeof roh.hoechsteNr === 'number' ? roh.hoechsteNr : 0
  const liste = nummerieren(begrenzen(doppelteLoesen(punkte)), ab)
  return { punkte: liste, ueberblick: text(roh.ueberblick, 2000), hoechsteNr: Math.max(ab, hoechsteNr(liste)), geschlossen: geschlossenLesen(roh.geschlossen) }
}

function autoLesen(x: unknown): { auto: { grund: string; zeit: number } } | undefined {
  if (typeof x !== 'object' || x === null) return undefined
  const a = x as Record<string, unknown>
  return typeof a.zeit === 'number' ? { auto: { grund: text(a.grund, 120) || ERKANNT, zeit: a.zeit } } : undefined
}

function ruheLesen(x: unknown): { ruht: Ruhe } | undefined {
  if (typeof x !== 'object' || x === null) return undefined
  const r = x as Record<string, unknown>
  if (typeof r.bis === 'number') return { ruht: { bis: r.bis } }
  if (typeof r.sitzung === 'string') return { ruht: { sitzung: r.sitzung, ...(r.interview === true ? { interview: true as const } : {}) } }
  return undefined
}

/** Was sich zwischen zwei Ständen der Liste für den Verlauf getan hat. */
export function verlaufsEintraege(vorher: readonly Punkt[], nachher: readonly Punkt[], jetzt: number): string[] {
  const alt = new Map(vorher.map(p => [p.id, p]))
  const eintraege: string[] = []
  for (const p of nachher) {
    const war = alt.get(p.id)
    if (war === undefined) continue
    if (war.status === 'offen' && p.status !== 'offen') eintraege.push(verlaufsEintrag(p, jetzt))
    if (war.status !== 'offen' && p.status === 'offen') eintraege.push(`## ${uhrzeit(jetzt)} · ${nrText(p)}${p.titel} – wieder geöffnet\n`)
  }
  return eintraege
}

/** Höchste Nummer in einem Verlauf ("## 09:12 · #12 Titel – entschieden"; Monatsdatei mit ###). */
export function hoechsteImVerlauf(text: string): number {
  let n = 0
  for (const m of text.matchAll(/^#{2,3} \d{2}:\d{2} · #(\d+) /gm)) n = Math.max(n, Number(m[1]))
  return n
}

function verlaufsEintrag(p: Punkt, jetzt: number): string {
  // Ohne Zutun geschlossen (Auswertung, Marke, Abgleich, Sammelschluss): niemand hat eine Möglichkeit
  // gewählt, also nur Frage und Grund - solche Einträge waren über die Hälfte des Verlaufs.
  const auto = p.auto !== undefined || /^gesammelt /.test(p.ergebnis ?? '')
  const wie = p.status === 'verworfen' ? 'verworfen'
    : auto ? (/überholt/.test(p.ergebnis ?? '') ? 'überholt' : 'automatisch geschlossen')
      : p.art === 'aufgabe' ? 'erledigt' : 'entschieden'
  if (auto) return [`## ${uhrzeit(jetzt)} · ${nrText(p)}${p.titel} – ${wie}`, `**Frage:** ${p.frage}`, `**Ergebnis:** ${p.ergebnis ?? wie}`].join('\n\n') + '\n'
  return [
    `## ${uhrzeit(jetzt)} · ${nrText(p)}${p.titel} – ${wie}`,
    `**Frage:** ${p.frage}`,
    p.info !== '' ? `**Warum offen:** ${p.info}` : '',
    (p.abwaegung ?? '') !== '' ? `**Abwägung:** ${p.abwaegung}` : '',
    p.optionen.length > 0 ? `**Möglichkeiten:**\n${optionenText(p)}` : '',
    `**Ergebnis:** ${p.ergebnis ?? wie}`,
  ].filter(t => t !== '').join('\n\n') + '\n'
}

export const verlaufKopf = (ms: number): string => `# Antworten auf offene Punkte – ${datum(ms)}\n\nWas entschieden, erledigt oder verworfen wurde, mit den Gründen von damals.\n`

/** Nach so vielen Tagen wandert ein Tagesverlauf in die Monatsdatei. */
export const VERLAUF_TAGE = 30

/** Die Tagesverläufe, die älter als VERLAUF_TAGE sind, nach Monat (JJJJ-MM → Tage JJJJ-MM-TT, älteste zuerst). */
export function alteVerlaeufe(namen: readonly string[], jetzt: number): Map<string, string[]> {
  const grenze = datum(jetzt - VERLAUF_TAGE * 86_400_000)
  const monate = new Map<string, string[]>()
  for (const name of [...namen].sort()) {
    const m = /^antworten-((\d{4}-\d{2})-\d{2})\.md$/.exec(name)
    if (m === null || m[1]! >= grenze) continue
    monate.set(m[2]!, [...(monate.get(m[2]!) ?? []), m[1]!])
  }
  return monate
}

export const monatsKopf = (monat: string): string =>
  `# Antworten auf offene Punkte – ${monat}\n\nWas entschieden, erledigt oder verworfen wurde, mit den Gründen von damals; ein Abschnitt je Tag.\n`

/** Hängt einen Tagesverlauf an die Monatsdatei (Überschriften eine Stufe tiefer); null: der Tag steht schon darin. */
export function tagAnhaengen(monat: string, tag: string, tagesText: string): string | null {
  const marke = `## ${tag}\n`
  if (monat.split('\n').some(z => `${z}\n` === marke)) return null
  const rumpf = tagesText.replace(/^# [^\n]*\n+(Was entschieden[^\n]*\n)?/, '').replace(/^## /gm, '### ').trim()
  return `${monat.trimEnd()}\n\n${marke}\n${rumpf}\n`
}

/** Ordnername für die Ablage außerhalb eines Git-Repos: der Projektpfad, lesbar. */
export const ordnerName = (wurzel: string): string =>
  wurzel.replace(/^[A-Za-z]:/, '').replace(/[\\/]+/g, '-').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^-+|-+$/g, '') || 'wurzel'

/** Zeile, die in .git/info/exclude stehen muss. */
export const AUSNAHME = '/offene-punkte/'

/** Ergänzt die Ausnahme-Datei um die Zeile, falls sie fehlt; null: nichts zu tun. */
export function ausnahmeErgaenzen(inhalt: string): string | null {
  if (inhalt.split(/\r?\n/).some(z => z.trim() === AUSNAHME)) return null
  return `${inhalt}${inhalt === '' || inhalt.endsWith('\n') ? '' : '\n'}# offene-punkte (Claude-Code-Mod)\n${AUSNAHME}\n`
}

/** Ein Lebenszeichen, das älter ist, gehört einer Sitzung, die nicht mehr läuft. */
export const LEBT_MS = 5 * 60_000

/** Eine Sperre, die länger steht, gehört einer Sitzung, die mittendrin beendet wurde. */
export const SPERRE_ALT_MS = 15_000

/** Nach so langer Zeit gilt eine liegengebliebene .tmp als Rest eines gescheiterten Schreibens. */
export const REST_ALT_MS = 10 * 60_000

const winPfad = (p: string) => p.replace(/\//g, '\\')

/** mkdir gelingt nur, wenn der Ordner noch fehlt - unter Windows wie unter Unix ein Schritt: die Sperre. */
export const befehlSperren = (pfad: string, windows: boolean): string[] =>
  windows ? ['cmd', '/c', 'mkdir', winPfad(pfad)] : ['mkdir', pfad]

export const befehlFreigeben = (pfad: string, windows: boolean): string[] =>
  windows ? ['cmd', '/c', 'rmdir', winPfad(pfad)] : ['rmdir', pfad]

export const befehlVerschieben = (von: string, nach: string, windows: boolean): string[] =>
  windows ? ['cmd', '/c', 'move', '/y', winPfad(von), winPfad(nach)] : ['mv', '-f', von, nach]

export const befehlEntfernen = (dateien: readonly string[], windows: boolean): string[] =>
  windows ? ['cmd', '/c', 'del', '/q', ...dateien.map(winPfad)] : ['rm', '-f', ...dateien]

/** Reste gescheiterter Schreibvorgänge im Ablageordner (offen.md.<sitzung>.tmp usw.), die alt genug sind. */
export const alteReste = (eintraege: readonly { name: string; kind: string; mtimeMs: number }[], jetzt: number): string[] =>
  eintraege
    .filter(e => e.kind === 'file' && /\.[\w-]{1,8}\.tmp$/.test(e.name) && e.mtimeMs > 0 && jetzt - e.mtimeMs >= REST_ALT_MS)
    .map(e => e.name)

/**
 * abgleich.txt: wann zuletzt eine Sitzung im Projekt den Abgleich gemacht hat („<ms> <sitzung>“). Den
 * stündlichen Abgleich braucht das Projekt nur einmal, nicht einmal je Sitzung.
 */
export function abgleichFaellig(text: string, jetzt: number): boolean {
  const zuletzt = Number(/^\s*(\d+)/.exec(text)?.[1] ?? 0)
  // Etwas Spielraum, damit der Takt der Sitzung, die ihn zuletzt gemacht hat, nicht knapp verpasst.
  return !(zuletzt > 0 && zuletzt <= jetzt && jetzt - zuletzt < ABGLEICH_TAKT_MS - 5 * 60_000)
}
