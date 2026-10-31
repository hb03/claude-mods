// Übergabe an die nächste Sitzung
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { zeitText } from './gedanken'
import { datum, uhrzeit } from './ablage'

/**
 * Auftrag für /offen übergabe: ein Fork des Hauptmodells schreibt, was die nächste Sitzung zum
 * Weiterarbeiten braucht. Anders als ZUSAMMENFASSUNG (für den Nutzer) richtet sie sich an Claude:
 * Pfade, Befehle, Entscheidungen mit Gründen und Sackgassen statt Erledigtem für den Leser.
 */
export const UEBERGABE = `Schreibe eine ÜBERGABE an die nächste Sitzung: Sie beginnt ohne diesen Verlauf und soll mit diesem Text nahtlos weiterarbeiten. Nur Text, keine Werkzeuge. Deutsch, Markdown, so knapp wie möglich, aber vollständig in allem, was man zum Weiterarbeiten braucht:

## Ziel
Worum es geht und was am Ende stehen soll, ein bis drei Sätze.

## Stand
Was erledigt ist und wo es liegt (Dateien mit vollem Pfad, Commits, Adressen); was halb fertig ist und in welchem Zustand (ungetestet, nicht committet, nicht gepusht).

## Nächster Schritt
Was als Nächstes zu tun ist, konkret.

## Entscheidungen
Was entschieden wurde und warum, damit es nicht neu verhandelt wird – auch Vorgaben und Vorlieben des Nutzers aus dieser Sitzung.

## Sackgassen
Was versucht wurde und nicht ging, mit Grund.

## Dateien und Befehle
Pfade und Befehle wörtlich (bauen, testen, ausrollen), soweit sie gebraucht wurden.

## Offen beim Nutzer
Worauf noch eine Antwort oder Handlung des Nutzers fehlt. Die offenen Punkte des Plugins offene-punkte gehen ohnehin mit – nur nennen, was dort nicht steht.

Abschnitte ohne Inhalt weglassen. Keine Zugangsdaten, Tokens oder Passwörter. Erfinde nichts; was du nicht sicher weißt, lass weg. Antworte nur mit der Übergabe, ohne Einleitung.`

/** Name einer Übergabe im Archiv: JJJJ-MM-TT-HHMM.md, in derselben Minute mit -2, -3 … */
export function uebergabeName(jetzt: number, vorhanden: readonly string[]): string {
  const basis = `${datum(jetzt)}-${uhrzeit(jetzt).replace(':', '')}`
  const belegt = new Set(vorhanden)
  let name = `${basis}.md`
  for (let i = 2; belegt.has(name); i++) name = `${basis}-${i}.md`
  return name
}

/** Die Übergaben im Ordner, neueste zuerst (index.md und Fremdes bleiben draußen). */
export function uebergabeDateien(namen: readonly string[]): string[] {
  const schluessel = (n: string) => {
    const m = /^(\d{4}-\d{2}-\d{2}-\d{4})(?:-(\d+))?\.md$/.exec(n)
    return m === null ? null : `${m[1]}-${(m[2] ?? '1').padStart(4, '0')}`
  }
  return namen.filter(n => schluessel(n) !== null).sort((a, b) => String(schluessel(b)).localeCompare(String(schluessel(a))))
}

/** Die Übergabe, wie sie im Archiv steht: Kopf mit Zeit und Sitzung, dann der Text des Modells. */
export function uebergabeText(inhalt: string, jetzt: number, sitzung: string): string {
  const s = sitzung !== '' ? `Sitzung ${sitzung.slice(0, 8)} · ` : ''
  return `# Übergabe · ${zeitText(jetzt)}\n\n${s}geschrieben von offene-punkte (/offen übergabe)\n\n${inhalt.trim()}\n`
}

/** Die erste Zeile unter einer Überschrift „## Titel“ (ohne Listenzeichen), sonst ''. */
function abschnittsAnfang(text: string, titel: string): string {
  const zeilen = text.split('\n')
  const ab = zeilen.findIndex(z => new RegExp(`^#{2,3}\\s*${titel}\\s*$`, 'i').test(z.trim()))
  if (ab < 0) return ''
  for (const z of zeilen.slice(ab + 1)) {
    if (/^#{1,3}\s/.test(z.trim())) return ''
    const t = z.trim().replace(/^[-*]\s+|^\d+\.\s+/, '')
    if (t !== '') return t.length > 120 ? `${t.slice(0, 119)}…` : t
  }
  return ''
}

const INDEX_KOPF = '# Übergaben\n\nNeueste zuerst · wird von offene-punkte geschrieben. Lesen: /offen übergabe <Nr> (1 = die neueste), Liste: /offen übergaben.\n'

/** index.md mit der neuen Übergabe oben; eine Zeile mit derselben Datei wird ersetzt. */
export function uebergabeIndex(alt: string, name: string, inhalt: string, jetzt: number): string {
  const ziel = abschnittsAnfang(inhalt, 'Ziel')
  const weiter = abschnittsAnfang(inhalt, 'Nächster Schritt')
  const teile = [zeitText(jetzt), `[${name}](${name})`, ...(ziel !== '' ? [`Ziel: ${ziel}`] : []), ...(weiter !== '' ? [`Weiter: ${weiter}`] : [])]
  const zeile = `- ${teile.join(' · ')}`
  const alte = alt.split('\n').filter(z => z.startsWith('- ') && !z.includes(`[${name}]`))
  return `${INDEX_KOPF}\n${[zeile, ...alte].join('\n')}\n`
}

/** Die Zeile zu einer Datei aus index.md (ohne „- “), sonst nur der Name. */
export function indexZeile(index: string, name: string): string {
  const z = index.split('\n').find(x => x.startsWith('- ') && x.includes(`[${name}]`))
  return z === undefined ? name : z.slice(2)
}

/** Was eine neue Unterhaltung mit ihrer ersten Nachricht bekommt, wenn eine Übergabe wartet. */
export function uebergabeKontext(text: string, datei: string, archiv: string): string {
  return `Übergabe aus der vorigen Sitzung in diesem Projekt (Plugin offene-punkte, /offen übergabe). Sie ist dein Ausgangsstand: Knüpft die Nachricht des Nutzers daran an, arbeite dort weiter, wo sie aufhört; sonst nur Hintergrund. Datei: ${datei} · ältere Übergaben: ${archiv}/index.md\n\n${text.trim()}`
}

/** Ohne wartende Übergabe: der Überblick der letzten Sitzung, einmal und als Hintergrund. */
export function ueberblickKontext(ueberblick: string, archiv: string | null): string {
  const mehr = archiv !== null ? `\nÜbergaben früherer Sitzungen: ${archiv}/index.md` : ''
  return `Stand der letzten Sitzung in diesem Projekt (Überblick von offene-punkte, nur Hintergrund – nicht darauf eingehen, wenn die Nachricht etwas anderes will):\n${ueberblick.trim()}${mehr}`
}
