// Claudes Block ```offen: lesen und in Punkte wandeln
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { nrZuId } from './marken'
import type { Marke } from './marken'
import { lies, text } from './auftraege'
import type { Aenderung, Auswertung } from './auftraege'

/** Eine Änderung an einem bestehenden Punkt, den Claude per Nummer nennt. */
export type NrAenderung = { nr: number } & Omit<Aenderung, 'id'>

const nummer = (x: unknown): number => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x.replace('#', '')) : NaN)

/** Liest Claudes Eintrag (aus dem Block): neue Punkte wie aus der Auswertung, Änderungen per Nummer, zu schließende als Marken. */
export function eintragLesen(eingabe: unknown): { neu: Auswertung['neu']; aenderungen: NrAenderung[]; marken: Marke[] } {
  const e = typeof eingabe === 'object' && eingabe !== null ? eingabe as Record<string, unknown> : {}
  const roh = (Array.isArray(e.aktualisieren) ? e.aktualisieren : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && Number.isInteger(nummer(x.nr)))
  // Dieselben Grenzen wie bei Haiku: die Nummer wird vorübergehend zur ID.
  const gelesen = lies(JSON.stringify({ neu: Array.isArray(e.neu) ? e.neu : [], aktualisiert: roh.map(x => ({ ...x, id: String(nummer(x.nr)) })) }))
  const titel = new Map(roh.map(x => [nummer(x.nr), text(x.titel, 80)]))
  const aenderungen: NrAenderung[] = (gelesen?.aktualisiert ?? []).map(({ id, ...felder }) => {
    const t = titel.get(Number(id)) ?? ''
    return { nr: Number(id), ...felder, ...(t !== '' ? { titel: t } : {}) }
  })
  const marken: Marke[] = []
  for (const x of Array.isArray(e.schliessen) ? e.schliessen : []) {
    if (typeof x !== 'object' || x === null) continue
    const m = x as Record<string, unknown>
    const nr = nummer(m.nr)
    if (!Number.isInteger(nr)) continue
    marken.push({ nr, ueberholt: m.ueberholt === true, grund: text(m.grund, 120) })
  }
  return { neu: gelesen?.neu ?? [], aenderungen, marken }
}

/**
 * Änderungen per Nummer auf die IDs abbilden: offene Punkte zuerst, sonst erledigte (auch gerade
 * beantwortete) - die öffnet die Änderung wieder. Verworfene und unbekannte Nummern fallen weg
 * (abgelehnteAenderungen nennt sie).
 */
export function aenderungenZuIds(liste: readonly Punkt[], aenderungen: readonly NrAenderung[]): Aenderung[] {
  const ids = nrZuId(liste)
  return aenderungen.flatMap(({ nr, ...felder }) => {
    const id = ids.get(nr)
    return id === undefined ? [] : [{ id, ...felder }]
  })
}

/** Die Änderungen, die keinen Punkt treffen: Nummer unbekannt oder vom Nutzer verworfen. */
export function abgelehnteAenderungen(liste: readonly Punkt[], aenderungen: readonly NrAenderung[]): NrAenderung[] {
  const ids = nrZuId(liste)
  return aenderungen.filter(a => !ids.has(a.nr))
}

/**
 * Der Block in Claudes Antwort (Eintrag „block“): ein Zaun \`\`\`offen, darin je Punkt eine Zeile
 * „# Titel | art | stufe“ (oder „# #12 Titel“ für eine Änderung), dann die Frage, Möglichkeiten „a) …“,
 * Zeilen „info:“, „abwaegung:“ und ab „anleitung:“ alles bis zum nächsten Punkt. Die Labels der
 * Möglichkeiten sind zugleich die Antwort an Claude - er kennt seine eigenen Worte.
 */
export function blockLesen(antwort: string): { neu: Auswertung['neu']; aenderungen: NrAenderung[] } {
  const roh: Record<string, unknown>[] = []
  for (const zaun of antwort.matchAll(/```(?:offen|offene-punkte)[ \t]*\r?\n([\s\S]*?)```/g)) {
    let p: Record<string, unknown> | null = null
    let anleitung: string[] | null = null
    for (const zeile of (zaun[1] ?? '').split(/\r?\n/)) {
      const kopf = /^#[ \t]+(.*)$/.exec(zeile)
      if (kopf !== null) {
        // Die Anleitung des vorigen Punkts endet hier.
        if (p !== null && anleitung !== null) p.anleitung = anleitung.join('\n').trim()
        const [titelTeil, ...flags] = (kopf[1] ?? '').split('|').map(t => t.trim())
        const nr = /^#(\d+)\s+(.*)$/.exec(titelTeil ?? '')
        p = { titel: nr !== null ? nr[2] : titelTeil, optionen: [] as { label: string; antwort: string }[] }
        if (nr !== null) p.nr = Number(nr[1])
        for (const f of flags.map(x => x.toLowerCase())) {
          if (f === 'aufgabe' || f === 'entscheidung') p.art = f
          else if (f === 'blockiert' || f === 'normal' || f === 'angebot') p.stufe = f
          else if (f === 'mehrfach') p.mehrfach = true
        }
        anleitung = null
        roh.push(p)
        continue
      }
      if (p === null) continue
      if (anleitung !== null) {
        anleitung.push(zeile)
        continue
      }
      const option = /^[-*]?[ \t]*([a-d])[).][ \t]+(.+)$/.exec(zeile)
      if (option !== null) {
        const label = (option[2] ?? '').trim()
        ;(p.optionen as { label: string; antwort: string }[]).push({ label, antwort: label })
        continue
      }
      const feld = /^(info|abwaegung|abwägung|anleitung|stufe|art):[ \t]*(.*)$/i.exec(zeile)
      if (feld !== null) {
        const name = (feld[1] ?? '').toLowerCase().replace('ä', 'ae')
        const wert = (feld[2] ?? '').trim()
        if (name === 'anleitung') anleitung = wert !== '' ? [wert] : []
        else if (name === 'art' && (wert === 'aufgabe' || wert === 'entscheidung')) p.art = wert
        else if (name === 'stufe' && (wert === 'blockiert' || wert === 'normal' || wert === 'angebot')) p.stufe = wert
        else if (name === 'info' || name === 'abwaegung') p[name] = wert
        continue
      }
      const t = zeile.trim()
      if (t === '') continue
      p.frage = typeof p.frage === 'string' && p.frage !== '' ? `${p.frage} ${t}` : t
    }
    // Der letzte Punkt eines Zauns: seine Anleitung endet mit dem Zaun.
    if (p !== null && anleitung !== null) p.anleitung = anleitung.join('\n').trim()
  }
  const { neu, aenderungen } = eintragLesen({ neu: roh.filter(p => p.nr === undefined), aktualisieren: roh.filter(p => p.nr !== undefined) })
  return { neu, aenderungen }
}
