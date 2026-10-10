import type { Art, Option, Punkt, Stufe } from '../types'

/** Höchstens so viele offene Punkte führt der Mod; ältere fallen hinten weg. */
export const MAX_PUNKTE = 30
/** So viel der Antwort bekommt Haiku (der Schluss zählt am meisten). */
export const MAX_ANTWORT = 12_000
/** Nach so vielen Auswertungen ohne Bezug fragt der Mod, ob ein Punkt noch aktuell ist. */
export const VERALTET_NACH = 10

/** Fester Teil des Auftrags - steht vorn, damit der Prompt-Cache ihn hält. */
export const AUFTRAG = `Du liest die letzte Antwort eines Coding-Assistenten an seinen Nutzer und findest OFFENE PUNKTE: Dinge, die noch nicht erledigt sind und eine Entscheidung, Freigabe, Zuarbeit oder Prüfung des Nutzers brauchen - besonders solche, die leicht untergehen.

Typisch: "vor dem Freischalten brauche ich von dir ...", Freigaben zum Ausrollen/Löschen/Pushen, Texte oder Zugangsdaten, die der Nutzer liefern muss, Abnahmen und Prüfungen von Hand ("prüfe bitte ...", "noch offen ..."), Entscheidungen zwischen Varianten, angebotene nächste Schritte ("soll ich ...?", "könnte ich auch vorziehen").

Kein offener Punkt: was der Assistent schon erledigt hat, reine Erklärungen, Selbstverständliches, Dinge ohne Zutun des Nutzers.

Jeder Punkt hat eine "art": "entscheidung", wenn der Nutzer nur wählen oder freigeben muss; "aufgabe", wenn er selbst etwas tun muss (etwas auf seinem Rechner ausführen, einrichten, Daten liefern, von Hand prüfen). Bei einer Aufgabe schreibe in "anleitung", was genau zu tun ist, so dass der Nutzer NICHT im Verlauf suchen muss: nummerierte Schritte, alle Befehle, Pfade, Dateinamen, Einstellungen und Werte WÖRTLICH aus der Antwort, Befehle und Dateiinhalte in Markdown-Codeblöcken (Shell-Befehle mit \`\`\`bash). Nichts erfinden, nichts weglassen, was zum Ausführen nötig ist. Bei einer Entscheidung bleibt "anleitung" leer, außer ein Satz Kontext hilft beim Entscheiden.

Jeder Punkt hat eine "stufe": "blockiert", wenn der Assistent ohne den Nutzer nicht weitermachen kann (Freigabe, fehlende Zugangsdaten, Entscheidung, an der die weitere Arbeit hängt); "angebot", wenn der Assistent nur etwas Zusätzliches anbietet ("könnte ich auch noch ...", "falls du willst ..."); sonst "normal".

In "abwaegung" stehen die Argumente aus der Antwort, die für die Entscheidung zählen (Vor- und Nachteile, Gründe, Empfehlung des Assistenten), höchstens drei Sätze - damit man später nachvollziehen kann, warum so entschieden wurde. Nichts erfinden; gibt die Antwort keine Gründe her, bleibt es leer.

Für jeden neuen Punkt: eine kurze Frage an den Nutzer und 2 bis 4 Antwortmöglichkeiten. Jede Möglichkeit hat ein kurzes "label" (höchstens 5 Wörter) und eine "antwort": der Satz, den der Nutzer dem Assistenten damit schickt (Ich-Form, konkret, z. B. "Ja, rolle es aus."). Hat der Nutzer etwas selbst zu tun, gib eine Möglichkeit mit leerer "antwort" und einem label wie "Erledige ich selbst". Braucht eine Antwort noch eine Eingabe des Nutzers (eigener Text, eine Zahl), ende die "antwort" mit einem Doppelpunkt - sie wird dann nur vorbereitet, nicht abgeschickt. Eine Möglichkeit für eine freie eigene Antwort brauchst du nicht, die gibt es immer.

Außerdem führst du einen kurzen ÜBERBLICK über die ganze Sitzung, damit der Nutzer den Faden behält: Schreibe den bisherigen Überblick (unten) mit dem Neuen aus der Antwort fort. Markdown, höchstens 8 Zeilen, als Liste mit diesen fett gesetzten Anfängen, nur wenn es etwas dazu gibt: **Ziel:** worum es in der Sitzung geht · **Erledigt:** die wichtigsten Ergebnisse (knapp, neueste zuerst, Älteres zusammenfassen) · **Gerade:** woran zuletzt gearbeitet wurde · **Als Nächstes:** der nächste Schritt. Keine Wiederholung der offenen Punkte.

Bereits bekannte offene Punkte stehen unten mit ID. Melde sie NICHT erneut als neu, auch nicht mit anderen Worten. Für jeden bekannten Punkt gilt:
- durch die neue Antwort oder die letzte Nachricht des Nutzers erledigt: ID unter "erledigt";
- noch offen, aber die Antwort bringt Neues dazu (genauere Anleitung, geänderte Frage oder Möglichkeiten, andere Stufe): unter "aktualisiert" mit seiner ID und NUR den Feldern, die sich ändern;
- noch offen und die Antwort oder die Nachricht des Nutzers geht darauf ein, ohne dass sich etwas ändert: ID unter "erwaehnt".

Antworte NUR mit JSON, ohne Erklärung, in genau dieser Form:
{"neu":[{"titel":"2-5 Wörter","art":"aufgabe","stufe":"normal","frage":"Ein Satz?","info":"Warum offen, ein Satz.","abwaegung":"","anleitung":"1. ...\n\`\`\`bash\nbefehl\n\`\`\`","optionen":[{"label":"...","antwort":"..."}]}],"aktualisiert":[{"id":"...","anleitung":"..."}],"erledigt":["id"],"erwaehnt":["id"],"ueberblick":"- **Ziel:** ..."}
Gibt es nichts davon: {"neu":[],"aktualisiert":[],"erledigt":[],"erwaehnt":[],"ueberblick":"..."}`

/** Der wechselnde Teil: bekannte Punkte, letzte Nachricht des Nutzers, die Antwort(en). */
export function anfrage(antworten: string | readonly string[], letzteEingabe: string, offene: readonly Punkt[], ueberblick = ''): string {
  const bekannt = offene.length === 0
    ? '(keine)'
    : offene.map(p => `- ${p.id}: ${p.titel} - ${p.frage}`).join('\n')

  return `BISHERIGER ÜBERBLICK:\n${ueberblick || '(noch keiner)'}\n\nBEKANNTE OFFENE PUNKTE:\n${bekannt}\n\nLETZTE NACHRICHT DES NUTZERS:\n${letzteEingabe.slice(0, 2000) || '(keine)'}\n\n${antwortTeil(antworten)}`
}

/**
 * Eine Antwort, oder mehrere, die waehrend einer laufenden Auswertung kamen. Jede
 * behaelt ihren Schluss - dort stehen die Fragen.
 */
function antwortTeil(antworten: string | readonly string[]): string {
  const liste = typeof antworten === 'string' ? [antworten] : antworten
  const kuerzen = (t: string, max: number) => (t.length > max ? '…' + t.slice(-max) : t)
  if (liste.length === 1) return `ANTWORT DES ASSISTENTEN:\n${kuerzen(liste[0] ?? '', MAX_ANTWORT)}`
  const anteil = Math.floor(MAX_ANTWORT / liste.length)

  return `ANTWORTEN DES ASSISTENTEN (${liste.length}, älteste zuerst):\n` +
    liste.map((t, i) => `--- Antwort ${i + 1} ---\n${kuerzen(t, anteil)}`).join('\n\n')
}

/** Felder, die Haiku an einem bekannten Punkt nachschärfen darf. */
export type Aenderung = { id: string } & Partial<Pick<Punkt, 'frage' | 'info' | 'anleitung' | 'abwaegung' | 'optionen' | 'stufe'>>

export type Auswertung = {
  neu: { titel: string; art: Art; stufe: Stufe; frage: string; info: string; abwaegung: string; anleitung: string; optionen: Option[] }[]
  aktualisiert: Aenderung[]
  erledigt: string[]
  erwaehnt: string[]
  /** Fortgeschriebener Überblick; leer, wenn das Modell keinen geliefert hat. */
  ueberblick: string
}

const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.trim().slice(0, max) : '')
const stufe = (x: unknown): Stufe | undefined => (x === 'blockiert' || x === 'normal' || x === 'angebot' ? x : undefined)
const ids = (x: unknown): string[] => (Array.isArray(x) ? x : []).filter((y): y is string => typeof y === 'string')

function optionenLesen(x: unknown): Option[] {
  const optionen: Option[] = []
  for (const o of Array.isArray(x) ? x : []) {
    if (typeof o !== 'object' || o === null) continue
    const label = text((o as Record<string, unknown>).label, 60)
    if (label === '' || optionen.some(y => y.label === label)) continue
    optionen.push({ label, antwort: text((o as Record<string, unknown>).antwort, 600) })
  }
  return optionen.slice(0, 4)
}

/** Liest Haikus Antwort; was nicht passt, fällt weg. Unlesbar: null. */
export function lies(roh: string): Auswertung | null {
  const start = roh.indexOf('{')
  const ende = roh.lastIndexOf('}')
  if (start < 0 || ende <= start) return null

  let daten: unknown
  try {
    daten = JSON.parse(roh.slice(start, ende + 1))
  } catch {
    return null
  }
  if (typeof daten !== 'object' || daten === null) return null
  const d = daten as Record<string, unknown>

  const neu: Auswertung['neu'] = []
  for (const roherPunkt of Array.isArray(d.neu) ? d.neu : []) {
    if (typeof roherPunkt !== 'object' || roherPunkt === null) continue
    const p = roherPunkt as Record<string, unknown>
    const optionen = optionenLesen(p.optionen)
    const titel = text(p.titel, 80)
    const frage = text(p.frage, 300)
    if (titel === '' || frage === '' || optionen.length === 0) continue
    const art: Art = p.art === 'aufgabe' ? 'aufgabe' : 'entscheidung'
    neu.push({
      titel, art, stufe: stufe(p.stufe) ?? 'normal', frage, info: text(p.info, 300),
      abwaegung: text(p.abwaegung, 800), anleitung: text(p.anleitung, 4000), optionen,
    })
  }

  const aktualisiert: Aenderung[] = []
  for (const roh of Array.isArray(d.aktualisiert) ? d.aktualisiert : []) {
    if (typeof roh !== 'object' || roh === null) continue
    const a = roh as Record<string, unknown>
    if (typeof a.id !== 'string') continue
    const aenderung: Aenderung = { id: a.id }
    for (const [feld, max] of [['frage', 300], ['info', 300], ['anleitung', 4000], ['abwaegung', 800]] as const) {
      const wert = text(a[feld], max)
      if (wert !== '') aenderung[feld] = wert
    }
    const optionen = optionenLesen(a.optionen)
    if (optionen.length > 0) aenderung.optionen = optionen
    const s = stufe(a.stufe)
    if (s !== undefined) aenderung.stufe = s
    aktualisiert.push(aenderung)
  }

  return { neu, aktualisiert, erledigt: ids(d.erledigt), erwaehnt: ids(d.erwaehnt), ueberblick: text(d.ueberblick, 2000) }
}

/** Für den Vergleich gleicher Punkte: klein, ohne Satzzeichen. */
export const schluessel = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Führt eine Auswertung in die Liste: erledigte schließen, bekannte nachschärfen,
 * neue anhängen (ein Punkt mit gleichem Titel wie ein offener kommt nicht doppelt).
 * Offene Punkte ohne Bezug in dieser Antwort zählen einen Schritt Richtung veraltet.
 */
export function zusammenfuehren(punkte: readonly Punkt[], a: Auswertung, jetzt: number, neueId: () => string): Punkt[] {
  const erledigt = new Set(a.erledigt)
  const aenderungen = new Map(a.aktualisiert.map(x => [x.id, x]))
  const bezug = new Set([...a.erwaehnt, ...aenderungen.keys()])

  const liste = punkte.map(p => {
    if (p.status !== 'offen') return p
    if (erledigt.has(p.id)) return { ...p, status: 'erledigt' as const, ergebnis: 'laut Gespräch erledigt' }
    const { id: _id, ...felder } = aenderungen.get(p.id) ?? { id: '' }
    return { ...p, ...felder, ohneBezug: bezug.has(p.id) ? 0 : (p.ohneBezug ?? 0) + 1 }
  })
  const vorhanden = new Set(liste.filter(p => p.status === 'offen').map(p => schluessel(p.titel)))

  for (const n of a.neu) {
    const s = schluessel(n.titel)
    if (vorhanden.has(s)) continue
    vorhanden.add(s)
    liste.push({ id: neueId(), ...n, status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: jetzt })
  }

  return begrenzen(liste)
}

/** Offene vorne behalten, Erledigtes als Erstes weglassen, wenn es zu viele werden. */
export function begrenzen(liste: readonly Punkt[]): Punkt[] {
  const offen = liste.filter(p => p.status === 'offen')
  const rest = liste.filter(p => p.status !== 'offen')

  return [...offen.slice(-MAX_PUNKTE), ...rest.slice(-Math.max(0, MAX_PUNKTE - offen.length))]
}

export const istVeraltet = (p: Punkt): boolean => (p.ohneBezug ?? 0) >= VERALTET_NACH

const RANG: Record<Stufe, number> = { blockiert: 0, normal: 1, angebot: 2 }

/**
 * Die Punkte, die noch offen sind, in der Reihenfolge, in der gefragt wird:
 * Veraltetes zuletzt, dann Zurückgestelltes, sonst blockierend vor normal vor
 * Angeboten, Älteres zuerst.
 */
export function offene(punkte: readonly Punkt[]): Punkt[] {
  return punkte
    .filter(p => p.status === 'offen')
    .sort((a, b) =>
      Number(istVeraltet(a)) - Number(istVeraltet(b)) ||
      a.zurueckgestellt - b.zurueckgestellt ||
      RANG[a.stufe ?? 'normal'] - RANG[b.stufe ?? 'normal'] ||
      a.erstellt - b.erstellt)
}

/** Eine Antwort, die auf ":" endet, braucht noch Text des Nutzers - nur vorbereiten. */
export const brauchtErgaenzung = (antwort: string): boolean => /:\s*$/.test(antwort)

/** Kurze Antworten wertet Haiku nur aus, wenn sie nach etwas fragen oder um etwas bitten. */
const FRAGE_AM_ENDE = /\?\s*\**\s*$/
const BITTE = /\b(soll ich|sollen wir|darf ich|magst du|möchtest du|willst du|brauche ich (noch )?von dir|bitte (prüf|teste|schau|bestätig|gib|schick)|prüf(e)? bitte|noch offen|deine freigabe)/i

export function auswerten(antwort: string, mindestLaenge: number): boolean {
  if (antwort.length >= mindestLaenge) return true
  const t = antwort.trim()

  return t.length >= 10 && (FRAGE_AM_ENDE.test(t) || BITTE.test(t))
}

/** Sprachen, deren Codeblöcke als Shell-Befehl gelten (leer: ohne Angabe). */
const SHELL = new Set(['', 'bash', 'sh', 'shell', 'console', 'zsh'])

/**
 * Die Shell-Befehle aus einer Anleitung, je Codeblock einer (mehrere Zeilen mit
 * && verbunden), höchstens drei. Kommentare und ein "$ " am Anfang fallen weg.
 */
export function befehle(anleitung: string): string[] {
  const liste: string[] = []
  for (const m of anleitung.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    if (!SHELL.has((m[1] ?? '').trim().toLowerCase())) continue
    const zeilen = (m[2] ?? '').split('\n')
      .map(z => z.trim().replace(/^\$\s+/, ''))
      .filter(z => z !== '' && !z.startsWith('#'))
    if (zeilen.length === 0) continue
    // Ohne Sprachangabe nur, was wie ein Befehl aussieht - kein JSON, keine Einstellungen.
    if ((m[1] ?? '').trim() === '' && /^[{["<]|^\w+\s*[=:]\s/.test(zeilen[0] ?? '')) continue
    const befehl = zeilen.map(z => z.replace(/\s*\\$/, '')).join(zeilen.some(z => z.endsWith('\\')) ? ' ' : ' && ')
    if (!liste.includes(befehl)) liste.push(befehl)
  }
  return liste.slice(0, 3)
}

/** Kurzform eines Befehls für die Auswahl. */
export const befehlLabel = (befehl: string): string => `Ausführen: ${befehl.length > 32 ? befehl.slice(0, 31) + '…' : befehl}`

export type Kommando =
  | { art: 'liste' }
  | { art: 'leeren' }
  | { art: 'fehler'; text: string }
  | { art: 'punkt'; nummer: number; tun: 'erledigt' | 'weg' | 'spaeter' | 'aktuell' | 'option'; option?: number }

/** Liest die Argumente von /offen: "", "leeren", "2 erledigt", "3 weg", "1 später", "2 a". */
export function kommando(args: string): Kommando {
  const a = args.trim().toLowerCase()
  if (a === '') return { art: 'liste' }
  if (a === 'leeren') return { art: 'leeren' }
  const m = /^(\d+)\s+(\S+)$/.exec(a)
  if (m === null) return { art: 'fehler', text: HILFE }
  const nummer = Number(m[1])
  const wort = m[2] ?? ''
  if (/^[a-d]$/.test(wort)) return { art: 'punkt', nummer, tun: 'option', option: wort.charCodeAt(0) - 97 }
  if (wort === 'erledigt' || wort === 'fertig') return { art: 'punkt', nummer, tun: 'erledigt' }
  if (wort === 'weg' || wort === 'verwerfen') return { art: 'punkt', nummer, tun: 'weg' }
  if (wort === 'später' || wort === 'spaeter') return { art: 'punkt', nummer, tun: 'spaeter' }
  if (wort === 'aktuell') return { art: 'punkt', nummer, tun: 'aktuell' }

  return { art: 'fehler', text: HILFE }
}

const HILFE = 'Verwendung: /offen · /offen <Nr> erledigt|weg|später|aktuell · /offen <Nr> a|b|c|d (Antwort wählen) · /offen leeren'

const RAHMEN: Record<Stufe, string> = { blockiert: 'blockiert', normal: '', angebot: 'Angebot' }

/** Zusatz zum Titel: blockiert, Angebot, veraltet, zurückgestellt. */
export function vermerk(p: Punkt): string {
  const teile = [RAHMEN[p.stufe ?? 'normal'], istVeraltet(p) ? 'noch aktuell?' : '', p.zurueckgestellt > 0 ? 'zurückgestellt' : '']
    .filter(t => t !== '')
  return teile.length > 0 ? ` (${teile.join(', ')})` : ''
}

/** Zeile für die Statusleiste. */
export function statuszeile(punkte: readonly Punkt[], prueft: boolean): string | undefined {
  const liste = offene(punkte)
  const n = liste.length
  if (n === 0) return prueft ? '◇ prüft auf offene Punkte …' : undefined
  const blockiert = liste.filter(p => p.stufe === 'blockiert').length
  const aufgaben = liste.filter(p => p.art === 'aufgabe').length
  const zusatz = [blockiert > 0 ? `${blockiert} blockiert` : '', aufgaben > 0 ? `${aufgaben} zu tun` : ''].filter(t => t !== '')

  return `${blockiert > 0 ? '■' : '◆'} ${n} offen${zusatz.length > 0 ? ` (${zusatz.join(', ')})` : ''}${prueft ? ' …' : ''} · /offen`
}

// ---------------------------------------------------------------- Dateien

/** Was zwischen den Sitzungen in der Datei steht. */
export type Ablage = { punkte: Punkt[]; ueberblick: string }

const DATEN_ANFANG = '<!-- offene-punkte-daten'

const zweistellig = (n: number) => String(n).padStart(2, '0')
export const datum = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`
}
export const uhrzeit = (ms: number): string => {
  const d = new Date(ms)
  return `${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`
}

const optionenText = (p: Punkt) => p.optionen
  .map((o, i) => `   ${String.fromCharCode(97 + i)}) ${o.label}${o.antwort !== '' ? ` – „${o.antwort}“` : ''}`)
  .join('\n')

/**
 * Die Datei mit den offenen Punkten: oben lesbar, unten die Daten für die
 * nächste Sitzung in einem HTML-Kommentar.
 */
export function ablageText(a: Ablage, jetzt: number): string {
  const liste = offene(a.punkte)
  const fertig = a.punkte.filter(p => p.status !== 'offen').slice(-8).reverse()
  const teile = [`# Offene Punkte\n\nStand: ${datum(jetzt)} ${uhrzeit(jetzt)} · wird von offene-punkte geschrieben, Änderungen hier gehen verloren.`]
  if (a.ueberblick !== '') teile.push(`## Überblick\n\n${a.ueberblick}`)
  teile.push(liste.length === 0
    ? '## Offen\n\nNichts offen.'
    : '## Offen\n\n' + liste.map((p, i) => [
      `### ${i + 1}. ${p.art === 'aufgabe' ? 'Zu tun: ' : ''}${p.titel}${vermerk(p)}`,
      p.frage,
      p.info !== '' ? `_${p.info}_` : '',
      (p.abwaegung ?? '') !== '' ? `Abwägung: ${p.abwaegung}` : '',
      p.anleitung,
      `Möglichkeiten:\n${optionenText(p)}`,
    ].filter(t => t !== '').join('\n\n')).join('\n\n'))
  if (fertig.length > 0) teile.push('## Zuletzt erledigt\n\n' + fertig.map(p => `- ${p.status === 'verworfen' ? '✗' : '✓'} ${p.titel}${p.ergebnis ? `: ${p.ergebnis}` : ''}`).join('\n'))
  // "-->" darf im Kommentar nicht vorkommen; in JSON-Zeichenketten ist > dasselbe Zeichen.
  const daten = JSON.stringify({ punkte: a.punkte, ueberblick: a.ueberblick }).replace(/-->/g, '--\\u003e')
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
  const roh = d as { punkte?: unknown; ueberblick?: unknown }
  const punkte: Punkt[] = []
  for (const x of Array.isArray(roh.punkte) ? roh.punkte : []) {
    if (typeof x !== 'object' || x === null) continue
    const p = x as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.titel !== 'string' || typeof p.frage !== 'string') continue
    const status = p.status === 'erledigt' || p.status === 'verworfen' ? p.status : 'offen'
    punkte.push({
      id: p.id,
      titel: p.titel,
      frage: p.frage,
      info: text(p.info, 300),
      art: p.art === 'aufgabe' ? 'aufgabe' : 'entscheidung',
      stufe: stufe(p.stufe) ?? 'normal',
      abwaegung: text(p.abwaegung, 800),
      anleitung: text(p.anleitung, 4000),
      optionen: optionenLesen(p.optionen),
      status,
      zurueckgestellt: typeof p.zurueckgestellt === 'number' ? p.zurueckgestellt : 0,
      ohneBezug: typeof p.ohneBezug === 'number' ? p.ohneBezug : 0,
      erstellt: typeof p.erstellt === 'number' ? p.erstellt : 0,
      ...(typeof p.ergebnis === 'string' ? { ergebnis: p.ergebnis } : {}),
    })
  }

  return { punkte: begrenzen(punkte), ueberblick: text(roh.ueberblick, 2000) }
}

/** Was sich zwischen zwei Ständen der Liste für den Verlauf getan hat. */
export function verlaufsEintraege(vorher: readonly Punkt[], nachher: readonly Punkt[], jetzt: number): string[] {
  const alt = new Map(vorher.map(p => [p.id, p]))
  const eintraege: string[] = []
  for (const p of nachher) {
    const war = alt.get(p.id)
    if (war === undefined) continue
    if (war.status === 'offen' && p.status !== 'offen') eintraege.push(verlaufsEintrag(p, jetzt))
    if (war.status !== 'offen' && p.status === 'offen') eintraege.push(`## ${uhrzeit(jetzt)} · ${p.titel} – wieder geöffnet\n`)
  }
  return eintraege
}

function verlaufsEintrag(p: Punkt, jetzt: number): string {
  const wie = p.status === 'verworfen' ? 'verworfen' : p.art === 'aufgabe' ? 'erledigt' : 'entschieden'
  return [
    `## ${uhrzeit(jetzt)} · ${p.titel} – ${wie}`,
    `**Frage:** ${p.frage}`,
    p.info !== '' ? `**Warum offen:** ${p.info}` : '',
    (p.abwaegung ?? '') !== '' ? `**Abwägung:** ${p.abwaegung}` : '',
    `**Möglichkeiten:**\n${optionenText(p)}`,
    `**Ergebnis:** ${p.ergebnis ?? wie}`,
  ].filter(t => t !== '').join('\n\n') + '\n'
}

export const verlaufKopf = (ms: number): string => `# Antworten auf offene Punkte – ${datum(ms)}\n\nWas entschieden, erledigt oder verworfen wurde, mit den Gründen von damals.\n`

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

/** Auftrag für /zusammenfassung: das Hauptmodell fasst die eigene Sitzung zusammen. */
export const ZUSAMMENFASSUNG = `Fasse diese Sitzung für den Nutzer zusammen, damit er ohne den Verlauf weiß, wo er steht. Nur Text, keine Werkzeuge. Deutsch, knapp, Markdown:

## Worum es ging
Ein bis drei Sätze.

## Was erledigt ist
Die Ergebnisse, neueste zuerst, mit dem, was man zum Wiederfinden braucht (Dateien, Commits, Adressen, Befehle). Kleinigkeiten zusammenfassen.

## Was du noch tun musst
Jede Aufgabe des Nutzers mit allen nötigen Schritten, Befehlen und Pfaden wörtlich in Codeblöcken – so, dass er sie ohne Nachschlagen ausführen kann. Gibt es keine: "Nichts."

## Offene Entscheidungen
Was noch geklärt werden muss, je ein Punkt mit den Möglichkeiten.

## Nächster Schritt
Ein Satz.

Erfinde nichts; was du nicht sicher weißt, lass weg.`
