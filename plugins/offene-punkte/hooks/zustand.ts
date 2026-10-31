// Geteilter Zustand der Sitzung: ein Objekt statt verstreuter let-Variablen, damit die Module
// in hooks/ denselben Stand sehen. Ein Neuladen des Mods setzt ihn in register() zurueck.
import type { Timer } from 'claude-code'
import { BUDGET_GRENZE } from './logik'

/** Kennung des Pane (/offen → „Alle zeigen“). */
export const PANE = 'offene-punkte'

// Feste Wahlmoeglichkeiten unter jeder Frage (Werte der Auswahl, nie sichtbar).
// KEINE steht vorgewaehlt, damit dort nicht "none" erscheint; waehlt nichts.
export const KEINE = '__keine'
export const EIGENE = '__eigene'
export const SPAETER = '__spaeter'
export const ANS_ENDE = '__ende'
export const RUHE = '__ruhe:'
export const ERLEDIGT = '__erledigt'
export const VERWERFEN = '__verwerfen'
export const AKTUELL = '__aktuell'
export const BEFEHL = '__befehl:'
// Vorbereitete Bitten (aus claude-web uebernommen): der Punkt bleibt offen, der Nutzer schickt selbst ab.
export const ERKLAEREN = '__erklaeren'
export const INTERVIEW = '__interview'
export const KLAEREN = '__klaeren'
// Alle Fragen beantwortet: noch ABSCHICKEN_NACH Sekunden Zeit (Enter schickt sofort), dann geht es los.
export const ABSCHICKEN_NACH = 5
// Gerade abgeschickt, Antwort der Engine steht noch aus: nicht ein zweites Mal senden.
export const unterwegs = new Set<string>()
// In uebergaben/: der Name der Uebergabe, die die naechste neue Unterhaltung bekommt (leer: keine).
export const WARTET = 'wartet.txt'
/** Die Fristen fuer „Spaeter“, in der Reihenfolge der Auswahl. */
export const ZEITEN: { wert: string; label: string }[] = [
  { wert: ANS_ENDE, label: 'Ans Ende' },
  { wert: `${RUHE}sitzung`, label: 'Nächste Sitzung' },
  { wert: `${RUHE}morgen`, label: 'Morgen' },
  { wert: `${RUHE}drei`, label: 'In 3 Tagen' },
  { wert: `${RUHE}woche`, label: 'Nächste Woche' },
]

export const z = {
  // Schreibvorgaenge nach kosten.jsonl laufen nacheinander.
  kostenKette: Promise.resolve() as Promise<void>,
  // Einstellungen, von register gesetzt.
  modell: 'haiku',
  fragenAnzeigen: true,
  // Die letzte Nachricht des Nutzers - sagt Haiku, was er gerade schon beantwortet hat.
  letzteEingabe: '',
  // Laeuft gerade ein Nachfassen? Dann faellt ein zweites aus (nie zwei zugleich).
  laeuft: false,
  // Gewaehlte Antworten stehen als "ausstehend" am Punkt (im State, uebersteht ein Neuladen) und
  // gehen gesammelt an Claude: wenn keine aktuelle Frage mehr offen ist oder WARTEZEIT nach der
  // letzten Wahl. Erst dann schliesst sich der Punkt. Spaeter, Schon erledigt und Nicht relevant
  // brauchen keine Nachricht und wirken sofort.
  zeitgeber: null as Timer | null,
  ticker: null as Timer | null,
  // Was wir dafuer in die Eingabe gelegt haben; leer: die Eingabe war belegt, es bleibt bei der Sammlung.
  vorschlag: '',
  // Wo die Dateien liegen; einmal je Sitzung ermittelt.
  ort: null as Promise<{ ordner: string } | null> | null,
  // Die eigene Sitzung: Punkte anderer Sitzungen im selben Projekt werden nicht gefragt.
  sitzung: '',
  // Welche Liste Claude zuletzt als Kontext bekam; leer nach /clear und nach einer Compaction.
  claudeKennt: '',
  // Sitzt ein Mensch davor? Unter claude -p oder dem SDK bleibt der Mod still: nur Datei und Marken.
  interaktiv: true,
  // Kam die letzte Eingabe von einem Menschen (Tastatur, Handy) oder von einer Maschine (Peer-Nachricht,
  // Zeitplan, claude-webs Klaerung per tmux)? Nach Maschinen-Turns wird nicht ausgewertet und nichts altert.
  eingabeArt: 'mensch' as 'mensch' | 'maschine',
  // Laeuft gerade ein Turn? Der Abgleich wartet dann auf den naechsten Takt.
  turnLaeuft: false,
  /** Beginn und Text des laufenden Haupt-Turns: wann eine Antwort „bei Claude“ fertig ist. */
  turnStart: 0,
  /** Wann die letzte Nachricht kam (auch von Maschinen): was seitdem geschlossen wurde, hat eine Marke nicht verfehlt. */
  eingangZeit: 0,
  turnText: '',
  /** Was Claude mit der nächsten Nachricht erfahren soll (z. B. eine Änderung, die nicht ankam). */
  hinweiseFuerClaude: [] as string[],
  abgleichLaeuft: false,
  abgleichTakt: null as Timer | null,
  // Ab so viel Prozent des 5-Stunden-Fensters kein Haiku mehr (Option haikuBisProzent).
  budgetGrenze: BUDGET_GRENZE,
  // Ueberblick: laeuft gerade einer, und wie viele fertige Menschen-Turns seit dem letzten.
  ueberblickLaeuft: false,
  fertigeTurns: 0,
  // Bis zu welcher Nachricht ($.session.messages()) der Ueberblick reicht, und wie oft er seit dem letzten
  // Neuschreiben fortgeschrieben wurde (0: der naechste schreibt ganz neu).
  ueberblickBis: 0,
  fortgeschrieben: 0,
  // Eingang (eingang.txt): der naechste Blick hinein - alle 15 s, solange ein Mensch arbeitet, sonst seltener.
  eingangTakt: null as Timer | null,
  eingangLaeuft: false,
  letzterMensch: 0,
  // Die installierte Fassung (installed_plugins.json), wenn sie von der laufenden abweicht - steht in offen.json.
  installiert: '',
  // Neue Unterhaltung (Start ohne Verlauf, /clear), deren erste Nachricht noch aussteht: sie bekommt die
  // wartende Uebergabe oder den Ueberblick der letzten Sitzung mit.
  frisch: false,
  // Aenderungszeit von offen.md, als diese Sitzung sie zuletzt gelesen oder geschrieben hat: aendert sie
  // sich, hat eine andere Sitzung geschrieben, und der Stand wird nachgeladen (ohne selbst zu schreiben).
  dateiStand: 0,
  istWindows: null as Promise<boolean> | null,
  // Wann diese Sitzung zuletzt ihr Lebenszeichen (.sitzungen/<id>) geschrieben hat.
  lebtGeschrieben: 0,
}
