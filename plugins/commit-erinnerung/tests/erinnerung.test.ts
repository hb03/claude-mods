import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { erinnerung, fehlschlag, testlauf } from '../hooks/logik'

describe('Testlauf erkennen', () => {
  test('bekannte Befehle, mit cd davor; andere Befehle nicht', async () => {
    expect(testlauf('npm test')).toEqual({})
    expect(testlauf('cd /projekt && vendor/bin/phpunit --testdox')).toEqual({ verzeichnis: '/projekt' })
    expect(testlauf('timeout 300 claude plugin test plugins/x 2>&1 | tail -5')).toEqual({})
    expect(testlauf('pnpm run test')).toEqual({})
    expect(testlauf('git status')).toBeNull()
    expect(testlauf('npm install')).toBeNull()
    expect(testlauf('cat test.log')).toBeNull()
  })

  test('weitere Befehle aus der Einstellung; eine kaputte Einstellung schadet nicht', async () => {
    expect(testlauf('./pruefe.sh', 'pruefe\\.sh')).toEqual({})
    expect(testlauf('./pruefe.sh', '(')).toBeNull()
    expect(testlauf('npm test', '(')).toEqual({})
  })

  test('Fehlschläge in der Ausgabe, auch hinter einer Pipe', async () => {
    expect(fehlschlag(' 45 pass\n 0 fail\nRan 45 tests')).toBe(false)
    expect(fehlschlag('OK (12 tests, 30 assertions)')).toBe(false)
    expect(fehlschlag(' 44 pass\n 1 fail')).toBe(true)
    expect(fehlschlag('FAILURES!\nTests: 5, Assertions: 9, Failures: 1.')).toBe(true)
    expect(fehlschlag('Tests:       2 failed, 10 passed, 12 total')).toBe(true)
    expect(fehlschlag('=== 3 failed, 20 passed in 1.2s ===')).toBe(true)
  })

  test('Erinnerung nennt Anzahl und Dateien', async () => {
    expect(erinnerung('')).toBeNull()
    expect(erinnerung(' M a.ts\n?? b.ts\n')).toBe('commit-erinnerung: Die Tests sind grün, im Repo liegen 2 Dateien uncommittet (a.ts, b.ts). Ist der Arbeitsschritt fertig, jetzt committen.')
    expect(erinnerung(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(x => ` M ${x}`).join('\n'))).toContain('(a, b, c, d, e und 2 weitere)')
  })
})

function grundlage(on: On, ausgabe: string, porcelain: { text: string }, fehler = false) {
  const git: string[][] = []
  on('tool.call', () => (fehler ? { result: { stdout: ausgabe, stderr: '', interrupted: false }, isError: true } : { result: { stdout: ausgabe, stderr: '', interrupted: false } }) as never)
  on('process.run', (_, e) => {
    git.push([...e.argv])
    return { value: { exitCode: 0, stdout: porcelain.text, stderr: '' } } as never
  })
  return git
}

const aufruf = (command: string, id = 't1') => ({ tool: 'Bash', tool_use_id: id, command }) as never

test('grüne Tests mit Änderungen: Hinweis an Claude, für denselben Stand nur einmal', async ($, on) => {
  const stand = { text: ' M hooks/a.ts\n' }
  const git = grundlage(on, ' 12 pass\n 0 fail', stand)
  const r1 = await $.tool.call(aufruf('cd /repo && npm test'))
  expect(String((r1 as { context?: string[] }).context)).toContain('1 Datei uncommittet (hooks/a.ts)')
  expect(git[0]).toEqual(['git', '-C', '/repo', 'status', '--porcelain'])

  const r2 = await $.tool.call(aufruf('cd /repo && npm test', 't2'))
  expect((r2 as { context?: string }).context).toBeUndefined()

  stand.text = ' M hooks/a.ts\n M hooks/b.ts\n'
  const r3 = await $.tool.call(aufruf('cd /repo && npm test', 't3'))
  expect(String((r3 as { context?: string[] }).context)).toContain('2 Dateien')
})

test('kein Hinweis: rote Tests, Fehlschlag hinter einer Pipe, sauberes Repo, kein Testbefehl', async ($, on) => {
  const stand = { text: ' M a.ts\n' }
  const git = grundlage(on, ' 11 pass\n 1 fail', stand)
  const rot = await $.tool.call(aufruf('npm test | tail -3'))
  expect((rot as { context?: string }).context).toBeUndefined()
  const kein = await $.tool.call(aufruf('ls -la', 't2'))
  expect((kein as { context?: string }).context).toBeUndefined()
  expect(git.length).toBe(0)
})

test('Exitcode ungleich 0 zählt als rot', async ($, on) => {
  const git = grundlage(on, 'irgendwas', { text: ' M a.ts\n' }, true)
  const r = await $.tool.call(aufruf('npm test'))
  expect((r as { context?: string }).context).toBeUndefined()
  expect(git.length).toBe(0)
})

test('sauberes Repo: kein Hinweis', async ($, on) => {
  grundlage(on, ' 3 pass\n 0 fail', { text: '' })
  const r = await $.tool.call(aufruf('npm test'))
  expect((r as { context?: string }).context).toBeUndefined()
})
