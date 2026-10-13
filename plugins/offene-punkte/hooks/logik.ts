import type { Art, Option, Punkt, Ruhe, Stufe, Warnung } from '../types'

/** Höchstens so viele offene Punkte führt der Mod; ältere fallen hinten weg. */
export const MAX_PUNKTE = 30
/** So viel der Antwort bekommt Haiku (der Schluss zählt am meisten). */
export const MAX_ANTWORT = 12_000
/** Nach so vielen Auswertungen ohne Bezug gilt ein Punkt als veraltet und schließt sich (wieder zu öffnen). */
export const VERALTET_NACH = 10
/** Ein Angebot, auf das so viele Antworten lang niemand eingeht, gilt als stilles Nein. */
export const ANGEBOT_VERFALL = 4
/** Muss zu .claude-plugin/plugin.json passen; steht in offen.md/offen.json, damit claude-web sieht, welche Fassung schreibt. */
export const VERSION = '0.15.0'
/** So oft prüft eine laufende Sitzung, ob ein Abgleich fällig ist - Server-Sitzungen laufen tagelang ohne Neustart. */
export const ABGLEICH_TAKT_MS = 60 * 60_000
/** Ab so viel Prozent des 5-Stunden-Fensters ruft der Mod kein Haiku mehr (Option haikuBisProzent). */
export const BUDGET_GRENZE = 85

/** Eingaben, die kein Mensch getippt hat, obwohl sie aus der Eingabe kommen: claude-webs Klärung (per tmux). */
const MASCHINEN_EINGABE = /^\s*(?:Automatische Kl(?:ä|ae)rung|Vor Ablauf des Caches)\b/i
export const istMaschinenEingabe = (text: string): boolean => MASCHINEN_EINGABE.test(text)

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
    version: VERSION,
  })

/** Fester Teil des Auftrags - steht vorn, damit der Prompt-Cache ihn hält. */
export const AUFTRAG = `Du liest die letzte Antwort eines Coding-Assistenten an seinen Nutzer und findest OFFENE PUNKTE: Dinge, die noch nicht erledigt sind und eine Entscheidung, Freigabe, Zuarbeit oder Prüfung des Nutzers brauchen - besonders solche, die leicht untergehen.

Typisch: "vor dem Freischalten brauche ich von dir ...", Freigaben zum Ausrollen/Löschen/Pushen, Texte oder Zugangsdaten, die der Nutzer liefern muss, Abnahmen und Prüfungen von Hand ("prüfe bitte ...", "noch offen ..."), Entscheidungen zwischen Varianten, angebotene nächste Schritte ("soll ich ...?", "könnte ich auch vorziehen").

Kein offener Punkt: was der Assistent schon erledigt hat, reine Erklärungen, Selbstverständliches, Dinge ohne Zutun des Nutzers. Auch keiner: Prüfungen, die der Assistent selbst machen kann (Logs, Dienststatus, Tests, Dateien nachsehen) - es sei denn, er bittet ausdrücklich den Nutzer, weil nur dieser es sehen kann (Bildschirm, Handy, Postfach). Und keiner für eine Frage, die der Assistent gerade selbst als Auswahl-Dialog stellt. Auch keiner: was der Assistent über eine ANDERE Claude-Sitzung berichtet (ein anderes Projekt, eine Sitzung auf einem anderen Rechner) - deren offene Punkte, Fragen und Arbeit werden dort geführt, auch wenn er anbietet, sie hier durchzugehen. Ein Punkt ist nur, was diese Sitzung selbst vom Nutzer braucht.

Jeder Punkt hat eine "art": "entscheidung", wenn der Nutzer nur wählen oder freigeben muss; "aufgabe", wenn er selbst etwas tun muss (etwas auf seinem Rechner ausführen, einrichten, Daten liefern, von Hand prüfen). Bei einer Aufgabe schreibe in "anleitung", was genau zu tun ist, so dass der Nutzer NICHT im Verlauf suchen muss: nummerierte Schritte, alle Befehle, Pfade, Dateinamen, Einstellungen und Werte WÖRTLICH aus der Antwort, Befehle und Dateiinhalte in Markdown-Codeblöcken (Shell-Befehle mit \`\`\`bash). Nichts erfinden, nichts weglassen, was zum Ausführen nötig ist. Bei einer Entscheidung bleibt "anleitung" leer, außer ein Satz Kontext hilft beim Entscheiden.

Jeder Punkt hat eine "stufe": "blockiert", wenn der Assistent ohne den Nutzer nicht weitermachen kann (Freigabe, fehlende Zugangsdaten, Entscheidung, an der die weitere Arbeit hängt); "angebot", wenn der Assistent nur etwas Zusätzliches anbietet ("könnte ich auch noch ...", "falls du willst ..."); sonst "normal".

In "abwaegung" stehen die Argumente aus der Antwort, die für die Entscheidung zählen (Vor- und Nachteile, Gründe, Empfehlung des Assistenten), höchstens drei Sätze - damit man später nachvollziehen kann, warum so entschieden wurde. Nichts erfinden; gibt die Antwort keine Gründe her, bleibt es leer.

Für jeden neuen Punkt: eine kurze Frage an den Nutzer und 1 bis 4 Antwortmöglichkeiten (bei einem Angebot reicht oft eine: das konkrete Ja; ablehnen kann der Nutzer immer mit "Nicht relevant"). Jede Möglichkeit hat ein kurzes "label" (höchstens 6 Wörter) und eine "antwort": der Satz, den der Nutzer dem Assistenten damit schickt (Ich-Form, konkret, z. B. "Ja, rolle es aus."). Braucht eine Antwort noch eine Eingabe des Nutzers (eigener Text, eine Zahl, eine Fehlermeldung), ende die "antwort" mit einem Doppelpunkt - sie wird dann nur vorbereitet, nicht abgeschickt.

WER HANDELT, MUSS KLAR SEIN: In "antwort" spricht immer der Nutzer ("ich" = der Nutzer, "du" = der Assistent). Sie wird genau so abgeschickt, als hätte der Nutzer sie selbst getippt: nie aus Sicht des Assistenten ("Ich übernehme das" hieße dann, der Nutzer übernimmt) und nie über den Assistenten in der dritten Person ("Claude soll …", "Der Assistent prüft …"). Soll der Assistent handeln: "Prüf das bitte.", "Ja, rolle es aus." Handelt der Nutzer selbst: "Ich prüfe das selbst, Ergebnis:". Das "label" steht ohne "ich" und ohne "du", ohne Personalpronomen: entweder als Anweisung an den Assistenten ("Übernimm: prüfen", "Rolle aus") oder mit ausdrücklichem Handelnden ("Mache ich selbst" ist verboten, stattdessen "Nutzer prüft selbst"). Nie ein Label wie "Ich erledige das", bei dem offen bleibt, wer gemeint ist.

ADRESSEN: Nennt die Antwort die Webseite des Projekts (z. B. https://beispiel.de), schreib Seiten darauf in "frage", "info" und "anleitung" mit voller Adresse ("https://beispiel.de/admin/vorschlaege" statt "/admin/vorschlaege") - sie werden dann zum Link.

MEHRFACHAUSWAHL: Schließen sich die Möglichkeiten nicht gegenseitig aus, sondern lassen sich sinnvoll kombinieren (z. B. welche von mehreren Erweiterungen, welche Projekte, welche Schritte), setze "mehrfach": true - der Nutzer kann dann mehrere ankreuzen, ihre "antwort"-Sätze gehen zusammen an den Assistenten. Formuliere jede "antwort" dann so, dass sie auch in Kombination mit den anderen trägt. Bei Entweder-oder-Entscheidungen (A oder B, Ja oder Nein) "mehrfach": false.

Die Möglichkeiten müssen SPEZIFISCH sein, nicht allgemein:
- Nenne die Dinge aus der Antwort beim Namen: Varianten, Dateien, Befehle, Zahlen, Ergebnisse. Schlecht: "Ja, so machen" / "Es gibt ein Problem". Gut: "Erst Lazy Loading, dann WebP" / "Mail liegt im Spam".
- Bei einer Entscheidung: die echten Alternativen aus der Antwort, die Empfehlung des Assistenten zuerst; auch sinnvolle Kombinationen oder Abstufungen ("nur X", "X und Y").
- Bei einer Aufgabe, die der Nutzer selbst tun oder prüfen muss: die möglichen ERGEBNISSE, die er zurückmeldet ("Push kam an", "Fehler beim Login:"), Fehlerfälle mit Doppelpunkt, damit er die Meldung einfügen kann.
- AN DEN ASSISTENTEN ÜBERGEBEN: Könnte der Assistent die Aufgabe ganz oder teilweise selbst erledigen (Befehle ausführen, Dateien ändern, Logs oder Seiten prüfen, etwas nachsehen), gib eine oder mehrere Möglichkeiten, sie ihm zu übergeben - jede mit dem genauen Umfang, z. B. "Übernimm: nur prüfen" ("Prüf du das bitte, ändere aber noch nichts.") und "Übernimm: prüfen und beheben" ("Prüf das und behebe, was nicht stimmt."), oder "Übernimm mit Variante B". Keine solche Möglichkeit, wenn nur der Nutzer es kann (sein eigener Rechner, sein Postfach oder Konto, Zugangsdaten, persönliche Vorlieben) oder der Assistent ohnehin nur auf das Ja wartet.
- ERST DURCHPLANEN: Ist eine Entscheidung unklar oder groß (mehrere zusammenhängende Fragen, Umfang oder Ziel noch offen, ein Umbau oder eine neue Funktion), gib zusätzlich die Möglichkeit "Erst Planungsinterview" mit der antwort "Lass uns das erst im Planungsinterview durchgehen: frag mich die offenen Details einzeln ab." Bei einfachen Ja/Nein- oder A/B-Fragen nicht.

Diese Möglichkeiten gibt es immer schon als feste Knöpfe, gib sie NICHT selbst an: freie eigene Antwort, "Später" (auch "mache/prüfe ich später"), "Schon erledigt", "Nicht relevant" (schließt ohne Nachricht - ein "Nein, so lassen" brauchst du nur, wenn das Nein dem Assistenten etwas mitteilt, das er wissen muss). Auch kein "Erledige ich selbst": das schließt den Punkt, bevor etwas getan ist.

Außerdem führst du einen kurzen ÜBERBLICK über die ganze Sitzung, damit der Nutzer den Faden behält: Schreibe den bisherigen Überblick (unten) mit dem Neuen aus der Antwort fort. Markdown, höchstens 8 Zeilen, als Liste mit diesen fett gesetzten Anfängen, nur wenn es etwas dazu gibt: **Ziel:** worum es in der Sitzung geht · **Erledigt:** die wichtigsten Ergebnisse (knapp, neueste zuerst, Älteres zusammenfassen) · **Gerade:** woran zuletzt gearbeitet wurde · **Als Nächstes:** der nächste Schritt. Keine Wiederholung der offenen Punkte.

Bereits bekannte offene Punkte stehen unten mit ID. Melde sie NICHT erneut als neu, auch nicht mit anderen Worten. Für jeden bekannten Punkt gilt:
- erledigt: unter "erledigt" als {"id":"...","grund":"wenige Wörter, warum"}. Erledigt ist ein Punkt, wenn
  · die neue Antwort oder die letzte Nachricht des Nutzers ihn erledigt (getan, entschieden, beantwortet);
  · er ÜBERHOLT ist: das Gespräch hat ihn hinfällig gemacht (anderer Weg gewählt, Thema abgeschlossen, Frage durch spätere Arbeit beantwortet, der Assistent hat es inzwischen selbst geprüft);
  · STILLES OK: Es war eine Prüfbitte an den Nutzer (ansehen, testen, neu laden, ausprobieren, Rückmeldung ob es klappt) und die letzte Nachricht des Nutzers macht mit etwas anderem weiter, ohne einen Fehler oder ein Problem zu melden. Entscheidungen, Freigaben und Daten, die der Nutzer liefern muss, schließt das stille OK NICHT.
  · STILLES NEIN: Es war ein Angebot des Assistenten ("soll ich noch ...?", "könnte ich auch ...") und der Nutzer geht in seiner letzten Nachricht nicht darauf ein, sondern macht mit etwas anderem weiter.
  Im Zweifel offen lassen.
- Die KÜRZLICH GESCHLOSSENEN Punkte (unten) sind beantwortet oder erledigt: melde sie und Fragen mit demselben Inhalt NICHT erneut als neu, auch nicht mit anderen Worten - außer die Antwort sagt ausdrücklich, dass es wieder offen ist.
- noch offen, aber die Antwort bringt Neues dazu (genauere Anleitung, geänderte Frage oder Möglichkeiten, andere Stufe): unter "aktualisiert" mit seiner ID und NUR den Feldern, die sich ändern;
- noch offen und die Antwort oder die Nachricht des Nutzers geht darauf ein, ohne dass sich etwas ändert: ID unter "erwaehnt".

Antworte NUR mit JSON, ohne Erklärung, in genau dieser Form:
{"neu":[{"titel":"2-5 Wörter","art":"aufgabe","stufe":"normal","frage":"Ein Satz?","info":"Warum offen, ein Satz.","abwaegung":"","anleitung":"1. ...\n\`\`\`bash\nbefehl\n\`\`\`","mehrfach":false,"optionen":[{"label":"...","antwort":"..."}]}],"aktualisiert":[{"id":"...","anleitung":"..."}],"erledigt":[{"id":"...","grund":"..."}],"erwaehnt":["id"],"ueberblick":"- **Ziel:** ..."}
Gibt es nichts davon: {"neu":[],"aktualisiert":[],"erledigt":[],"erwaehnt":[],"ueberblick":"..."}`

/**
 * Auftrag fürs Nachfassen (Auswertung „claude“): Claude trägt Punkte selbst ein; Haiku springt nur ein,
 * wenn die Antwort fragt und nichts eingetragen wurde. Kurz gehalten (rund ein Fünftel von AUFTRAG), ohne
 * Überblick, und streng: die Schlussfrage allein ist kein Punkt - der Nutzer beantwortet sie gleich.
 */
export const NACHFASSEN_AUFTRAG = `Du liest die letzte Antwort eines Coding-Assistenten an seinen Nutzer. Der Assistent trägt offene Punkte normalerweise selbst ein; hier hat er nichts eingetragen, obwohl die Antwort mit einer Frage oder Bitte endet. Finde NUR, was verloren ginge, wenn der Nutzer jetzt bloß auf die Schlussfrage antwortet: Aufgaben, die er selbst auf seinem Rechner, Handy oder Konto erledigen muss; Freigaben oder Entscheidungen mit Folgen, die in der Antwort genannt, aber nicht als Schlussfrage gestellt sind; Daten oder Zugangsdaten, die er liefern muss; mehrere Fragen auf einmal, von denen eine untergehen kann.

KEIN Punkt für: die einzelne Rückfrage am Ende, die der Nutzer sowieso gleich beantwortet; Angebote ("soll ich noch …?", "könnte ich auch …"); "neu starten?"; Prüfungen, die der Assistent selbst machen kann (Logs, Tests, Dateien, Dienste); Erklärungen; Fragen, die der Assistent als Auswahl-Dialog stellt; alles, was eine ANDERE Claude-Sitzung betrifft. Im Zweifel nichts eintragen: {"neu":[],"erledigt":[],"erwaehnt":[]}.

Jeder Punkt: "titel" (2-5 Wörter), "art" ("aufgabe": der Nutzer tut selbst etwas; "entscheidung": er wählt oder gibt frei), "stufe" ("blockiert": ohne ihn geht es nicht weiter; sonst "normal"), "frage" (ein Satz an den Nutzer), "info" (warum offen, ein Satz), "abwaegung" (Gründe aus der Antwort, höchstens ein Satz, sonst leer), "anleitung" (nur bei Aufgaben: nummerierte Schritte mit allen Befehlen, Pfaden und Werten WÖRTLICH aus der Antwort, Befehle in \`\`\`bash-Blöcken; sonst leer), "optionen": 1 bis 2, die Empfehlung zuerst, jede mit "label" (höchstens 6 Wörter, spezifisch, ohne ich/du) und "antwort" (der Satz, den der Nutzer dem Assistenten damit schickt, Ich-Form aus Sicht des Nutzers; endet sie mit ":", muss der Nutzer noch etwas ergänzen). Keine Optionen für Später, Schon erledigt, Nicht relevant, eigene Antwort - die gibt es immer. Nennt die Antwort die Webseite des Projekts, schreib Seiten mit voller Adresse.

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
export type Aenderung = { id: string } & Partial<Pick<Punkt, 'titel' | 'frage' | 'info' | 'anleitung' | 'abwaegung' | 'optionen' | 'stufe'>>

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

const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.trim().slice(0, max) : '')
const stufe = (x: unknown): Stufe | undefined => (x === 'blockiert' || x === 'normal' || x === 'angebot' ? x : undefined)
const ids = (x: unknown): string[] => (Array.isArray(x) ? x : []).filter((y): y is string => typeof y === 'string')

/** Was die festen Knoepfe schon abdecken (Spaeter, Schon erledigt) - kommt es trotzdem, faellt es weg. */
const DOPPELT = /^(später|(erledige|mache|prüfe|teste) ich (selbst|später)|(mache|prüfe|teste) ich selbst)$/i

function optionenLesen(x: unknown): Option[] {
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

/** Ergebnis eines Punkts, den die Auswertung geschlossen hat (davor ggf. „ – Grund“). */
export const ERKANNT = 'laut Gespräch erledigt'
/** So lange zeigen /offen und claude-web automatisch geschlossene Punkte mit „wieder öffnen“. */
export const AUTO_ZEIGEN_MS = 24 * 3600 * 1000

/** Hinweis an Claude (einmal je Unterhaltung, prompt.context): so schließt er Punkte selbst. */
export const HINWEIS_CLAUDE = 'Das Plugin offene-punkte führt die offenen Fragen an den Nutzer mit Nummern; die aktuelle Liste kommt als Kontext „Offene Punkte“ mit seinen Nachrichten, sobald sie sich ändert. Der Nutzer will nichts wegklicken, das sich schon erledigt hat: Ist ein Punkt dort durch deine Arbeit oder das Gespräch erledigt oder entschieden, schreib in deine Antwort eine Zeile „erledigt: #<Nr>“ (mehrere: „erledigt: #3, #5“); ist er hinfällig (anderer Weg, Angebot nicht aufgegriffen, betrifft nichts mehr), „überholt: #<Nr> – kurzer Grund“. Der Punkt schließt sich dann sofort und lässt sich per /offen wieder öffnen. Nennst du Seiten einer Webseite des Projekts, schreib die volle Adresse (https://beispiel.de/admin/vorschlaege statt /admin/vorschlaege) - dann ist sie ein Link.'

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
Mehrere Punkte: je einer ab "# ". Einen bestehenden Punkt änderst du mit "# #<Nr> Titel" (nur die Zeilen, die sich ändern). Höchstens zwei Möglichkeiten, die Empfehlung zuerst; keine für Später, Schon erledigt, Nicht relevant oder eigene Antwort - die gibt es immer. Kein Punkt für die eine Rückfrage, die der Nutzer gleich beantwortet, für "neu starten?", für Prüfungen, die du selbst machen kannst, oder für Angebote ohne Folgen. Die offene Liste kommt als Kontext „Offene Punkte“ mit, wenn sie sich ändert. Erledigtes oder Hinfälliges schließt du mit einer Zeile „erledigt: #<Nr>“ (mehrere: „erledigt: #3, #5“) bzw. „überholt: #<Nr> – kurzer Grund“. Seiten der Projekt-Webseite nennst du mit voller Adresse (https://beispiel.de/admin statt /admin).`

/** Hinweis bei Auswertung „claude“: Claude legt Punkte selbst an, statt dass Haiku jede Antwort liest. */
export const HINWEIS_WERKZEUG = 'Das Plugin offene-punkte führt die offenen Fragen an den Nutzer mit Nummern und stellt sie ihm über der Eingabe als Auswahl. Es liest deine Antworten NICHT mit: Brauchst du etwas vom Nutzer, das leicht untergeht (Entscheidung, Freigabe, Zugangsdaten, Prüfung von Hand, Angebot für einen nächsten Schritt), trag es selbst mit dem Werkzeug mcp__offene-punkte__punkte ein (Feld "neu"), in derselben Antwort. Die aktuelle Liste kommt als Kontext „Offene Punkte“ mit den Nachrichten des Nutzers, sobald sie sich ändert. Der Nutzer will nichts wegklicken, das sich schon erledigt hat: Ist ein Punkt erledigt, entschieden oder hinfällig, schließ ihn mit dem Werkzeug (Feld "schliessen") oder mit einer Zeile „erledigt: #<Nr>“ bzw. „überholt: #<Nr> – kurzer Grund“ in deiner Antwort. Nennst du Seiten einer Webseite des Projekts, schreib die volle Adresse (https://beispiel.de/admin/vorschlaege statt /admin/vorschlaege) - dann ist sie ein Link.'

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
  const perTitel = /^[ \t]*[*_]*(erledigt|überholt|ueberholt|hinfällig):[*_]*[ \t]*([^#\s][^\n]*)$/gim
  for (const m of antwort.matchAll(perTitel)) {
    const ueberholt = !/^erledigt$/i.test(m[1] ?? '')
    const [roh, ...rest] = (m[2] ?? '').split(/[ \t]+[–—-][ \t]+/)
    const titel = (roh ?? '').replace(/[*_`„“"]+/g, '').trim()
    if (titel === '' || titel.length > 80) continue
    aus.set(`t:${schluessel(titel)}`, { nr: -1, ueberholt, grund: rest.join(' – ').trim().replace(/[*_`]+$/, '').slice(0, 120), titel })
  }
  return [...aus.values()]
}

/** „erledigt: #3, #5“ in einer Antwort von Claude: die Nummern (auch „überholt:“). */
export const erledigtMarken = (antwort: string): number[] => schlussMarken(antwort).filter(m => m.nr >= 0).map(m => m.nr)

/** Schließt offene Punkte, die eine Marke nennt - per Nummer oder per Titel (gleich, oder einer enthält den anderen). */
export function perMarkeSchliessen(liste: readonly Punkt[], marken: readonly (number | Marke)[], jetzt: number): Punkt[] {
  const n = new Map<number, Marke>()
  const titel: Marke[] = []
  for (const m of marken) {
    if (typeof m === 'number') n.set(m, { nr: m, ueberholt: false, grund: '' })
    else if (m.titel !== undefined) titel.push(m)
    else n.set(m.nr, m)
  }
  const passt = (p: Punkt): Marke | undefined => {
    const perNr = p.nr !== undefined ? n.get(p.nr) : undefined
    if (perNr !== undefined) return perNr
    const s = schluessel(p.titel)
    return titel.find(m => {
      const t = schluessel(m.titel ?? '')
      return t === s || (t.length >= 8 && s.length >= 8 && (s.includes(t) || t.includes(s)))
    })
  }
  return liste.map(p => {
    if (p.status !== 'offen' || p.ausstehend !== undefined) return p
    const m = passt(p)
    if (m === undefined) return p
    const grund = `von Claude als ${m.ueberholt ? 'überholt' : 'erledigt'} gemeldet${m.grund !== '' ? ` – ${m.grund}` : ''}`
    return { ...p, status: 'erledigt' as const, ergebnis: grund, auto: { grund, zeit: jetzt }, geaendert: jetzt }
  })
}

/**
 * Was lange keine Rolle mehr spielt, schließt sich selbst statt „noch aktuell?“ zu fragen:
 * nach VERALTET_NACH Auswertungen ohne Bezug, ein Angebot schon nach ANGEBOT_VERFALL.
 * Zurückgelegtes, Zurückgestelltes und selbst Notiertes bleibt - darüber hat der Nutzer entschieden.
 */
export function veraltetSchliessen(liste: readonly Punkt[], jetzt: number): Punkt[] {
  return liste.map(p => {
    if (p.status !== 'offen' || p.ausstehend !== undefined || p.vonNutzer === true || p.ruht !== undefined || p.zurueckgestellt > 0) return p
    const n = p.ohneBezug ?? 0
    const angebot = p.stufe === 'angebot' && n >= ANGEBOT_VERFALL
    if (!angebot && n < VERALTET_NACH) return p
    const grund = angebot ? `Angebot nicht aufgegriffen (${n} Antworten lang)` : `veraltet – ${n} Antworten lang nicht mehr erwähnt`
    return { ...p, status: 'erledigt' as const, ergebnis: grund, auto: { grund, zeit: jetzt }, geaendert: jetzt }
  })
}

/** Automatisch geschlossene Punkte, die noch angezeigt werden (neueste zuerst). */
export const autoErledigt = (liste: readonly Punkt[], jetzt: number): Punkt[] =>
  liste.filter(p => p.status === 'erledigt' && p.auto !== undefined && jetzt - p.auto.zeit < AUTO_ZEIGEN_MS)
    .sort((a, b) => (b.auto?.zeit ?? 0) - (a.auto?.zeit ?? 0))

/** Für den Vergleich gleicher Punkte: klein, ohne Satzzeichen. */
export const schluessel = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Führt eine Auswertung in die Liste: erledigte schließen, bekannte nachschärfen,
 * neue anhängen (ein Punkt mit gleichem Titel wie ein offener kommt nicht doppelt).
 * Offene Punkte ohne Bezug in dieser Antwort zählen einen Schritt Richtung veraltet.
 */
export function zusammenfuehren(punkte: readonly Punkt[], a: Auswertung, jetzt: number, neueId: () => string, ab = 0): Punkt[] {
  const erledigt = new Set(a.erledigt)
  const aenderungen = new Map(a.aktualisiert.map(x => [x.id, x]))
  const bezug = new Set([...a.erwaehnt, ...aenderungen.keys()])

  const liste = punkte.map(p => {
    // Schon beantwortet (nur noch nicht bei Claude): gilt als geschlossen.
    // Vom Nutzer selbst angelegt: bleibt, wie er ist, bis er ihn beantwortet.
    if (p.status !== 'offen' || p.ausstehend !== undefined || p.vonNutzer === true) return p
    if (erledigt.has(p.id)) {
      const grund = a.gruende?.[p.id] ?? ''
      return { ...p, status: 'erledigt' as const, ergebnis: ERKANNT + (grund !== '' ? ` – ${grund}` : ''),
               auto: { grund: grund || ERKANNT, zeit: jetzt }, geaendert: jetzt }
    }
    const { id: _id, ...felder } = aenderungen.get(p.id) ?? { id: '' }
    return { ...p, ...felder, ohneBezug: bezug.has(p.id) ? 0 : (p.ohneBezug ?? 0) + 1 }
  })
  // Nicht neu anlegen, was offen ist oder vor kurzem geschlossen wurde („das ist doch ein alter Punkt“).
  const vorhanden = new Set(liste
    .filter(p => p.status === 'offen' || jetzt - (p.geaendert ?? p.erstellt) < WIEDER_NEU_NACH_MS)
    .map(p => schluessel(p.titel)))

  for (const n of a.neu) {
    const s = schluessel(n.titel)
    if (vorhanden.has(s)) continue
    vorhanden.add(s)
    liste.push({ id: neueId(), ...n, status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: jetzt })
  }

  return nummerieren(begrenzen(veraltetSchliessen(liste, jetzt)), ab)
}

/** So lange nach dem Schließen legt die Auswertung einen Punkt mit gleichem Titel nicht neu an. */
export const WIEDER_NEU_NACH_MS = 3 * 24 * 3600_000

/** Die höchste Nummer in der Liste, offen oder geschlossen (0: keine). */
export const hoechsteNr = (liste: readonly Punkt[]): number => Math.max(0, ...liste.map(p => p.nr ?? 0))

/**
 * Gibt offenen Punkten ohne Nummer die nächste: fortlaufend je Projekt, über der höchsten
 * in der Liste und über ab (höchste je vergebene). Eine Nummer kommt nie zweimal vor und
 * bleibt am Punkt, auch geschlossen - "#12" meint im Verlauf immer denselben Punkt.
 */
export function nummerieren(liste: readonly Punkt[], ab = 0): Punkt[] {
  let n = Math.max(ab, hoechsteNr(liste))
  return liste.map(p => (p.status === 'offen' && p.nr === undefined ? { ...p, nr: ++n } : p))
}

/** Die beantworteten, noch nicht gesendeten Punkte (wo: nur diese), in der Reihenfolge der Antworten. */
export function ausstehende(punkte: readonly Punkt[], wo?: 'sammlung' | 'eingabe'): Punkt[] {
  return punkte
    .filter(p => p.status === 'offen' && p.ausstehend !== undefined && (wo === undefined || p.ausstehend.wo === wo))
    .sort((a, b) => (a.ausstehend?.reihe ?? 0) - (b.ausstehend?.reihe ?? 0))
}

/** Die Antworten sind bei Claude: die Punkte schließen sich (ergebnisse: abweichendes Ergebnis je id). */
export function abschliessen(liste: readonly Punkt[], ids: ReadonlySet<string>, ergebnisse: ReadonlyMap<string, string> = new Map()): Punkt[] {
  return liste.map(p => {
    if (!ids.has(p.id) || p.ausstehend === undefined) return p
    const { ausstehend: a, ...rest } = p
    return { ...rest, status: a.status, ergebnis: ergebnisse.get(p.id) ?? a.ergebnis }
  })
}

/** Die Antworten kamen nicht an: die Punkte werden wieder gefragt (ids fehlt: alle). */
export function zuruecknehmen(liste: readonly Punkt[], ids?: ReadonlySet<string>): Punkt[] {
  return liste.map(p => {
    if (p.ausstehend === undefined || (ids !== undefined && !ids.has(p.id))) return p
    const { ausstehend: _a, ...rest } = p
    return rest
  })
}

/**
 * Was der Nutzer in der abgeschickten Nachricht zu einem Punkt geschrieben hat: der Text
 * nach „Titel“: bis zur nächsten Antwort. null: der Punkt steht nicht (mehr) darin.
 */
export function antwortIn(nachricht: string, titel: string): string | null {
  // „Titel“: oder „Titel“ (Frage): - die Frage steht bei Block-Punkten dabei.
  const anfang = nachricht.indexOf(`„${titel}“`)
  if (anfang < 0) return null
  const marke = /^„[^“]*“(?:[ \t]*\([^)\n]*\))?:/.exec(nachricht.slice(anfang))
  if (marke === null) return null
  const rest = nachricht.slice(anfang + marke[0].length)
  const ende = rest.search(/\n(- „|Zum offenen Punkt „)/)
  return (ende < 0 ? rest : rest.slice(0, ende)).trim()
}

/**
 * Antworten, die der Nutzer selbst in seine Nachricht geschrieben hat - oder claude-web per tmux:
 * „Zum offenen Punkt #12 „Titel“: Text“, „Zum offenen Punkt „Titel“: Text“ oder Zeilen
 * „- „Titel“: Text“ unter „Zu den offenen Punkten:“. Nur offene, noch nicht beantwortete Punkte;
 * sie schließen sich, sobald die Nachricht bei Claude ist, ohne zweiten Befehl.
 */
export function eingetippteAntworten(nachricht: string, punkte: readonly Punkt[]): { id: string; text: string }[] {
  const offen = offene(punkte)
  if (offen.length === 0 || !/offenen Punkt/i.test(nachricht)) return []
  const aus: { id: string; text: string }[] = []
  const muster = /(?:Zum offenen Punkt|^[ \t]*-)[ \t]*(?:#(\d+)[ \t]*)?„([^“\n]+)“(?:[ \t]*\([^)\n]*\))?:[ \t]*([^\n]*)/gm
  for (const m of nachricht.matchAll(muster)) {
    const nr = m[1] !== undefined ? Number(m[1]) : undefined
    const s = schluessel(m[2] ?? '')
    const p = offen.find(x => (nr !== undefined && x.nr === nr) || schluessel(x.titel) === s)
    if (p === undefined || aus.some(a => a.id === p.id)) continue
    aus.push({ id: p.id, text: (m[3] ?? '').trim() })
  }
  return aus
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
    .filter(p => p.status === 'offen' && p.ausstehend === undefined)
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

/**
 * Auswertung „claude“: Haiku springt nur ein, wenn Claude das Werkzeug in dieser Antwort nicht
 * benutzt hat und ihr Schluss nach etwas fragt oder um etwas bittet - dort stehen die Fragen.
 */
export function nachfassen(antwort: string): boolean {
  const schluss = antwort.trim().slice(-1500)
  return schluss.length >= 10 && (FRAGE_AM_ENDE.test(schluss) || BITTE.test(schluss))
}

/**
 * Auswertung „claude“ (kein Haiku je Antwort): eine Antwort, die einen offenen Punkt nicht
 * erwähnt (weder „#Nr“ noch Titel), zählt ihn einen Schritt Richtung veraltet.
 */
export function altern(liste: readonly Punkt[], antwort: string, jetzt: number): Punkt[] {
  const t = schluessel(antwort)
  const gealtert = liste.map(p => {
    if (p.status !== 'offen' || p.ausstehend !== undefined || p.vonNutzer === true) return p
    const erwaehnt = (p.nr !== undefined && new RegExp(`#${p.nr}(?!\\d)`).test(antwort)) || t.includes(schluessel(p.titel))
    return { ...p, ohneBezug: erwaehnt ? 0 : (p.ohneBezug ?? 0) + 1 }
  })
  return veraltetSchliessen(gealtert, jetzt)
}

/** Name des Werkzeugs, mit dem Claude selbst Punkte anlegt und schließt (gelistet als mcp__offene-punkte__punkte). */
export const WERKZEUG = 'punkte'

export const WERKZEUG_BESCHREIBUNG = 'Führt die offenen Punkte des Nutzers (Plugin offene-punkte): Entscheidungen, Freigaben und Aufgaben, die er beantworten oder erledigen muss und die leicht untergehen; er bekommt sie über der Eingabe als Auswahl. "neu" legt Punkte an (titel 2-5 Wörter; optionen: höchstens zwei, Empfehlung zuerst, label höchstens 6 Wörter, antwort = der Satz, den der Nutzer dir damit schickt, Ich-Form; endet sie mit ":", ergänzt er Text), "aktualisieren" ändert bestehende per nr, "schliessen" meldet Erledigtes oder Hinfälliges. Nicht für Rückfragen, die der Nutzer gleich beantwortet, nicht für Prüfungen, die du selbst machen kannst, nicht für Fragen per AskUserQuestion. Keine Optionen für Später, Schon erledigt, Nicht relevant, eigene Antwort. Bei Aufgaben gehört in "anleitung" alles zum Ausführen (Schritte, Befehle in ```bash-Blöcken, Pfade).'

/** Ein neuer oder geänderter Punkt, wie Claude ihn im Werkzeug beschreibt. */
const PUNKT_FELDER = {
  titel: { type: 'string', description: '2-5 Wörter' },
  art: { type: 'string', enum: ['entscheidung', 'aufgabe'] },
  stufe: { type: 'string', enum: ['blockiert', 'normal', 'angebot'] },
  frage: { type: 'string', description: 'ein Satz an den Nutzer' },
  info: { type: 'string', description: 'warum offen, ein Satz' },
  abwaegung: { type: 'string', description: 'Gründe und Empfehlung, ein Satz' },
  anleitung: { type: 'string' },
  mehrfach: { type: 'boolean', description: 'Optionen lassen sich kombinieren' },
  optionen: {
    type: 'array',
    items: { type: 'object', properties: { label: { type: 'string' }, antwort: { type: 'string' } }, required: ['label', 'antwort'] },
  },
} as const

export const WERKZEUG_SCHEMA = {
  type: 'object',
  properties: {
    neu: {
      type: 'array',
      items: { type: 'object', properties: PUNKT_FELDER, required: ['titel', 'art', 'frage', 'optionen'] },
    },
    aktualisieren: {
      type: 'array',
      description: 'bestehende Punkte ändern, nur die Felder, die sich ändern',
      items: { type: 'object', properties: { nr: { type: 'number' }, ...PUNKT_FELDER }, required: ['nr'] },
    },
    schliessen: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nr: { type: 'number' },
          ueberholt: { type: 'boolean', description: 'hinfällig statt erledigt' },
          grund: { type: 'string', description: 'wenige Wörter' },
        },
        required: ['nr'],
      },
    },
  },
} as const

/** Eine Änderung an einem bestehenden Punkt, den Claude per Nummer nennt. */
export type NrAenderung = { nr: number } & Omit<Aenderung, 'id'>

const nummer = (x: unknown): number => (typeof x === 'number' ? x : typeof x === 'string' ? Number(x.replace('#', '')) : NaN)

/** Liest den Aufruf des Werkzeugs: neue Punkte wie aus der Auswertung, Änderungen per Nummer, zu schließende als Marken. */
export function werkzeugLesen(eingabe: unknown): { neu: Auswertung['neu']; aenderungen: NrAenderung[]; marken: Marke[] } {
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

/** Änderungen per Nummer auf die IDs der offenen Punkte abbilden; unbekannte Nummern fallen weg. */
export function aenderungenZuIds(liste: readonly Punkt[], aenderungen: readonly NrAenderung[]): Aenderung[] {
  const ids = new Map(liste.filter(p => p.status === 'offen' && p.nr !== undefined).map(p => [p.nr, p.id]))
  return aenderungen.flatMap(({ nr, ...felder }) => {
    const id = ids.get(nr)
    return id === undefined ? [] : [{ id, ...felder }]
  })
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
  const { neu, aenderungen } = werkzeugLesen({ neu: roh.filter(p => p.nr === undefined), aktualisieren: roh.filter(p => p.nr !== undefined) })
  return { neu, aenderungen }
}

/** Sprachen, deren Codeblöcke als Shell-Befehl gelten (leer: ohne Angabe). */
const SHELL = new Set(['', 'bash', 'sh', 'shell', 'console', 'zsh'])

/**
 * Die Shell-Befehle aus einer Anleitung, je Codeblock einer (mehrere Zeilen mit
 * && verbunden), höchstens drei. Kommentare und ein "$ " am Anfang fallen weg.
 */
export function befehle(anleitung: string): string[] {
  const liste: string[] = []
  // Zeilen „$ befehl“ ausserhalb von Codeblöcken (so schreibt Claude sie im Block).
  for (const m of anleitung.replace(/```[\s\S]*?```/g, '').matchAll(/^[ \t]*\$[ \t]+(.+?)[ \t]*$/gm)) {
    const befehl = (m[1] ?? '').trim()
    if (befehl !== '' && !liste.includes(befehl)) liste.push(befehl)
  }
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

/**
 * Was "Ausführen" in die Eingabe legt: eine Bitte an Claude, den Befehl mit seinem
 * Bash-Werkzeug auszuführen. Ein eingefügtes "! befehl" schaltet die Eingabe nicht
 * in den Bash-Modus, sondern ginge als Text an Claude.
 */
export function ausfuehrBitte(titel: string, befehl: string): string {
  const zaun = befehl.includes('`') ? '``' : '`'
  const abstand = zaun === '``' ? ' ' : ''
  return `Zum offenen Punkt „${titel}“: Bitte führe aus: ${zaun}${abstand}${befehl}${abstand}${zaun}`
}

/** Wie lange gesammelte Antworten nach der letzten Wahl auf weitere warten. */
export const WARTEZEIT = 30_000

/**
 * Eine gesammelte Antwort: zu welchem Punkt, und was Claude bekommt. Mit `frage`, wenn der Text nur
 * das Label einer Möglichkeit ist (Block-Punkte): dann steht die Frage dabei, damit Claude auch nach
 * einer Compaction weiss, worauf sich „55 MB“ bezieht.
 */
export type Teil = { titel: string; text: string; frage?: string }

const teilKopf = (t: Teil) => `„${t.titel}“${t.frage !== undefined && t.frage !== '' ? ` (${t.frage})` : ''}`

/**
 * Die gesammelten Antworten als eine Nachricht. Ist der letzte Text leer, endet sie
 * offen - für die Eingabe, wo der Nutzer noch etwas ergänzt.
 */
export function sammelText(teile: readonly Teil[]): string {
  if (teile.length === 1) return `Zum offenen Punkt ${teilKopf(teile[0]!)}: ${teile[0]!.text}`
  return 'Zu den offenen Punkten:\n' + teile.map(t => `- ${teilKopf(t)}: ${t.text}`).join('\n')
}

/** Kurzform eines Befehls für die Auswahl. */
export const befehlLabel = (befehl: string): string => `Ausführen: ${befehl.length > 32 ? befehl.slice(0, 31) + '…' : befehl}`

export type Kommando =
  | { art: 'liste' }
  | { art: 'leeren' }
  | { art: 'senden' }
  /** Claude soll die offenen Punkte selbst durchgehen (erledigt/überholt per Marke), ohne sie neu zu formulieren. */
  | { art: 'klaeren' }
  /** Den Überblick aus dem Verlauf neu schreiben lassen (Haiku). */
  | { art: 'ueberblick' }
  | { art: 'fehler'; text: string }
  | { art: 'neu'; text: string }
  /** Alle offenen Punkte dieser Sitzung auf einmal schließen (claude-web, Aufräumen). */
  | { art: 'alle'; tun: 'erledigt' | 'weg'; grund: string }
  | { art: 'punkt'; nummer: number; tun: 'erledigt' | 'weg' | 'spaeter' | 'aktuell' | 'option'; option?: number; bis?: Ruhezeit }
  | { art: 'punkt'; nummer: number; tun: 'optionen'; optionen: number[] }
  /** Freie Antwort auf einen Punkt: schließt ihn und geht sofort an Claude. */
  | { art: 'punkt'; nummer: number; tun: 'antwort'; text: string }

const ZEITWORT: Record<string, Ruhezeit> = { sitzung: 'sitzung', morgen: 'morgen', drei: 'drei', woche: 'woche' }

/** Liest die Argumente von /offen: "", "leeren", "neu Text", "2 erledigt", "3 weg", "1 später", "1 später morgen", "2 a", "2 antwort Text", "alle weg Grund". */
export function kommando(args: string): Kommando {
  const neu = /^neu(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (neu !== null) {
    const text = (neu[1] ?? '').trim()
    return text === '' ? { art: 'fehler', text: 'Verwendung: /offen neu <Text>' } : { art: 'neu', text }
  }
  const antwort = /^(\d+)\s+antwort(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (antwort !== null) {
    const text = (antwort[2] ?? '').trim()
    return text === '' ? { art: 'fehler', text: 'Verwendung: /offen <Nr> antwort <Text>' } : { art: 'punkt', nummer: Number(antwort[1]), tun: 'antwort', text }
  }
  const alle = /^alle\s+(weg|verwerfen|erledigt|fertig)(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (alle !== null) return { art: 'alle', tun: /^(weg|verwerfen)$/i.test(alle[1] ?? '') ? 'weg' : 'erledigt', grund: (alle[2] ?? '').trim() }
  const a = args.trim().toLowerCase()
  if (a === '') return { art: 'liste' }
  if (a === 'klären' || a === 'klaeren') return { art: 'klaeren' }
  if (a === 'überblick' || a === 'ueberblick') return { art: 'ueberblick' }
  // Mehrere Antworten: "3 a c" oder "3 a,c" (bei Punkten mit Mehrfachauswahl)
  const mehrere = /^(\d+)\s+([a-d](?:[\s,]+[a-d])+)$/.exec(a)
  if (mehrere !== null) {
    const optionen = [...new Set((mehrere[2] ?? '').split(/[\s,]+/).map(b => b.charCodeAt(0) - 97))].sort((x, y) => x - y)
    return { art: 'punkt', nummer: Number(mehrere[1]), tun: 'optionen', optionen }
  }
  if (a === 'leeren') return { art: 'leeren' }
  if (a === 'senden') return { art: 'senden' }
  const m = /^(\d+)\s+(\S+)(?:\s+(\S+))?$/.exec(a)
  if (m === null) return { art: 'fehler', text: HILFE }
  const nummer = Number(m[1])
  const wort = m[2] ?? ''
  if (m[3] !== undefined) {
    const bis = ZEITWORT[m[3]]
    if ((wort !== 'später' && wort !== 'spaeter') || bis === undefined) return { art: 'fehler', text: HILFE }
    return { art: 'punkt', nummer, tun: 'spaeter', bis }
  }
  if (/^[a-d]$/.test(wort)) return { art: 'punkt', nummer, tun: 'option', option: wort.charCodeAt(0) - 97 }
  if (wort === 'erledigt' || wort === 'fertig') return { art: 'punkt', nummer, tun: 'erledigt' }
  if (wort === 'weg' || wort === 'verwerfen') return { art: 'punkt', nummer, tun: 'weg' }
  if (wort === 'später' || wort === 'spaeter') return { art: 'punkt', nummer, tun: 'spaeter' }
  if (wort === 'aktuell') return { art: 'punkt', nummer, tun: 'aktuell' }

  return { art: 'fehler', text: HILFE }
}

const HILFE = 'Verwendung: /offen · /offen <Nr> erledigt|weg|später|aktuell · /offen <Nr> später sitzung|morgen|drei|woche · /offen <Nr> a|b|c|d (Antwort wählen, bei Mehrfachauswahl auch "a c") · /offen <Nr> antwort <Text> (freie Antwort, geht sofort) · /offen alle weg|erledigt [Grund] · /offen klären · /offen überblick · /offen neu <Text> · /offen senden (gesammelte Antworten jetzt) · /offen leeren'

/**
 * Die Bitte, die /offen klären an Claude schickt. Beginnt mit „Automatische Klärung“, damit der
 * Turn nicht ausgewertet wird (keine neuen Punkte, keine Alterung) - nur die Marken darin zählen.
 * Anders als claude-webs alte Klärung verlangt sie Marken statt neu formulierter Fragen: die
 * hielten die Punkte am Leben und erzeugten Geschwister mit anderem Titel.
 */
export function klaerungsBitte(punkte: readonly Punkt[]): string {
  const liste = punkte.map(p => `#${p.nr ?? '?'} ${p.titel} (${p.frage})`).join('; ')
  return `Automatische Klärung der offenen Punkte: ${liste}. Geh sie durch. Ist einer inzwischen erledigt, entschieden oder hinfällig - aus dem Verlauf, oder weil du es selbst nachsehen kannst (Code, Logs, Dateien, Commits) -, schreib je eine Zeile „erledigt: #N – Grund“ bzw. „überholt: #N – Grund“. Noch offene Punkte nicht neu formulieren und keine neuen Punkte anlegen; nenne sie höchstens als „offen: #N – was noch fehlt“ in einer Zeile. Nichts umsetzen.`
}

/** Vorbereitete Bitten zu einem Punkt (Knöpfe Erklären, Planungsinterview, Selbst klären); der Punkt bleibt offen. */
export function bitteZu(art: 'erklaeren' | 'interview' | 'klaeren', p: Punkt): string {
  const nr = p.nr !== undefined ? `#${p.nr} ` : ''
  if (art === 'erklaeren') return `Erkläre mir den offenen Punkt ${nr}„${p.titel}“ genauer: worum geht es, welche Möglichkeiten gibt es, was empfiehlst du und warum?`
  if (art === 'interview') return `Lass uns den offenen Punkt ${nr}„${p.titel}“ im Planungsinterview durchgehen: frag mich die offenen Details einzeln ab.`
  return `Kläre den offenen Punkt ${nr}„${p.titel}“ bitte selbst (Code, Logs, Dateien, Commits) und sag mir das Ergebnis; ist er damit erledigt, schreib „erledigt: ${nr.trim() || p.titel}“.`
}

/** Ein Punkt, den der Nutzer selbst notiert (/offen neu): Titel aus den ersten Wörtern, ohne feste Antworten. */
export function notiz(text: string, id: string, jetzt: number, sitzung: string): Punkt {
  const frage = text.replace(/\s+/g, ' ').trim().slice(0, 2000)
  const woerter = frage.split(' ')
  let titel = woerter.slice(0, 5).join(' ').replace(/[.,;:!?]+$/, '')
  if (titel.length > 60) titel = titel.slice(0, 59).trimEnd() + '…'
  else if (woerter.length > 5) titel += ' …'
  return {
    id, titel, frage, info: 'Vom Nutzer notiert.', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
    optionen: [], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: jetzt, vonNutzer: true,
    ...(sitzung !== '' ? { sitzung } : {}),
  }
}

const RAHMEN: Record<Stufe, string> = { blockiert: 'blockiert', normal: '', angebot: 'Angebot' }

/** Zusatz zum Titel: blockiert, Angebot, veraltet, zurückgestellt, ruhend, aus anderer Sitzung. */
export function vermerk(p: Punkt, s?: Sicht): string {
  const teile = [
    RAHMEN[p.stufe ?? 'normal'], istVeraltet(p) ? 'noch aktuell?' : '', p.zurueckgestellt > 0 ? 'zurückgestellt' : '',
    s !== undefined ? ruheVermerk(p, s) : '', s !== undefined && fremd(p, s.sitzung) ? 'aus anderer Sitzung' : '',
  ].filter(t => t !== '')
  return teile.length > 0 ? ` (${teile.join(', ')})` : ''
}

/** Zeile für die Statusleiste; mit Sicht zählen nur die Punkte, die gefragt werden, der Rest als "weitere". */
export function statuszeile(punkte: readonly Punkt[], prueft: boolean, s?: Sicht): string | undefined {
  const liste = s !== undefined ? fragbar(punkte, s) : offene(punkte)
  const n = liste.length
  const weitere = offene(punkte).length - n
  // "1 zurückgelegt bis Mo 12.10." oder "6 zurückgelegt – nächster Mo 12.10."
  const ende = s !== undefined ? ruheEnde(punkte, s) : ''
  const zurueck = `${weitere} zurückgelegt${ende === '' ? '' : weitere === 1 || !/\d/.test(ende) ? ` bis ${ende}` : ` – nächster ${ende}`}`
  if (n === 0) {
    if (weitere > 0) return `◇ ${zurueck}${prueft ? ' …' : ''} · /offen`
    return prueft ? '◇ prüft auf offene Punkte …' : undefined
  }
  const blockiert = liste.filter(p => p.stufe === 'blockiert').length
  const aufgaben = liste.filter(p => p.art === 'aufgabe').length
  const zusatz = [blockiert > 0 ? `${blockiert} blockiert` : '', aufgaben > 0 ? `${aufgaben} zu tun` : ''].filter(t => t !== '')

  if (weitere > 0) zusatz.push(zurueck)

  return `${blockiert > 0 ? '■' : '◆'} ${n} offen${zusatz.length > 0 ? ` (${zusatz.join(', ')})` : ''}${prueft ? ' …' : ''} · /offen`
}

// ---------------------------------------------------------------- Sitzungen und Ruhe

/** Wer schaut und wann: entscheidet, welche Punkte gefragt werden. */
export type Sicht = { sitzung: string; jetzt: number }

/** Ein Punkt, den eine andere Sitzung im selben Projekt führt. */
export const fremd = (p: Punkt, sitzung: string): boolean =>
  p.sitzung !== undefined && sitzung !== '' && p.sitzung !== sitzung

/** Zurückgelegt und noch nicht wieder dran. */
export const ruht = (p: Punkt, s: Sicht): boolean =>
  p.ruht !== undefined && ((p.ruht.bis !== undefined && s.jetzt < p.ruht.bis) || (p.ruht.sitzung !== undefined && p.ruht.sitzung === s.sitzung))

/** Was über der Eingabe gefragt wird: offen, aus dieser Sitzung, nicht zurückgelegt. */
export const fragbar = (punkte: readonly Punkt[], s: Sicht): Punkt[] =>
  offene(punkte).filter(p => !fremd(p, s.sitzung) && !ruht(p, s))

export type Ruhezeit = 'sitzung' | 'morgen' | 'drei' | 'woche'

/** Bis wann ein Punkt ruht: nächste Sitzung, oder Mitternacht morgen, in drei Tagen, nächsten Montag. */
export function ruhe(zeit: Ruhezeit, s: Sicht): Ruhe {
  if (zeit === 'sitzung') return { sitzung: s.sitzung }
  const d = new Date(s.jetzt)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + (zeit === 'morgen' ? 1 : zeit === 'drei' ? 3 : (8 - d.getDay()) % 7 || 7))
  return { bis: d.getTime() }
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

export const tagText = (ms: number): string => {
  const d = new Date(ms)
  return `${WOCHENTAG[d.getDay()]} ${zweistellig(d.getDate())}.${zweistellig(d.getMonth() + 1)}.`
}

/** Für die Statuszeile: wann der nächste ruhende Punkt wieder gefragt wird ("Mo 12.10.",
 *  "zur nächsten Sitzung"), leer, wenn nichts ruht. */
export function ruheEnde(punkte: readonly Punkt[], s: Sicht): string {
  const ruhend = offene(punkte).filter(p => ruht(p, s))
  if (ruhend.length === 0) return ''
  const termine = ruhend.flatMap(p => (p.ruht?.bis !== undefined && p.ruht.bis > s.jetzt ? [p.ruht.bis] : []))
  return termine.length > 0 ? tagText(Math.min(...termine)) : 'zur nächsten Sitzung'
}

/** "ruht bis …" – ohne bekannte Sitzung (in der Datei) auch der Vermerk für die nächste Sitzung. */
export function ruheVermerk(p: Punkt, s: Sicht): string {
  if (p.ruht === undefined) return ''
  if (p.ruht.bis !== undefined) return p.ruht.bis > s.jetzt ? `ruht bis ${tagText(p.ruht.bis)}` : ''
  return s.sitzung === '' || p.ruht.sitzung === s.sitzung ? 'ruht bis zur nächsten Sitzung' : ''
}

/**
 * Stempelt, wann ein Punkt geschlossen oder wieder geöffnet wurde - damit beim Abgleich
 * ein bewusstes Wiederöffnen gegen ein älteres Schließen gewinnt.
 */
export function stempeln(vorher: readonly Punkt[], nachher: readonly Punkt[], jetzt: number): Punkt[] {
  const alt = new Map(vorher.map(p => [p.id, p.status]))
  return nachher.map(p => {
    const war = alt.get(p.id)
    return war !== undefined && (war === 'offen') !== (p.status === 'offen') ? { ...p, geaendert: jetzt } : p
  })
}

/**
 * Führt den Stand aus offen.md - auch von einer anderen Sitzung im selben Projekt geschrieben -
 * in die eigene Liste. Geschlossen gewinnt, außer der Punkt wurde hier danach wieder geöffnet.
 * Was nur in der Datei steht, kommt dazu und behält seine Sitzung: steht in /offen, wird
 * aber nicht gefragt.
 */
export function abgleichen(eigene: readonly Punkt[], datei: readonly Punkt[], ab = 0): Punkt[] {
  const dort = new Map(datei.map(p => [p.id, p]))
  const liste = eigene.map(p => {
    const d = dort.get(p.id)
    if (d === undefined || p.status !== 'offen' || d.status === 'offen') return p
    // Hier wieder geöffnet, nicht vor dem Schließen dort: bleibt offen.
    if (p.geaendert !== undefined && p.geaendert >= (d.geaendert ?? 0)) return p
    const { ausstehend: _a, ruht: _r, ergebnis: _e, ...rest } = p
    return { ...rest, status: d.status, geaendert: d.geaendert, ...(d.ergebnis !== undefined ? { ergebnis: d.ergebnis } : {}) }
  })
  const bekannt = new Set(eigene.map(p => p.id))
  const vergeben = new Set(liste.map(p => p.nr).filter(n => n !== undefined))
  for (const d of datei) {
    if (bekannt.has(d.id)) continue
    const { ausstehend: _a, nr, ...rest } = d
    const p = { ...rest, sitzung: d.sitzung ?? 'unbekannt' }
    // Offen und hier schon vergeben (zwei Sitzungen zugleich): bekommt eine neue.
    if (nr !== undefined && (d.status !== 'offen' || !vergeben.has(nr))) {
      vergeben.add(nr)
      liste.push({ ...p, nr })
    } else liste.push(p)
  }

  return nummerieren(begrenzen(doppelteLoesen(liste)), ab)
}

/**
 * Eine Nummer gehört genau einem Punkt. Tragen mehrere dieselbe (eine Sitzung hat ohne Zählerstand
 * gezählt), behält sie der älteste; offene Nachzügler verlieren sie und bekommen eine neue,
 * geschlossene behalten sie für den Verlauf.
 */
export function doppelteLoesen(liste: readonly Punkt[]): Punkt[] {
  const erster = new Map<number, Punkt>()
  for (const p of [...liste].sort((a, b) => a.erstellt - b.erstellt)) {
    if (p.nr !== undefined && !erster.has(p.nr)) erster.set(p.nr, p)
  }
  return liste.map(p => {
    if (p.nr === undefined || p.status !== 'offen' || erster.get(p.nr)?.id === p.id) return p
    const { nr: _n, ...rest } = p
    return rest
  })
}

/** Offene Punkte einer Sitzung, die es nicht mehr gibt (Start, /clear), werden die eigenen. */
export const uebernehmen = (liste: readonly Punkt[], sitzung: string, nur?: string): Punkt[] =>
  liste.map(p => (p.status === 'offen' && (nur === undefined || p.sitzung === nur) ? { ...p, sitzung } : p))

// ---------------------------------------------------------------- Warnungen von kontext-anzeige

/** Was über der Eingabe steht: nur Warnungen, ohne die ausgeblendeten. */
export const zuZeigen = (w: readonly Warnung[], aus: readonly string[]): Warnung[] =>
  w.filter(x => x.stufe === 'warn' && !aus.includes(x.schluessel))

/** Warnungen zum Kontext bekommen einen Knopf /compact. */
export const mitCompact = (w: Warnung): boolean => w.schluessel.startsWith('kontext')

// ---------------------------------------------------------------- Dateien

/** Was zwischen den Sitzungen in der Datei steht. */
export type Ablage = {
  punkte: Punkt[]
  ueberblick: string
  /** Höchste je vergebene Nummer; fehlt bei älteren Dateien (dann die höchste in der Liste). */
  hoechsteNr?: number
}

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
export const ablageDaten = (a: Ablage, jetzt: number): string =>
  JSON.stringify({ punkte: a.punkte, ueberblick: a.ueberblick, hoechsteNr: Math.max(a.hoechsteNr ?? 0, hoechsteNr(a.punkte)), version: VERSION, stand: jetzt })

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
  const roh = d as { punkte?: unknown; ueberblick?: unknown; hoechsteNr?: unknown }
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
  return { punkte: liste, ueberblick: text(roh.ueberblick, 2000), hoechsteNr: Math.max(ab, hoechsteNr(liste)) }
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
  if (typeof r.sitzung === 'string') return { ruht: { sitzung: r.sitzung } }
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

const nrText = (p: Punkt) => (p.nr !== undefined ? `#${p.nr} ` : '')

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

// ---------------------------------------------------------------- Überblick aus dem Verlauf

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

// ---------------------------------------------------------------- Eingang (claude-web, Skripte)

/** So oft sieht eine Sitzung nach, ob in eingang.txt etwas liegt. */
export const EINGANG_TAKT_MS = 15_000

/**
 * eingang.txt: je Zeile ein /offen-Befehl ohne das „/offen“ („12 antwort Ja, bitte“, „12 a“,
 * „12 erledigt“, „alle weg Aufgeräumt“, „klären“, „neu Text“). claude-web oder ein Skript hängt an,
 * die Sitzung führt aus und leert die Datei. Leere Zeilen und Kommentare (#) fallen weg.
 */
export function eingangZeilen(text: string): string[] {
  return text.split(/\r?\n/)
    .map(z => z.trim().replace(/^\/offen\s+/i, ''))
    .filter(z => z !== '' && !z.startsWith('#'))
}

// ---------------------------------------------------------------- Startabgleich

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
