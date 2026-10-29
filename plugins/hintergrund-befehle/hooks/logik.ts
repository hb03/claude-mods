/** Die Regel, die jede Sitzung im Systemprompt mitbekommt (auch nach einer Compaction). */
export const REGEL = `# Lang laufende Befehle im Hintergrund

Starte Shell-Befehle, die voraussichtlich länger als etwa eine Minute brauchen, selbst mit run_in_background: true, damit der Nutzer sie nicht per Strg+B in den Hintergrund schieben muss. Dazu gehören git clone/fetch großer Repos, Paket- und Programminstallationen (winget, apt, pip, npm/pnpm install, choco), Builds, große Downloads, Einrichtungs- und Migrationsskripte, lange Testläufe und alles, was auf Geräte, Neustarts oder Netzwerk wartet. Danach nicht pollen oder schlafen: Die Meldung über das Ende kommt von selbst; bis dahin an etwas anderem weiterarbeiten oder dem Nutzer kurz sagen, was läuft.

Kurze Befehle, deren Ergebnis du sofort für den nächsten Schritt brauchst (Status, Lesen, kleine Prüfungen), laufen weiter im Vordergrund.`

/** Der stille Hinweis, wenn der Nutzer doch Strg+B drücken musste. */
export function hinweis(befehl: string): string {
  const kurz = befehl.length > 120 ? `${befehl.slice(0, 117)}...` : befehl
  return `hintergrund-befehle: Der Nutzer musste diesen Befehl per Strg+B in den Hintergrund schieben (${kurz}). Befehle dieser Art künftig selbst mit run_in_background starten; das Ergebnis kommt als Meldung, nicht pollen.`
}

/** Hat der Nutzer den Befehl per Strg+B in den Hintergrund geschoben? */
export function vomNutzerVerschoben(ergebnis: unknown): boolean {
  return (ergebnis as { backgroundedByUser?: unknown } | undefined)?.backgroundedByUser === true
}
