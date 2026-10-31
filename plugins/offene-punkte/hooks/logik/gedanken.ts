// gedanken.md
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { zweistellig } from './ablage'

/**
 * Ein Gedanke: ein Einfall, der noch nicht dran ist - in offene-punkte/gedanken.md, wie claude-web
 * sie führt: „### G3 · 14.10.2026 09:12 · Vermerk“, darunter der Text. Der Zustand steckt nur im
 * Vermerk: offen, in Arbeit („gesendet“, „im Planungsinterview“, „als Punkt #12“), verarbeitet
 * („erledigt 14.10. · Commit abc1234“, „verworfen“). Den Vermerk setzt Claude per Marke.
 */
export type Gedanke = { nr: number; zeit: string; vermerk: string; text: string }

export type GedankenDatei = { kopf: string; gedanken: Gedanke[] }

export type GedankenZustand = 'offen' | 'in Arbeit' | 'verarbeitet'

export const GEDANKEN_KOPF = '# Gedanken\n\nEinfälle, die noch nicht dran sind; wird von offene-punkte und claude-web geschrieben.\n'

export const zeitText = (ms: number): string => {
  const d = new Date(ms)
  return `${zweistellig(d.getDate())}.${zweistellig(d.getMonth() + 1)}.${d.getFullYear()} ${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}`
}

export const gedankeZustand = (g: Gedanke): GedankenZustand => {
  const v = g.vermerk.trim().toLowerCase()
  if (v === '' || v === 'offen') return 'offen'
  // Auch claude-webs Vermerke: „als offener Punkt …“ und „in den Chat …“ gelten dort als verarbeitet.
  if (/^(erledigt|verworfen|umgesetzt|als (offener )?punkt|in den chat)\b/.test(v)) return 'verarbeitet'
  return 'in Arbeit'
}

/** Liest gedanken.md; was vor dem ersten Eintrag steht (Titel, Erklärung), bleibt als Kopf erhalten. */
export function gedankenLesen(text: string): GedankenDatei {
  const zeilen = text.split(/\r?\n/)
  const kopf: string[] = []
  const gedanken: Gedanke[] = []
  let aktuell: Gedanke | null = null
  let rumpf: string[] = []
  const abschliessen = () => {
    if (aktuell !== null) gedanken.push({ ...aktuell, text: rumpf.join('\n').trim() })
    rumpf = []
  }
  for (const z of zeilen) {
    const m = /^###\s+G(\d+)\s*·\s*([^·\n]*?)\s*(?:·\s*(.*))?$/.exec(z)
    if (m !== null) {
      abschliessen()
      aktuell = { nr: Number(m[1]), zeit: (m[2] ?? '').trim(), vermerk: (m[3] ?? '').trim() || 'offen', text: '' }
      continue
    }
    // Abschnitte wie „## Offen / ## In Arbeit“ (ältere claude-web-Dateien) gehören zu keinem Gedanken.
    if (/^##\s/.test(z)) continue
    if (aktuell === null) kopf.push(z)
    else rumpf.push(z)
  }
  abschliessen()
  return { kopf: kopf.join('\n').trim() === '' ? '' : kopf.join('\n').replace(/\s+$/, '') + '\n', gedanken }
}

export function gedankenText(d: GedankenDatei): string {
  const kopf = d.kopf !== '' ? d.kopf : GEDANKEN_KOPF
  const eintraege = d.gedanken.map(g => `### G${g.nr} · ${g.zeit} · ${g.vermerk}\n${g.text}\n`)
  return `${kopf.replace(/\s+$/, '')}\n\n${eintraege.join('\n')}`.replace(/\s+$/, '') + '\n'
}

export const naechsteGedankenNr = (d: GedankenDatei): number => Math.max(0, ...d.gedanken.map(g => g.nr)) + 1

/** Die erste Zeile eines Gedankens, gekürzt - für Listen und Knöpfe. */
export const gedankeKurz = (g: Gedanke, max = 70): string => {
  const z = g.text.split('\n')[0]?.trim() ?? ''
  return z.length > max ? `${z.slice(0, max - 1)}…` : z
}

/** „gedanke erledigt: G3 – Commit abc1234“ oder „gedanke verworfen: G3 – Grund“ in einer Antwort von Claude. */
export function gedankenMarken(antwort: string, jetzt: number): { nr: number; vermerk: string }[] {
  const aus = new Map<number, string>()
  const muster = /gedanke\s+(erledigt|umgesetzt|verworfen):\s*G?(\d+)(?:[ \t]*[–—-][ \t]*([^\n]+))?/gi
  for (const m of antwort.matchAll(muster)) {
    const grund = (m[3] ?? '').trim().replace(/[*_`]+$/, '').slice(0, 120)
    const tag = zeitText(jetzt).slice(0, 6)
    const art = (m[1] ?? '').toLowerCase() === 'verworfen' ? 'verworfen' : 'erledigt'
    aus.set(Number(m[2]), `${art} ${tag}${grund !== '' ? ` · ${grund}` : ''}`)
  }
  return [...aus.entries()].map(([nr, vermerk]) => ({ nr, vermerk }))
}

/** Was „senden“ und „interview“ an Claude schicken - mit der Bitte um die Marke am Ende. */
export function gedankeBitte(g: Gedanke, art: 'senden' | 'interview'): string {
  const marke = `Ist er umgesetzt, schreib eine Zeile „gedanke erledigt: G${g.nr} – Commit <kurz>“; passt er nicht mehr, „gedanke verworfen: G${g.nr} – Grund“.`
  if (art === 'interview') return `Lass uns Gedanke G${g.nr} im Planungsinterview durchgehen: ${g.text}\n\nFrag mich die offenen Details einzeln ab. ${marke}`
  return `Gedanke G${g.nr} (${g.zeit}): ${g.text}\n\nSetz das um, wenn es passt - sonst sag, was dagegen spricht. ${marke}`
}

/** „Gedanken prüfen“: Claude gleicht alles in Arbeit mit git log und Code ab - als Maschinen-Turn, nur Marken. */
export function gedankenPruefBitte(gedanken: readonly Gedanke[]): string {
  const liste = gedanken.map(g => `G${g.nr} (${g.vermerk}): ${gedankeKurz(g, 160)}`).join('; ')
  return `Automatische Klärung der Gedanken in Arbeit: ${liste}. Gleiche jeden mit git log und dem Code ab. Für jeden, der umgesetzt ist, eine Zeile „gedanke erledigt: G<n> – Commit <kurz>“; für hinfällige „gedanke verworfen: G<n> – Grund“; sonst nichts ändern. Nichts umsetzen.`
}
