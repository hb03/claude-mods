import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { hinweis, REGEL, vomNutzerVerschoben } from '../hooks/logik'

describe('Logik', () => {
  test('Regel nennt run_in_background und die typischen Fälle', async () => {
    expect(REGEL).toContain('run_in_background')
    expect(REGEL).toContain('git clone')
    expect(REGEL).toContain('nicht pollen')
  })

  test('Hinweis kürzt lange Befehle', async () => {
    expect(hinweis('git clone x')).toContain('(git clone x)')
    expect(hinweis('a'.repeat(300))).toContain('...')
  })

  test('nur backgroundedByUser zählt', async () => {
    expect(vomNutzerVerschoben({ backgroundedByUser: true, backgroundTaskId: 'b1' })).toBe(true)
    expect(vomNutzerVerschoben({ backgroundTaskId: 'b1' })).toBe(false)
    expect(vomNutzerVerschoben(undefined)).toBe(false)
  })
})

function grundlage(on: On, ergebnis: Record<string, unknown>) {
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, ...ergebnis } }) as never)
}

const aufruf = (tool: string, command: string, extra: Record<string, unknown> = {}) =>
  ({ tool, tool_use_id: 't1', command, ...extra }) as never

test('per Strg+B verschoben: stiller Hinweis an Claude, bei Bash und PowerShell', async ($, on) => {
  grundlage(on, { backgroundTaskId: 'b1', backgroundedByUser: true })
  const r1 = await $.tool.call(aufruf('Bash', 'git clone https://example.com/repo'))
  expect(String((r1 as { context?: string[] }).context)).toContain('per Strg+B')
  const r2 = await $.tool.call(aufruf('PowerShell', 'winget install Git.Git'))
  expect(String((r2 as { context?: string[] }).context)).toContain('winget install Git.Git')
})

test('selbst im Hintergrund gestartet oder im Vordergrund: kein Hinweis', async ($, on) => {
  grundlage(on, { backgroundTaskId: 'b1' })
  const r = await $.tool.call(aufruf('Bash', 'npm install', { run_in_background: true }))
  expect((r as { context?: string }).context).toBeUndefined()
})
