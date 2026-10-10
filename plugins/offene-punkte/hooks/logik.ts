import type { Art, Option, Punkt } from '../types'

/** Höchstens so viele offene Punkte führt der Mod; ältere fallen hinten weg. */
export const MAX_PUNKTE = 30
/** So viel der Antwort bekommt Haiku (der Schluss zählt am meisten). */
export const MAX_ANTWORT = 12_000

/** Fester Teil des Auftrags - steht vorn, damit der Prompt-Cache ihn hält. */
export const AUFTRAG = `Du liest die letzte Antwort eines Coding-Assistenten an seinen Nutzer und findest OFFENE PUNKTE: Dinge, die noch nicht erledigt sind und eine Entscheidung, Freigabe, Zuarbeit oder Prüfung des Nutzers brauchen - besonders solche, die leicht untergehen.

Typisch: "vor dem Freischalten brauche ich von dir ...", Freigaben zum Ausrollen/Löschen/Pushen, Texte oder Zugangsdaten, die der Nutzer liefern muss, Abnahmen und Prüfungen von Hand ("prüfe bitte ...", "noch offen ..."), Entscheidungen zwischen Varianten, angebotene nächste Schritte ("soll ich ...?", "könnte ich auch vorziehen").

Kein offener Punkt: was der Assistent schon erledigt hat, reine Erklärungen, Selbstverständliches, Dinge ohne Zutun des Nutzers.

Jeder Punkt hat eine "art": "entscheidung", wenn der Nutzer nur wählen oder freigeben muss; "aufgabe", wenn er selbst etwas tun muss (etwas auf seinem Rechner ausführen, einrichten, Daten liefern, von Hand prüfen). Bei einer Aufgabe schreibe in "anleitung", was genau zu tun ist, so dass der Nutzer NICHT im Verlauf suchen muss: nummerierte Schritte, alle Befehle, Pfade, Dateinamen, Einstellungen und Werte WÖRTLICH aus der Antwort, Befehle und Dateiinhalte in Markdown-Codeblöcken. Nichts erfinden, nichts weglassen, was zum Ausführen nötig ist. Bei einer Entscheidung bleibt "anleitung" leer, außer ein Satz Kontext hilft beim Entscheiden.

Für jeden neuen Punkt: eine kurze Frage an den Nutzer und 2 bis 4 Antwortmöglichkeiten. Jede Möglichkeit hat ein kurzes "label" (höchstens 5 Wörter) und eine "antwort": der Satz, den der Nutzer dem Assistenten damit schickt (Ich-Form, konkret, z. B. "Ja, rolle es aus."). Hat der Nutzer etwas selbst zu tun, gib eine Möglichkeit mit leerer "antwort" und einem label wie "Erledige ich selbst". Braucht eine Antwort noch eine Eingabe des Nutzers (eigener Text, eine Zahl), ende die "antwort" mit einem Doppelpunkt - sie wird dann nur vorbereitet, nicht abgeschickt.

Außerdem führst du einen kurzen ÜBERBLICK über die ganze Sitzung, damit der Nutzer den Faden behält: Schreibe den bisherigen Überblick (unten) mit dem Neuen aus der Antwort fort. Markdown, höchstens 8 Zeilen, als Liste mit diesen fett gesetzten Anfängen, nur wenn es etwas dazu gibt: **Ziel:** worum es in der Sitzung geht · **Erledigt:** die wichtigsten Ergebnisse (knapp, neueste zuerst, Älteres zusammenfassen) · **Gerade:** woran zuletzt gearbeitet wurde · **Als Nächstes:** der nächste Schritt. Keine Wiederholung der offenen Punkte.

Bereits bekannte offene Punkte stehen unten mit ID. Melde sie NICHT erneut. Ist einer durch die neue Antwort oder die letzte Nachricht des Nutzers erledigt, nenne seine ID unter "erledigt".

Antworte NUR mit JSON, ohne Erklärung, in genau dieser Form:
{"neu":[{"titel":"2-5 Wörter","art":"aufgabe","frage":"Ein Satz?","info":"Warum offen, ein Satz.","anleitung":"1. ...\n\`\`\`\nbefehl\n\`\`\`","optionen":[{"label":"...","antwort":"..."}]}],"erledigt":["id"],"ueberblick":"- **Ziel:** ..."}
Gibt es keine neuen Punkte: {"neu":[],"erledigt":[],"ueberblick":"..."}`

/** Der wechselnde Teil: bekannte Punkte, letzte Nachricht des Nutzers, die Antwort. */
export function anfrage(antwort: string, letzteEingabe: string, offene: readonly Punkt[], ueberblick = ''): string {
  const bekannt = offene.length === 0
    ? '(keine)'
    : offene.map(p => `- ${p.id}: ${p.titel} - ${p.frage}`).join('\n')
  const text = antwort.length > MAX_ANTWORT ? '…' + antwort.slice(-MAX_ANTWORT) : antwort

  return `BISHERIGER ÜBERBLICK:\n${ueberblick || '(noch keiner)'}\n\nBEKANNTE OFFENE PUNKTE:\n${bekannt}\n\nLETZTE NACHRICHT DES NUTZERS:\n${letzteEingabe.slice(0, 2000) || '(keine)'}\n\nANTWORT DES ASSISTENTEN:\n${text}`
}

export type Auswertung = {
  neu: { titel: string; art: Art; frage: string; info: string; anleitung: string; optionen: Option[] }[]
  erledigt: string[]
  /** Fortgeschriebener Überblick; leer, wenn das Modell keinen geliefert hat. */
  ueberblick: string
}

const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.trim().slice(0, max) : '')

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
  const d = daten as { neu?: unknown; erledigt?: unknown; ueberblick?: unknown }

  const neu: Auswertung['neu'] = []
  for (const roherPunkt of Array.isArray(d.neu) ? d.neu : []) {
    if (typeof roherPunkt !== 'object' || roherPunkt === null) continue
    const p = roherPunkt as Record<string, unknown>
    const optionen: Option[] = []
    for (const o of Array.isArray(p.optionen) ? p.optionen : []) {
      if (typeof o !== 'object' || o === null) continue
      const label = text((o as Record<string, unknown>).label, 60)
      if (label === '' || optionen.some(x => x.label === label)) continue
      optionen.push({ label, antwort: text((o as Record<string, unknown>).antwort, 600) })
    }
    const titel = text(p.titel, 80)
    const frage = text(p.frage, 300)
    if (titel === '' || frage === '' || optionen.length === 0) continue
    const art: Art = p.art === 'aufgabe' ? 'aufgabe' : 'entscheidung'
    neu.push({ titel, art, frage, info: text(p.info, 300), anleitung: text(p.anleitung, 4000), optionen: optionen.slice(0, 4) })
  }

  const erledigt = (Array.isArray(d.erledigt) ? d.erledigt : []).filter((x): x is string => typeof x === 'string')

  return { neu, erledigt, ueberblick: text(d.ueberblick, 2000) }
}

/** Für den Vergleich gleicher Punkte: klein, ohne Satzzeichen. */
export const schluessel = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Führt eine Auswertung in die Liste: erledigte schließen, neue anhängen
 * (ein Punkt mit gleichem Titel wie ein offener kommt nicht doppelt).
 */
export function zusammenfuehren(punkte: readonly Punkt[], a: Auswertung, jetzt: number, neueId: () => string): Punkt[] {
  const erledigt = new Set(a.erledigt)
  const liste = punkte.map(p =>
    p.status === 'offen' && erledigt.has(p.id) ? { ...p, status: 'erledigt' as const, ergebnis: 'laut Gespräch erledigt' } : p,
  )
  const vorhanden = new Set(liste.filter(p => p.status === 'offen').map(p => schluessel(p.titel)))

  for (const n of a.neu) {
    const s = schluessel(n.titel)
    if (vorhanden.has(s)) continue
    vorhanden.add(s)
    liste.push({ id: neueId(), ...n, status: 'offen', zurueckgestellt: 0, erstellt: jetzt })
  }

  // Offene vorne behalten, Erledigtes als Erstes weglassen, wenn es zu viele werden.
  const offen = liste.filter(p => p.status === 'offen')
  const rest = liste.filter(p => p.status !== 'offen')

  return [...offen.slice(-MAX_PUNKTE), ...rest.slice(-Math.max(0, MAX_PUNKTE - offen.length))]
}

/** Die Punkte, die noch offen sind, in der Reihenfolge, in der gefragt wird. */
export function offene(punkte: readonly Punkt[]): Punkt[] {
  return punkte
    .filter(p => p.status === 'offen')
    .sort((a, b) => a.zurueckgestellt - b.zurueckgestellt || a.erstellt - b.erstellt)
}

/** Eine Antwort, die auf ":" endet, braucht noch Text des Nutzers - nur vorbereiten. */
export const brauchtErgaenzung = (antwort: string): boolean => /:\s*$/.test(antwort)

/** Zeile für die Statusleiste. */
export function statuszeile(punkte: readonly Punkt[], prueft: boolean): string | undefined {
  const liste = offene(punkte)
  const n = liste.length
  if (n === 0) return prueft ? '◇ prüft auf offene Punkte …' : undefined
  const aufgaben = liste.filter(p => p.art === 'aufgabe').length

  return `◆ ${n} offen${aufgaben > 0 ? ` (${aufgaben} zu tun)` : ''}${prueft ? ' …' : ''} · /offen`
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
