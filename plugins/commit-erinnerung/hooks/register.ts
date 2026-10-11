import type { Register } from 'claude-code'

import { erinnerung, fehlschlag, testlauf } from './logik'

// Commit-Erinnerung: laeuft ein Testbefehl gruen durch und liegen danach
// uncommittete Aenderungen im Repo, haengt der Mod einen Hinweis fuer Claude an
// das Ergebnis. Nur im Hauptverlauf, und fuer denselben Stand nur einmal.

let extra = ''
// Der Stand (git status), an den zuletzt erinnert wurde.
let zuletzt = ''

export const register: Register = (on, options) => {
  extra = String(options.testbefehle ?? '')
  zuletzt = ''

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    const befehl = (e as { command?: unknown }).command
    if (e.agentId !== undefined || typeof befehl !== 'string' || 'deny' in r && r.deny !== undefined || r.isError) return r
    const lauf = testlauf(befehl, extra)
    if (lauf === null) return r
    const ergebnis = r.result as { stdout?: string; stderr?: string; interrupted?: boolean; backgroundTaskId?: string } | undefined
    if (ergebnis?.interrupted || ergebnis?.backgroundTaskId !== undefined) return r
    if (fehlschlag(`${ergebnis?.stdout ?? ''}\n${ergebnis?.stderr ?? ''}`)) return r

    const status = await $.process.run(['git', ...(lauf.verzeichnis !== undefined ? ['-C', lauf.verzeichnis] : []), 'status', '--porcelain'], { timeoutMs: 10_000 })
      .catch(() => null)
    if (status === null || status.exitCode !== 0) return r
    const text = erinnerung(status.stdout)
    if (text === null || status.stdout === zuletzt) {
      if (text === null) zuletzt = ''
      return r
    }
    zuletzt = status.stdout
    return { ...r, context: [...(r.context ?? []), text] }
  })
}
