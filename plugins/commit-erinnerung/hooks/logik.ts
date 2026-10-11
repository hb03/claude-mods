/** Testbefehle, die ohne Einstellung erkannt werden. */
export const TESTBEFEHLE = String.raw`\b(?:phpunit|pest|pytest|vitest|jest|phpstan|(?:npm|pnpm|yarn|bun|deno|composer)\s+(?:run\s+)?test|(?:cargo|go|make|mvn|gradle|dotnet|mix)\s+test|php\s+artisan\s+test|claude\s+plugin\s+test|python3?\s+-m\s+(?:pytest|unittest))\b`

/**
 * Ist das ein Testlauf? Liefert das Verzeichnis, in dem er lief (`cd <pfad>` davor, sonst
 * leer: das Arbeitsverzeichnis); null, wenn kein Testbefehl darin steht.
 */
export function testlauf(befehl: string, extra = ''): { verzeichnis?: string } | null {
  let re = new RegExp(TESTBEFEHLE)
  if (extra.trim() !== '') {
    try {
      re = new RegExp(`${TESTBEFEHLE}|${extra}`)
    } catch {
      // Kaputte Einstellung: nur die bekannten Befehle.
    }
  }
  let cd: string | undefined
  for (const teil of befehl.split(/&&|;|\n/)) {
    const t = teil.trim()
    const m = /^cd\s+("([^"]+)"|'([^']+)'|(\S+))\s*$/.exec(t)
    if (m) {
      cd = m[2] ?? m[3] ?? m[4]
      continue
    }
    if (re.test(t)) return cd !== undefined ? { verzeichnis: cd } : {}
  }
  return null
}

/**
 * Sagt die Ausgabe, dass etwas fehlgeschlagen ist? Nötig, weil bei `test | tail` der
 * Exitcode der von tail ist.
 */
export function fehlschlag(ausgabe: string): boolean {
  return /\b[1-9]\d*\s+(?:fail(?:ed|ing|ures?)?|errors?)\b/i.test(ausgabe) ||
    /^\s*(?:FAIL(?:ED)?\b|FAILURES!|ERRORS!|\(fail\))/m.test(ausgabe) ||
    /\b(?:Failures|Errors):\s*[1-9]/.test(ausgabe) ||
    /\bTests?:\s.*\b[1-9]\d*\s+failed\b/i.test(ausgabe)
}

/** Die Erinnerung für Claude aus `git status --porcelain`; null: nichts uncommittet. */
export function erinnerung(porcelain: string): string | null {
  const dateien = porcelain.split('\n').filter(z => z.trim() !== '').map(z => z.slice(3).trim())
  if (dateien.length === 0) return null
  const liste = dateien.slice(0, 5).join(', ') + (dateien.length > 5 ? ` und ${dateien.length - 5} weitere` : '')
  const n = dateien.length === 1 ? '1 Datei' : `${dateien.length} Dateien`
  return `commit-erinnerung: Die Tests sind grün, im Repo liegen ${n} uncommittet (${liste}). Ist der Arbeitsschritt fertig, jetzt committen.`
}
