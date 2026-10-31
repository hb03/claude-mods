// Stündlicher Abgleich offener Punkte mit Commits und Entscheidungen
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { datum } from './ablage'
import { text } from './auftraege'

/** So alt (seit Anlage oder letzter Prüfung) muss ein offener Punkt sein, bevor der Start ihn abgleicht. */
export const ABGLEICH_NACH_MS = 6 * 3600_000

export const ABGLEICH_AUFTRAG = `Du gleichst offene Punkte eines Projekts mit dem aktuellen Stand ab. Jeder Punkt ist eine Frage oder Aufgabe an den Nutzer, die vor einigen Stunden oder Tagen entstanden ist. Als Beleg bekommst du die Git-Commits seit dem ältesten Punkt, den letzten Überblick über die Arbeit und was seither an anderen Punkten entschieden wurde (auch in anderen Sitzungen).

Je Punkt entscheidest du:
- "erledigt": die Belege zeigen klar, dass das Gefragte entschieden oder getan ist (z. B. ein Commit hält die Entscheidung fest).
- "ueberholt": die Belege zeigen klar, dass sich der Punkt erledigt hat, weil sich der Plan oder Aufbau geändert hat (z. B. ein Schritt wurde verschoben oder ist durch einen anderen Weg unnötig), eine spätere Entscheidung ihn beantwortet oder er eine ältere Fassung einer inzwischen entschiedenen Frage ist.
- "offen": sonst. Im Zweifel immer "offen" - ein fälschlich geschlossener Punkt geht verloren, ein offener kostet nur eine Frage.

Antworte nur mit JSON: {"ergebnisse":[{"nr":3,"stand":"erledigt","grund":"Commit 48dbe6c hält die Entscheidung fest"}]}. Der Grund ist ein kurzer Satz auf Deutsch und nennt den Beleg (Commit-Kürzel oder Stelle im Überblick). Punkte, die offen bleiben, darfst du weglassen.`

/** Offene Punkte, die der Startabgleich prüfen soll: lange genug alt, nicht beantwortet, nicht vom Nutzer selbst angelegt. */
export const abgleichKandidaten = (liste: readonly Punkt[], jetzt: number): Punkt[] =>
  liste.filter(p => p.status === 'offen' && p.ausstehend === undefined && p.vonNutzer !== true && p.nr !== undefined &&
    jetzt - Math.max(p.erstellt, p.geprueft ?? 0) >= ABGLEICH_NACH_MS)

export function abgleichAnfrage(punkte: readonly Punkt[], belege: { commits: string; ueberblick: string; entschieden?: string }): string {
  const liste = punkte.map(p => [
    `#${p.nr} ${p.titel} (seit ${datum(p.erstellt)})`,
    `Frage: ${p.frage}`,
    p.info !== '' ? `Warum offen: ${p.info}` : '',
  ].filter(t => t !== '').join('\n')).join('\n\n')
  return [
    `OFFENE PUNKTE:\n\n${liste}`,
    `GIT-COMMITS SEIT DEM ÄLTESTEN PUNKT:\n\n${belege.commits.trim() || '(keine)'}`,
    `LETZTER ÜBERBLICK:\n\n${belege.ueberblick.trim() || '(keiner)'}`,
    `SEITHER ENTSCHIEDEN ODER ERLEDIGT:\n\n${(belege.entschieden ?? '').trim() || '(nichts)'}`,
  ].join('\n\n')
}

/**
 * Aus Tagesverläufen (antworten-JJJJ-MM-TT.md, älteste zuerst) die Entscheidungen als
 * Kurzzeilen „Titel: Ergebnis“; höchstens max Zeichen, die neuesten bleiben.
 */
export function entscheidungenAus(verlaeufe: readonly string[], max = 4000): string {
  const zeilen: string[] = []
  for (const text of verlaeufe) {
    for (const block of text.split(/^## /m).slice(1)) {
      const kopf = /^\d{2}:\d{2} · (?:#\d+ )?(.+) – ([^\n]+?)\s*$/m.exec(block)
      const ergebnis = /^\*\*Ergebnis:\*\* (.+)$/m.exec(block)
      if (kopf === null || ergebnis === null) continue
      zeilen.push(`- ${kopf[1]}: ${ergebnis[1]!.slice(0, 200)}`)
    }
  }
  const aus = zeilen.join('\n')
  return aus.length > max ? '…' + aus.slice(-max) : aus
}

export type AbgleichErgebnis = { nr: number; stand: 'erledigt' | 'ueberholt'; grund: string }

/** Liest die Antwort des Modells; nur geschlossene Punkte kommen zurück, alles Unlesbare zählt als offen. */
export function liesAbgleich(roh: string): AbgleichErgebnis[] | null {
  const start = roh.indexOf('{')
  const ende = roh.lastIndexOf('}')
  if (start < 0 || ende <= start) return null
  let d: unknown
  try {
    d = JSON.parse(roh.slice(start, ende + 1))
  } catch {
    return null
  }
  const liste = typeof d === 'object' && d !== null ? (d as Record<string, unknown>).ergebnisse : undefined
  if (!Array.isArray(liste)) return null
  const aus: AbgleichErgebnis[] = []
  for (const x of liste) {
    if (typeof x !== 'object' || x === null) continue
    const e = x as Record<string, unknown>
    const grund = text(e.grund, 200)
    if (typeof e.nr !== 'number' || (e.stand !== 'erledigt' && e.stand !== 'ueberholt') || grund === '') continue
    aus.push({ nr: e.nr, stand: e.stand, grund })
  }
  return aus
}

/**
 * Schließt, was der Abgleich belegt hat (nur unter den geprüften Punkten), und stempelt die
 * übrigen geprüften als geprüft, damit sie erst nach ABGLEICH_NACH_MS wieder drankommen.
 */
export function abgleichAnwenden(liste: readonly Punkt[], geprueft: readonly number[], ergebnisse: readonly AbgleichErgebnis[], jetzt: number): Punkt[] {
  const nrn = new Set(geprueft)
  const zu = new Map(ergebnisse.map(e => [e.nr, e]))
  return liste.map(p => {
    if (p.nr === undefined || !nrn.has(p.nr) || p.status !== 'offen' || p.ausstehend !== undefined) return p
    const e = zu.get(p.nr)
    if (e === undefined) return { ...p, geprueft: jetzt }
    const grund = `beim Start abgeglichen: ${e.stand === 'ueberholt' ? 'überholt' : 'erledigt'} – ${e.grund}`
    return { ...p, status: 'erledigt' as const, ergebnis: grund, auto: { grund, zeit: jetzt }, geaendert: jetzt }
  })
}
