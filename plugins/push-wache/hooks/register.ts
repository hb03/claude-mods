import type { EngineInterface, Register } from 'claude-code'

import type { Fund, Push } from '../types'
import { ABBRECHEN, TROTZDEM, ablehnung, frage, hinzugefuegt, inhaltPruefen, istOeffentlich, mailsPruefen, pushAufrufe } from './logik'

// Push-Wache: bevor Claude per Bash in ein oeffentliches Repo pusht, werden die
// neuen Commits (was das Remote noch nicht kennt) auf eigene Muster, fremde
// Autor-Mails und Geheimnisse geprueft. Bei einem Fund fragt der eingebaute
// Frage-Dialog mit den Fundstellen - auch im Auto-Modus und am Handy.

let muster = ''
let mails = ''
let oeffentlich = ''

async function git($: EngineInterface, p: Push, args: string[]): Promise<string | null> {
  const r = await $.process.run(['git', ...(p.verzeichnis !== undefined ? ['-C', p.verzeichnis] : []), ...args], { timeoutMs: 20_000 })
    .catch(() => null)
  return r !== null && r.exitCode === 0 ? r.stdout : null
}

/** Prueft einen Push; null: kein oeffentliches Ziel oder nicht feststellbar. */
async function pruefen($: EngineInterface, p: Push): Promise<{ ziel: string; funde: Fund[] } | null> {
  const remote = p.remote ?? 'origin'
  const istUrl = /[:/]/.test(remote)
  const url = istUrl ? remote : (await git($, p, ['remote', 'get-url', remote]))?.trim()
  if (url === undefined || url === '' || !istOeffentlich(url, oeffentlich)) return null
  // Was das Remote noch nicht hat; bei einer URL als Ziel gibt es keine Remote-Zweige: alles ab HEAD.
  const bereich = istUrl ? ['HEAD'] : ['HEAD', '--not', `--remotes=${remote}`]
  const [diff, log] = await Promise.all([
    git($, p, ['log', '-p', '--no-color', '--unified=0', '--format=commit %H', ...bereich]),
    git($, p, ['log', '--format=%H%x09%ae%x09%ce', ...bereich]),
  ])
  if (diff === null || log === null) return null
  const ziel = url.replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/i, '').replace(/^[^@/]+@/, '').replace(/:/, '/').replace(/\.git$/, '')
  return { ziel, funde: [...mailsPruefen(log, mails), ...inhaltPruefen(hinzugefuegt(diff), muster)] }
}

export const register: Register = (on, options) => {
  muster = String(options.muster ?? '')
  mails = String(options.mails ?? '@users\\.noreply\\.github\\.com$')
  oeffentlich = String(options.oeffentlich ?? 'github.com, gitlab.com, bitbucket.org, codeberg.org')

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    const befehl = (e.input as { command?: unknown } | null)?.command
    if (r.decision === 'deny' || typeof befehl !== 'string' || e.tool_use_id === undefined) return r
    const pushes = pushAufrufe(befehl)
    for (const p of pushes) {
      const ergebnis = await pruefen($, p).catch(fehler => {
        $.ui.log(`push-wache: Prüfung fehlgeschlagen (${String(fehler)})`)
        return null
      })
      if (ergebnis === null || ergebnis.funde.length === 0) continue
      const antwort = await $.ui.ask(frage(ergebnis.ziel, ergebnis.funde), { header: 'Push-Wache', options: [ABBRECHEN, TROTZDEM] })
        .catch(() => ABBRECHEN)
      if (antwort === TROTZDEM) continue
      return { decision: 'deny', reason: ablehnung(ergebnis.ziel, ergebnis.funde, antwort) }
    }
    return r
  })
}
