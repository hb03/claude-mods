import type { Register } from 'claude-code'

import { hinweis, REGEL, vomNutzerVerschoben } from './logik'

// Hintergrund-Befehle: die Regel steht als eigener Abschnitt im Systemprompt
// (gilt damit in jeder Sitzung und nach jeder Compaction). Schiebt der Nutzer
// trotzdem einen Bash- oder PowerShell-Befehl per Strg+B weg, haengt der Mod
// einen stillen Hinweis an das Ergebnis. Nur im Hauptverlauf.

export const register: Register = (on) => {
  on('prompt.compose', async (_$, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'hintergrund-befehle:regel', text: REGEL, scope: 'session' }] }
  })

  for (const tool of ['Bash', 'PowerShell'] as const) {
    on('tool.call', { tool }, async (_$, e, next) => {
      const r = await next(e)
      const befehl = (e as { command?: unknown }).command
      if (e.agentId !== undefined || typeof befehl !== 'string' || 'deny' in r && r.deny !== undefined) return r
      if (!vomNutzerVerschoben(r.result)) return r
      return { ...r, context: [...(r.context ?? []), hinweis(befehl)] }
    })
  }
}
