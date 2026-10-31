// Grundwerte: Grenzen, Version, Maschinen-Eingaben
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'

/** Höchstens so viele offene Punkte führt der Mod; ältere fallen hinten weg. */
export const MAX_PUNKTE = 30

/** So viel der Antwort bekommt Haiku (der Schluss zählt am meisten). */
export const MAX_ANTWORT = 12_000

/** Nach so vielen Auswertungen ohne Bezug gilt ein Punkt als veraltet und schließt sich (wieder zu öffnen). */
export const VERALTET_NACH = 10

/** Ein Angebot, auf das so viele Antworten lang niemand eingeht, gilt als stilles Nein. */
export const ANGEBOT_VERFALL = 4

/**
 * Rückfall, wenn die eigene plugin.json nicht lesbar ist; sonst gilt, was beim Start aus ihr gelesen
 * wurde (laufendeVersionSetzen). Steht in offen.md/offen.json, damit claude-web sieht, welche Fassung schreibt.
 */
export const VERSION = '0.18.0'

export let laufend = VERSION

/** Die Fassung, die gerade läuft: aus der plugin.json im geladenen Ordner, sonst VERSION. */
export const laufendeVersion = (): string => laufend

export function laufendeVersionSetzen(version: string): void {
  laufend = /^\d+\.\d+\.\d+/.test(version) ? version : VERSION
}

/** Die Fassung aus dem Text einer plugin.json; leer, wenn nicht lesbar. */
export function manifestVersion(text: string): string {
  try {
    const v = (JSON.parse(text) as { version?: unknown }).version
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

/** So oft prüft eine laufende Sitzung, ob ein Abgleich fällig ist - Server-Sitzungen laufen tagelang ohne Neustart. */
export const ABGLEICH_TAKT_MS = 60 * 60_000

/** Ab so viel Prozent des 5-Stunden-Fensters ruft der Mod kein Haiku mehr (Option haikuBisProzent). */
export const BUDGET_GRENZE = 85

/** Eingaben, die kein Mensch getippt hat, obwohl sie aus der Eingabe kommen: claude-webs Klärung (per tmux). */
const MASCHINEN_EINGABE = /^\s*(?:Automatische Kl(?:ä|ae)rung|Vor Ablauf des Caches)\b/i

export const istMaschinenEingabe = (text: string): boolean => MASCHINEN_EINGABE.test(text)

/** Die installierte Fassung aus ~/.claude/plugins/installed_plugins.json; leer, wenn nicht lesbar. */
export function installierteVersion(text: string): string {
  try {
    const d = JSON.parse(text) as { plugins?: Record<string, { version?: unknown }[]> }
    const eintrag = Object.entries(d.plugins ?? {}).find(([name]) => name.startsWith('offene-punkte@'))?.[1]?.[0]
    return typeof eintrag?.version === 'string' ? eintrag.version : ''
  } catch {
    return ''
  }
}

/** Ist die installierte Fassung neuer als die laufende? Dann lohnt ein Neustart. */
export const neuerAlsLaufend = (installiert: string): boolean => {
  if (installiert === '' || installiert === laufend) return false
  const a = installiert.split('.').map(Number)
  const b = laufend.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}
