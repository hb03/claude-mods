// Texte an Haiku und Claude: Nachfassen, Hinweis, Überblick, Zusammenfassung
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { MAX_ANTWORT } from './grund'
import { fremd, offene, vermerk } from './punkte'
import type { Sicht } from './punkte'

/**
 * Auftrag fürs Nachfassen (Auswertung „claude“): Claude trägt Punkte selbst ein; Haiku springt nur ein,
 * wenn die Antwort fragt und nichts eingetragen wurde. Kurz gehalten (rund ein Fünftel von AUFTRAG), ohne
 * Überblick, und streng: die Schlussfrage allein ist kein Punkt - der Nutzer beantwortet sie gleich.
 */
export const NACHFASSEN_AUFTRAG = `Du liest die letzte Antwort eines Coding-Assistenten an seinen Nutzer. Der Assistent trägt offene Punkte normalerweise selbst ein; hier hat er nichts eingetragen, obwohl die Antwort mit einer Frage oder Bitte endet. Finde NUR, was verloren ginge, wenn der Nutzer jetzt bloß auf die Schlussfrage antwortet: Aufgaben, die er selbst auf seinem Rechner, Handy oder Konto erledigen muss; Freigaben oder Entscheidungen mit Folgen, die in der Antwort genannt, aber nicht als Schlussfrage gestellt sind; Daten oder Zugangsdaten, die er liefern muss; mehrere Fragen auf einmal, von denen eine untergehen kann.

KEIN Punkt für: die einzelne Rückfrage am Ende, die der Nutzer sowieso gleich beantwortet; Angebote ("soll ich noch …?", "könnte ich auch …"); "neu starten?"; Prüfungen, die der Assistent selbst machen kann (Logs, Tests, Dateien, Dienste); Erklärungen; Fragen, die der Assistent als Auswahl-Dialog stellt; alles, was eine ANDERE Claude-Sitzung betrifft. Im Zweifel nichts eintragen: {"neu":[],"erledigt":[],"erwaehnt":[]}.

Jeder Punkt: "titel" (2-5 Wörter), "art" ("aufgabe": der Nutzer tut selbst etwas; "entscheidung": er wählt oder gibt frei), "stufe" ("blockiert": ohne ihn geht es nicht weiter; sonst "normal"), "frage" (ein Satz an den Nutzer), "info" (warum offen, ein Satz), "abwaegung" (Gründe aus der Antwort, höchstens ein Satz, sonst leer), "anleitung" (nur bei Aufgaben: nummerierte Schritte mit allen Befehlen, Pfaden und Werten WÖRTLICH aus der Antwort, Befehle in \`\`\`bash-Blöcken; sonst leer), "optionen": 1 bis 2, die Empfehlung zuerst, jede mit "label" (höchstens 6 Wörter, spezifisch, ohne ich/du) und "antwort" (der Satz, den der Nutzer dem Assistenten damit schickt, Ich-Form aus Sicht des Nutzers; endet sie mit ":", muss der Nutzer noch etwas ergänzen; sie sagt dasselbe wie das Label: nennt das Label eine Handlung des Nutzers, ist die antwort eine Absicht ("Ich kläre das im Leitstand."), nie "Ich habe … erledigt", außer das Label sagt "Erledigt: …"). Was der Nutzer außerhalb selbst tun muss, ist "aufgabe". Keine Optionen für Später, Schon erledigt, Nicht relevant, eigene Antwort - die gibt es immer. Nennt die Antwort die Webseite des Projekts, schreib Seiten mit voller Adresse.

Bekannte offene Punkte stehen unten mit ID: NICHT neu melden. Erledigt die neue Antwort oder die letzte Nachricht des Nutzers einen davon, oder ist er überholt, melde ihn unter "erledigt" als {"id":"...","grund":"wenige Wörter"}; geht die Antwort darauf ein, die ID unter "erwaehnt". Kürzlich geschlossene Punkte (unten) nicht neu anlegen.

Antworte NUR mit JSON: {"neu":[{"titel":"...","art":"aufgabe","stufe":"normal","frage":"...?","info":"...","abwaegung":"","anleitung":"","mehrfach":false,"optionen":[{"label":"...","antwort":"..."}]}],"erledigt":[{"id":"...","grund":"..."}],"erwaehnt":["id"]}`

/** Der wechselnde Teil: bekannte Punkte, letzte Nachricht des Nutzers, die Antwort(en). */
export function anfrage(antworten: string | readonly string[], letzteEingabe: string, offene: readonly Punkt[], ueberblick = '', geschlossen: readonly Punkt[] = []): string {
  const bekannt = offene.length === 0
    ? '(keine)'
    : offene.map(p => `- ${p.id} (${p.art}${p.stufe === 'angebot' ? ', Angebot' : ''}): ${p.titel} - ${p.frage}${p.info !== '' ? ` [${p.info}]` : ''}`).join('\n')
  const zu = geschlossen.length === 0
    ? '(keine)'
    : geschlossen.map(p => `- ${p.titel} - ${p.frage} => ${(p.ergebnis ?? p.status).slice(0, 160)}`).join('\n')

  return `BISHERIGER ÜBERBLICK:\n${ueberblick || '(noch keiner)'}\n\nBEKANNTE OFFENE PUNKTE:\n${bekannt}\n\nKÜRZLICH GESCHLOSSEN:\n${zu}\n\nLETZTE NACHRICHT DES NUTZERS:\n${letzteEingabe.slice(0, 2000) || '(keine)'}\n\n${antwortTeil(antworten)}`
}

/** Die zuletzt geschlossenen Punkte (neueste zuerst), damit Haiku sie nicht neu anlegt. */
export const zuletztGeschlossen = (punkte: readonly Punkt[], n = 12): Punkt[] =>
  punkte.filter(p => p.status !== 'offen').sort((a, b) => (b.geaendert ?? b.erstellt) - (a.geaendert ?? a.erstellt)).slice(0, n)

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

/** Felder, die Haiku oder Claude an einem bekannten Punkt nachschärfen darf. */
export type Aenderung = { id: string } & Partial<Pick<Punkt, 'titel' | 'frage' | 'info' | 'anleitung' | 'abwaegung' | 'optionen' | 'stufe' | 'art'>>

export type Auswertung = {
  neu: { titel: string; art: Art; stufe: Stufe; frage: string; info: string; abwaegung: string; anleitung: string; optionen: Option[] }[]
  aktualisiert: Aenderung[]
  erledigt: string[]
  /** Kurzer Grund je erledigter ID, wenn das Modell einen genannt hat. */
  gruende?: Record<string, string>
  erwaehnt: string[]
  /** Fortgeschriebener Überblick; leer, wenn das Modell keinen geliefert hat. */
  ueberblick: string
}

export const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.trim().slice(0, max) : '')

export const stufe = (x: unknown): Stufe | undefined => (x === 'blockiert' || x === 'normal' || x === 'angebot' ? x : undefined)

const ids = (x: unknown): string[] => (Array.isArray(x) ? x : []).filter((y): y is string => typeof y === 'string')

/** Was die festen Knoepfe schon abdecken (Spaeter, Schon erledigt) - kommt es trotzdem, faellt es weg. */
const DOPPELT = /^(später|(erledige|mache|prüfe|teste) ich (selbst|später)|(mache|prüfe|teste) ich selbst)$/i

export function optionenLesen(x: unknown): Option[] {
  const optionen: Option[] = []
  for (const o of Array.isArray(x) ? x : []) {
    if (typeof o !== 'object' || o === null) continue
    const label = text((o as Record<string, unknown>).label, 60)
    if (label === '' || DOPPELT.test(label) || optionen.some(y => y.label === label)) continue
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
      ...(p.mehrfach === true && optionen.length > 1 ? { mehrfach: true } : {}),
    })
  }

  const aktualisiert: Aenderung[] = []
  for (const roh of Array.isArray(d.aktualisiert) ? d.aktualisiert : []) {
    if (typeof roh !== 'object' || roh === null) continue
    const a = roh as Record<string, unknown>
    if (typeof a.id !== 'string') continue
    const aenderung: Aenderung = { id: a.id }
    // Den Titel darf nur Claude ändern (Werkzeug, Block) - Haiku nicht, er ist der Schlüssel gegen Doppelte.
    for (const [feld, max] of [['frage', 300], ['info', 300], ['anleitung', 4000], ['abwaegung', 800]] as const) {
      const wert = text(a[feld], max)
      if (wert !== '') aenderung[feld] = wert
    }
    const optionen = optionenLesen(a.optionen)
    if (optionen.length > 0) aenderung.optionen = optionen
    const s = stufe(a.stufe)
    if (s !== undefined) aenderung.stufe = s
    // Aus der Entscheidung wird eine Aufgabe (oder umgekehrt), wenn sich zeigt, dass der Nutzer selbst handeln muss.
    if (a.art === 'aufgabe' || a.art === 'entscheidung') aenderung.art = a.art
    aktualisiert.push(aenderung)
  }

  // "erledigt": IDs oder (seit 0.11.0) {id, grund}
  const erledigt: string[] = []
  const gruende: Record<string, string> = {}
  for (const x of Array.isArray(d.erledigt) ? d.erledigt : []) {
    if (typeof x === 'string') erledigt.push(x)
    else if (typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string') {
      const id = (x as Record<string, unknown>).id as string
      erledigt.push(id)
      const g = text((x as Record<string, unknown>).grund, 120)
      if (g !== '') gruende[id] = g
    }
  }

  return { neu, aktualisiert, erledigt, gruende, erwaehnt: ids(d.erwaehnt), ueberblick: text(d.ueberblick, 2000) }
}

/** Hinweis an Claude (einmal je Unterhaltung, prompt.context): so schließt er Punkte selbst. */
/**
 * Hinweis bei Eintrag „block“ (Standard): Claude schreibt offene Punkte als Block ans Ende seiner Antwort.
 * Kein Werkzeug im Katalog (rund 800 Tokens in jeder Anfrage) und keine zusätzliche Modellrunde für den
 * Aufruf - der Block wird aus der fertigen Antwort gelesen wie „erledigt: #N“.
 */
export const HINWEIS_BLOCK = `Das Plugin offene-punkte führt die offenen Fragen an den Nutzer mit Nummern und stellt sie ihm über der Eingabe als Auswahl. Es liest deine Antworten nicht mit, nur einen Block darin: Brauchst du etwas vom Nutzer, das leicht untergeht (Entscheidung mit Folgen, Freigabe, Zugangsdaten, Prüfung von Hand, Aufgabe auf seinem Rechner oder Handy), schreib ans Ende deiner Antwort einen Block in dieser Form:
\`\`\`offen
# Titel (2-5 Wörter) | aufgabe oder entscheidung | blockiert, normal oder angebot
Die Frage an den Nutzer, ein Satz?
a) Empfehlung (Label, höchstens 6 Wörter)
b) Alternative - endet das Label mit ":", ergänzt der Nutzer noch Text
info: warum offen, ein Satz (kann entfallen)
anleitung: nur bei Aufgaben - Schritte mit allen Befehlen, Pfaden und Werten wörtlich, Befehle als eigene Zeilen mit "$ " davor
\`\`\`
Mehrere Punkte: je einer ab "# ". Einen bestehenden Punkt änderst du mit "# #<Nr> Titel" (nur die Zeilen, die sich ändern). Höchstens zwei Möglichkeiten, die Empfehlung zuerst; keine für Später, Schon erledigt, Nicht relevant oder eigene Antwort - die gibt es immer. Kein Punkt für die eine Rückfrage, die der Nutzer gleich beantwortet, für "neu starten?", für Prüfungen, die du selbst machen kannst, oder für Angebote ohne Folgen. Die offene Liste kommt als Kontext „Offene Punkte“ mit, wenn sie sich ändert; die Nummer eines neuen Punkts meldet das Plugin im nächsten Turn. Erledigtes oder Hinfälliges schließt du mit einer Zeile „erledigt: #<Nr>“ (mehrere: „erledigt: #3, #5“) bzw. „überholt: #<Nr> – kurzer Grund“. Nummern nur von dort übernehmen, nie raten oder hochzählen; ohne Nummer „erledigt: Titel“. Seine Antwort („Zum offenen Punkt #<Nr> …“) liegt bei dir: umgesetzt, dann „erledigt: #<Nr>“; bleibt etwas offen, öffne ihn mit „# #<Nr> Titel“ wieder. Handlungen des Nutzers als Absicht („Ich kläre das“), nie als Ergebnis. Punkte nennst du immer mit #<Nr>. Seiten der Projekt-Webseite nennst du mit voller Adresse (https://beispiel.de/admin statt /admin).`

/** Hinweis bei Auswertung „claude“: Claude legt Punkte selbst an, statt dass Haiku jede Antwort liest. */
/**
 * Die offenen Punkte als Kontext für Claude: kurz, mit Nummer, damit er Erledigtes und
 * Überholtes selbst schließt - er kennt den ganzen Verlauf, Haiku nur die letzte Antwort.
 * Geht mit, wenn sie sich geändert hat, und nach einer Compaction noch einmal.
 */
export function listeFuerClaude(punkte: readonly Punkt[], s: Sicht): string {
  const liste = offene(punkte).filter(p => !fremd(p, s.sitzung) && p.nr !== undefined).slice(0, 20)
  if (liste.length === 0) return ''
  const zeilen = liste.map(p => {
    const frage = p.frage.length > 140 ? p.frage.slice(0, 139) + '…' : p.frage
    return `#${p.nr} ${p.titel}${vermerk(p, s)}: ${frage}`
  })
  return `Offene Punkte (Plugin offene-punkte): Erledigtes oder Hinfälliges mit „erledigt: #<Nr>“ bzw. „überholt: #<Nr> – Grund“ schließen, sonst nicht darauf eingehen.\n${zeilen.join('\n')}`
}

/** Eine Antwort, die nach etwas fragt oder um etwas bittet - dort stehen die Dinge, die untergehen. */
const FRAGE_AM_ENDE = /\?\s*\**\s*$/

const BITTE = /\b(soll ich|sollen wir|darf ich|magst du|möchtest du|willst du|brauche ich (noch )?von dir|bitte (prüf|teste|schau|bestätig|gib|schick)|prüf(e)? bitte|noch offen|deine freigabe)/i

/**
 * Haiku fasst nur nach, wenn Claude in dieser Antwort keinen Block geschrieben hat und ihr
 * Schluss nach etwas fragt oder um etwas bittet - dort stehen die Fragen.
 */
export function nachfassen(antwort: string): boolean {
  const schluss = antwort.trim().slice(-1500)
  return schluss.length >= 10 && (FRAGE_AM_ENDE.test(schluss) || BITTE.test(schluss))
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

/**
 * Auftrag für einen frischen Überblick (die Karte in claude-web, oben in /offen): aus dem
 * ganzen Verlauf statt fortgeschrieben, damit ein veralteter Stand nicht weiterlebt.
 * /zusammenfassung stellt ihn dem Hauptmodell; claude-web liest ihn für Sitzungen anderer
 * Rechner aus dieser Datei und stellt ihn Haiku mit dem Verlauf.
 */
export const UEBERBLICK_NEU = `Schreibe einen kurzen ÜBERBLICK über die ganze Sitzung neu, damit der Nutzer den Faden behält – nicht fortschreiben, ein früherer Überblick kann veraltet sein. Steht unten ein VERLAUF, geht es um ihn. Nur Text, keine Werkzeuge. Deutsch, Markdown, höchstens 8 Zeilen, als Liste mit diesen fett gesetzten Anfängen, nur wenn es etwas dazu gibt: **Ziel:** worum es in der Sitzung geht · **Erledigt:** die wichtigsten Ergebnisse (knapp, neueste zuerst, Älteres zusammenfassen) · **Gerade:** woran zuletzt gearbeitet wurde · **Als Nächstes:** der nächste Schritt. Keine offenen Fragen aufzählen. Antworte nur mit der Liste, ohne Einleitung. Erfinde nichts.`

/** Der Überblick aus einer Modellantwort: nur die Liste, ohne Codezaun und Einleitung; leer, wenn keine kam. */
export function ueberblickAus(antwort: string): string {
  const zeilen = String(antwort).replace(/```[a-z]*\n?/gi, '').split(/\r?\n/)
  const erste = zeilen.findIndex(z => /^\s*[-*]\s+\*\*[^*]+\*\*/.test(z))
  if (erste < 0) return ''
  return zeilen.slice(erste).join('\n').trim().slice(0, 2000)
}

/** Nach so vielen fertigen Menschen-Turns schreibt Haiku den Überblick neu (auch nach jeder Compaction). */
export const UEBERBLICK_NACH = 8

/** So viel vom Verlauf bekommt Haiku für den Überblick (der Schluss zählt am meisten). */
export const MAX_VERLAUF = 16_000

/** Eine Nachricht, wie $.session.messages() sie liefert - nur die Felder, die hier zählen. */
export type Nachricht = { role: 'user' | 'assistant'; text: string }

/**
 * Der eigene Verlauf als Text für Haiku: nur die Texte von Nutzer und Assistent, keine
 * Tool-Ergebnisse, jede Nachricht gekürzt, insgesamt höchstens MAX_VERLAUF Zeichen vom Ende.
 * Ein Fork des Hauptmodells läse dagegen den ganzen Kontext - zum Preis des Hauptmodells.
 */
export function verlaufsText(nachrichten: readonly Nachricht[], max = MAX_VERLAUF): string {
  const zeilen: string[] = []
  for (const n of nachrichten) {
    const t = (n.text ?? '').trim()
    if (t === '') continue
    const kurz = t.length > 1_500 ? `${t.slice(0, 1_200)} … ${t.slice(-250)}` : t
    zeilen.push(`${n.role === 'user' ? 'NUTZER' : 'ASSISTENT'}: ${kurz}`)
  }
  const aus = zeilen.join('\n\n')
  return aus.length > max ? '…' + aus.slice(-max) : aus
}

export const UEBERBLICK_FORT = `Schreibe den ÜBERBLICK über die Sitzung fort. Unten steht der BISHERIGE ÜBERBLICK, darunter die NEUEN NACHRICHTEN seit damals. Arbeite nur sie ein: **Erledigt:** ergänzen (neueste zuerst, Älteres zu einem Halbsatz zusammenfassen), **Gerade:** und **Als Nächstes:** ersetzen, **Ziel:** nur ändern, wenn es sich geändert hat. Gleiche Form wie bisher: Deutsch, Markdown, höchstens 8 Zeilen, Liste mit diesen fett gesetzten Anfängen, nur wenn es etwas dazu gibt. Keine offenen Fragen aufzählen. Antworte nur mit der Liste, ohne Einleitung. Erfinde nichts.`

/** So viel von den neuen Nachrichten bekommt Haiku beim Fortschreiben. */
export const MAX_VERLAUF_FORT = 7_000

/** Nach so vielen Fortschreibungen wird einmal ganz neu geschrieben, damit sich nichts einschleift. */
export const NEU_NACH_FORT = 3

export type UeberblickAnfrage = { modus: 'neu' | 'fort'; system: string; prompt: string }

/**
 * Die Anfrage für den Überblick: fortschreiben, wenn es einen gibt und bekannt ist, bis zu welcher
 * Nachricht er reicht (bis), sonst ganz neu aus dem Verlauf. Fortschreiben kostet rund ein Drittel:
 * statt des ganzen Verlaufs gehen nur der alte Überblick und die Nachrichten seither mit.
 * null: nichts zu tun (kein Verlauf, oder nichts Neues seit dem letzten Überblick).
 */
export function ueberblickAnfrage(nachrichten: readonly Nachricht[], alt: string, bis: number, fortgeschrieben = 0): UeberblickAnfrage | null {
  const fort = alt !== '' && bis > 0 && bis <= nachrichten.length && fortgeschrieben < NEU_NACH_FORT
  if (fort) {
    const neue = verlaufsText(nachrichten.slice(bis), MAX_VERLAUF_FORT)
    if (neue === '') return null
    return { modus: 'fort', system: UEBERBLICK_FORT, prompt: `BISHERIGER ÜBERBLICK:\n${alt}\n\nNEUE NACHRICHTEN seit dem letzten Überblick (älteste zuerst):\n\n${neue}` }
  }
  const verlauf = verlaufsText(nachrichten)
  if (verlauf === '') return null
  return { modus: 'neu', system: UEBERBLICK_NEU, prompt: `VERLAUF (älteste Nachricht zuerst):\n\n${verlauf}` }
}
