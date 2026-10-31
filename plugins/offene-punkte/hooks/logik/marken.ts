// „erledigt: #3“ in Claudes Antwort: lesen und anwenden
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { fremd, offene, schluessel } from './punkte'

/** nr -1 mit titel: Claude hat den Punkt beim Namen genannt („erledigt: Leitstand neu starten“). */
export type Marke = { nr: number; ueberholt: boolean; grund: string; titel?: string }

/**
 * „erledigt: #3, #5“, „überholt: #4 – Grund“ - oder, am Zeilenanfang, „erledigt: Titel des Punkts“:
 * der Nutzer nennt Punkte oft nur beim Titel, und nach einer Compaction kennt Claude die Nummern nicht.
 */
export function schlussMarken(antwort: string): Marke[] {
  const aus = new Map<string, Marke>()
  const muster = /(erledigt|überholt|ueberholt|hinfällig):\s*((?:#\d+(?:\s*(?:,|und|\+)\s*)?)+)(?:[ \t]*[–—-][ \t]*([^\n]+))?/gi
  for (const m of antwort.matchAll(muster)) {
    const ueberholt = !/^erledigt$/i.test(m[1] ?? '')
    const grund = (m[3] ?? '').trim().replace(/[*_`]+$/, '').slice(0, 120)
    for (const n of (m[2] ?? '').matchAll(/#(\d+)/g)) aus.set(`#${n[1]}`, { nr: Number(n[1]), ueberholt, grund })
  }
  // Tippvarianten: „erledigt #3“, „erledigt: Punkt 3“, „#3 erledigt“ - nicht aber Prosa wie „Punkt 3 ist erledigt“.
  const locker = /(erledigt|überholt|ueberholt|hinfällig)(?::[ \t]*|[ \t]+)(?:Punkt[ \t]+#?|#)(\d+)(?![\d,])|#(\d+)[ \t]+(erledigt|überholt|ueberholt|hinfällig)\b/gi
  for (const m of antwort.matchAll(locker)) {
    const wort = (m[1] ?? m[4] ?? '').toLowerCase()
    const nr = Number(m[2] ?? m[3])
    if (!aus.has(`#${nr}`)) aus.set(`#${nr}`, { nr, ueberholt: wort !== 'erledigt', grund: '' })
  }
  const perTitel = /^[ \t]*[*_]*(erledigt|überholt|ueberholt|hinfällig):[*_]*[ \t]*([^#\s][^\n]*)$/gim
  for (const m of antwort.matchAll(perTitel)) {
    const ueberholt = !/^erledigt$/i.test(m[1] ?? '')
    const [roh, ...rest] = (m[2] ?? '').split(/[ \t]+[–—-][ \t]+/)
    const titel = (roh ?? '').replace(/[*_`„“"]+/g, '').trim()
    // „Punkt 4“ ist eine Nummer (oben schon gelesen), kein Titel.
    if (titel === '' || titel.length > 80 || /^Punkt\s+#?\d+$/i.test(titel)) continue
    aus.set(`t:${schluessel(titel)}`, { nr: -1, ueberholt, grund: rest.join(' – ').trim().replace(/[*_`]+$/, '').slice(0, 120), titel })
  }
  return [...aus.values()]
}

/** „erledigt: #3, #5“ in einer Antwort von Claude: die Nummern (auch „überholt:“). */
export const erledigtMarken = (antwort: string): number[] => schlussMarken(antwort).filter(m => m.nr >= 0).map(m => m.nr)

/** Welche Marke einen Punkt nennt - per Nummer oder per Titel (gleich, oder einer enthält den anderen). */
function markeFuer(marken: readonly (number | Marke)[]): (p: Punkt) => Marke | undefined {
  const n = new Map<number, Marke>()
  const titel: Marke[] = []
  for (const m of marken) {
    if (typeof m === 'number') n.set(m, { nr: m, ueberholt: false, grund: '' })
    else if (m.titel !== undefined) titel.push(m)
    else n.set(m.nr, m)
  }
  return p => {
    const perNr = p.nr !== undefined ? n.get(p.nr) : undefined
    if (perNr !== undefined) return perNr
    const s = schluessel(p.titel)
    return titel.find(m => {
      const t = schluessel(m.titel ?? '')
      return t === s || (t.length >= 8 && s.length >= 8 && (s.includes(t) || t.includes(s)))
    })
  }
}

/** Was eine Marke schließen darf: offen und nicht unterwegs, oder beantwortet und bei Claude - nie den Punkt einer anderen Sitzung. */
const schliessbar = (p: Punkt, sitzung: string): boolean =>
  !fremd(p, sitzung) && ((p.status === 'offen' && p.ausstehend === undefined) || (p.status === 'erledigt' && p.beiClaude !== undefined))

/**
 * Schließt offene Punkte, die eine Marke nennt - per Nummer oder per Titel. Punkte einer anderen
 * Sitzung (mit sitzung) bleiben: deren Nummern kennt Claude nicht, eine solche Marke ist geraten.
 */
export function perMarkeSchliessen(liste: readonly Punkt[], marken: readonly (number | Marke)[], jetzt: number, sitzung = ''): Punkt[] {
  const passt = markeFuer(marken)
  return liste.map(p => {
    if (!schliessbar(p, sitzung)) return p
    const m = passt(p)
    if (m === undefined) return p
    // Beantwortet und bei Claude: die Marke sagt, dass er es umgesetzt hat.
    if (p.status === 'erledigt') {
      const { beiClaude: _b, ...rest } = p
      return { ...rest, ergebnis: `${p.ergebnis ?? 'beantwortet'} · von Claude als ${m.ueberholt ? 'überholt' : 'umgesetzt'} gemeldet${m.grund !== '' ? ` – ${m.grund}` : ''}`, geaendert: jetzt }
    }
    const grund = `von Claude als ${m.ueberholt ? 'überholt' : 'erledigt'} gemeldet${m.grund !== '' ? ` – ${m.grund}` : ''}`
    return { ...p, status: 'erledigt' as const, ergebnis: grund, auto: { grund, zeit: jetzt }, geaendert: jetzt }
  })
}

/**
 * Marken, die nichts geschlossen haben, als Rückmeldung an Claude: eine geratene Nummer soll nicht
 * still verpuffen (oder einen fremden Punkt treffen). liste ist der Stand VOR dem Schließen.
 * Leer, wenn jede Marke getroffen hat. Als getroffen zählt auch ein eigener Punkt, dessen Antwort gerade
 * unterwegs ist oder der seit `seit` (der letzten Nachricht) geschlossen wurde - der Nutzer war schneller.
 */
export function markenOhneTreffer(liste: readonly Punkt[], marken: readonly Marke[], sitzung = '', seit = Infinity): string[] {
  const aus: string[] = []
  for (const m of marken) {
    const passt = markeFuer([m])
    const genannt = liste.filter(p => passt(p) !== undefined)
    if (genannt.some(p => schliessbar(p, sitzung) || (!fremd(p, sitzung) && (p.ausstehend !== undefined || (p.geaendert ?? 0) >= seit)))) continue
    if (m.titel !== undefined) {
      aus.push(`„${m.titel}“ passt zu keinem offenen Punkt`)
      continue
    }
    const p = genannt[0]
    if (p === undefined) aus.push(`#${m.nr} gibt es nicht`)
    else if (fremd(p, sitzung)) aus.push(`#${m.nr} gehört einer anderen Sitzung`)
    else aus.push(`#${m.nr} „${p.titel}“ war schon geschlossen`)
  }
  return aus
}

/** Die Rückmeldung zu markenOhneTreffer: was nicht ankam und welche Nummern Claude wirklich nutzen kann. */
export function markenHinweis(probleme: readonly string[], liste: readonly Punkt[], sitzung = ''): string {
  if (probleme.length === 0) return ''
  const eigene = offene(liste).filter(p => !fremd(p, sitzung) && p.nr !== undefined).slice(0, 10)
  const offen = eigene.length > 0 ? `Offen sind ${eigene.map(p => `#${p.nr} „${p.titel}“`).join(', ')}.` : 'Offen ist kein Punkt dieser Sitzung.'
  return `offene-punkte: Deine Marke hat nichts geschlossen – ${probleme.join('; ')}. ${offen} Nummern nur aus „Offene Punkte“ oder einer Rückmeldung von offene-punkte übernehmen, nie raten; sonst „erledigt: Titel“.`
}

export function nrZuId(liste: readonly Punkt[]): Map<number, string> {
  const ids = new Map<number, string>()
  for (const p of liste) if (p.status === 'offen' && p.nr !== undefined) ids.set(p.nr, p.id)
  const zu = liste.filter(p => p.status === 'erledigt' && p.nr !== undefined && p.ausstehend === undefined)
    .sort((a, b) => (b.geaendert ?? b.erstellt) - (a.geaendert ?? a.erstellt))
  for (const p of zu) if (!ids.has(p.nr!)) ids.set(p.nr!, p.id)
  return ids
}

export const nrText = (p: Punkt) => (p.nr !== undefined ? `#${p.nr} ` : '')
