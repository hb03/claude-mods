// kosten.jsonl: Zeilen schreiben und auswerten
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { laufend } from './grund'

/** Eine Zeile für kosten.jsonl: was ein Haiku-Aufruf gekostet hat. */
export const kostenZeile = (
  art: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
  sitzung: string,
  jetzt: number,
): string =>
  JSON.stringify({
    zeit: new Date(jetzt).toISOString(), sitzung, art,
    eingabe: usage.input_tokens + usage.cache_creation_input_tokens, cache: usage.cache_read_input_tokens, ausgabe: usage.output_tokens,
    version: laufend,
  })

/** Grobe Tokenzahl eines Texts (deutsch, Markdown): rund 3,5 Zeichen je Token. */
export const tokensGeschaetzt = (text: string): number => Math.ceil(text.length / 3.5)

/**
 * Eine Zeile für kosten.jsonl, die kein Haiku-Aufruf ist: was der Mod dem Hauptmodell in den Kontext
 * gibt (Liste, Hinweis, Übergabe), geschätzt aus der Zeichenzahl. Das ist der teure Teil - ein
 * Token des Hauptmodells wiegt rund fünfzehn Haiku-Tokens - und war bis 0.17.2 unsichtbar.
 */
export const kontextZeile = (teile: Record<string, string>, sitzung: string, jetzt: number): string => {
  const tokens: Record<string, number> = {}
  let summe = 0
  for (const [name, text] of Object.entries(teile)) {
    if (text === '') continue
    tokens[name] = tokensGeschaetzt(text)
    summe += tokens[name]
  }
  return JSON.stringify({ zeit: new Date(jetzt).toISOString(), sitzung, art: 'kontext', modell: 'haupt', geschaetzt: true, eingabe: summe, cache: 0, ausgabe: 0, teile: tokens, version: laufend })
}

type KostenZeile = { zeit: string; art: string; modell?: string; eingabe: number; cache: number; ausgabe: number; sitzung?: string; quelle?: string; was?: string }

/** Woher eine Nutzung kam: /offen-Befehl, Wahl über der Eingabe, eingang.txt (claude-web), Claudes Block, Claudes Marke. */
export type Nutzungsquelle = 'befehl' | 'wahl' | 'eingang' | 'block' | 'marke'

/**
 * Eine Zeile für kosten.jsonl, die zählt, was benutzt wird (ab 0.18.0): welcher Befehl, welche Wahl,
 * welcher Weg. Keine Tokens. Nach einem halben Jahr zeigt /offen kosten, was wegkann.
 */
export const nutzungZeile = (quelle: Nutzungsquelle, was: string, sitzung: string, jetzt: number): string =>
  JSON.stringify({ zeit: new Date(jetzt).toISOString(), sitzung, art: 'nutzung', quelle, was: was.slice(0, 40), eingabe: 0, cache: 0, ausgabe: 0, version: laufend })

const QUELLE_TITEL: Record<Nutzungsquelle, string> = { befehl: '/offen-Befehle', wahl: 'Wahl über der Eingabe', eingang: 'eingang.txt (claude-web)', block: 'Blöcke von Claude', marke: 'Marken von Claude' }

/** Listenpreis Haiku 4.5 je Million Tokens (USD): Eingabe, Cache-Lesen, Ausgabe. */
const HAIKU_PREIS = { eingabe: 1, cache: 0.1, ausgabe: 5 }

const tausend = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/**
 * /offen kosten: was der Mod in diesem Projekt gekostet hat, aus kosten.jsonl - Haiku je Art mit
 * Listenpreis, dazu der geschätzte Kontext fürs Hauptmodell (ohne Preis: der hängt vom Modell ab).
 * tage: nur die letzten n Tage (0: alles).
 */
export function kostenAuswerten(text: string, jetzt: number, tage = 0): string {
  const zeilen: KostenZeile[] = []
  for (const z of text.split('\n')) {
    if (z.trim() === '') continue
    try {
      const r = JSON.parse(z) as Partial<KostenZeile>
      if (typeof r.art === 'string' && typeof r.eingabe === 'number') zeilen.push({ zeit: String(r.zeit ?? ''), art: r.art, modell: r.modell, eingabe: r.eingabe, cache: r.cache ?? 0, ausgabe: r.ausgabe ?? 0, sitzung: r.sitzung, quelle: r.quelle, was: r.was })
    } catch { /* kaputte Zeile */ }
  }
  const ab = tage > 0 ? new Date(jetzt - tage * 24 * 3600_000).toISOString() : ''
  const gewaehlt = zeilen.filter(z => z.zeit >= ab)
  if (gewaehlt.length === 0) return tage > 0 ? `Keine Kosten in den letzten ${tage} Tagen.` : 'Noch keine Kosten aufgezeichnet (kosten.jsonl fehlt oder ist leer).'
  const haiku = gewaehlt.filter(z => z.modell !== 'haupt' && z.art !== 'nutzung')
  const kontext = gewaehlt.filter(z => z.modell === 'haupt')
  const nutzung = gewaehlt.filter(z => z.art === 'nutzung')
  const arten = new Map<string, { n: number; eingabe: number; cache: number; ausgabe: number }>()
  for (const z of haiku) {
    const a = arten.get(z.art) ?? { n: 0, eingabe: 0, cache: 0, ausgabe: 0 }
    a.n++
    a.eingabe += z.eingabe
    a.cache += z.cache
    a.ausgabe += z.ausgabe
    arten.set(z.art, a)
  }
  const preis = (a: { eingabe: number; cache: number; ausgabe: number }) =>
    (a.eingabe * HAIKU_PREIS.eingabe + a.cache * HAIKU_PREIS.cache + a.ausgabe * HAIKU_PREIS.ausgabe) / 1e6
  const summe = { n: haiku.length, eingabe: 0, cache: 0, ausgabe: 0 }
  for (const a of arten.values()) {
    summe.eingabe += a.eingabe
    summe.cache += a.cache
    summe.ausgabe += a.ausgabe
  }
  const zeiten = gewaehlt.map(z => z.zeit.slice(0, 10)).filter(z => z !== '').sort()
  const sitzungen = new Set(gewaehlt.map(z => z.sitzung ?? '')).size
  const aus = [`Kosten von offene-punkte in diesem Projekt${tage > 0 ? ` (letzte ${tage} Tage)` : ''}: ${zeiten[0] ?? '?'} bis ${zeiten[zeiten.length - 1] ?? '?'}, ${sitzungen} Sitzungen.`, '']
  if (haiku.length > 0) {
    aus.push('Haiku (gemessen):')
    aus.push('  Art          Aufrufe   Eingabe    Cache  Ausgabe   ≈ USD')
    for (const [art, a] of [...arten.entries()].sort((x, y) => preis(y[1]) - preis(x[1]))) {
      aus.push(`  ${art.padEnd(12)} ${String(a.n).padStart(7)} ${tausend(a.eingabe).padStart(9)} ${tausend(a.cache).padStart(8)} ${tausend(a.ausgabe).padStart(8)}   ${preis(a).toFixed(2)}`)
    }
    aus.push(`  ${'Summe'.padEnd(12)} ${String(summe.n).padStart(7)} ${tausend(summe.eingabe).padStart(9)} ${tausend(summe.cache).padStart(8)} ${tausend(summe.ausgabe).padStart(8)}   ${preis(summe).toFixed(2)}`)
    aus.push('  (Listenpreis Haiku 4.5: 1 USD Eingabe, 0,10 Cache, 5 Ausgabe je Mio. Tokens)')
  }
  if (kontext.length > 0) {
    const t = kontext.reduce((s, z) => s + z.eingabe, 0)
    aus.push('', `Kontext fürs Hauptmodell (geschätzt, ab 0.17.3): ${kontext.length} Nachrichten mit Zusatz, ${tausend(t)} Tokens, Ø ${Math.round(t / kontext.length)} je Nachricht.`)
    aus.push('  Das sind Liste, Hinweis und Übergabe, die Claude mitbekommt - beim Hauptmodell rund 15-mal so teuer je Token wie bei Haiku.')
  }
  if (nutzung.length > 0) {
    aus.push('', `Nutzung (ab 0.18.0): ${nutzung.length} Vorgänge.`)
    for (const q of Object.keys(QUELLE_TITEL) as Nutzungsquelle[]) {
      const je = new Map<string, number>()
      for (const z of nutzung.filter(x => x.quelle === q)) je.set(z.was ?? '?', (je.get(z.was ?? '?') ?? 0) + 1)
      if (je.size === 0) continue
      aus.push(`  ${QUELLE_TITEL[q]}: ${[...je.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ')}`)
    }
  }
  return aus.join('\n')
}
