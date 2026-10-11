import { expect, test } from 'claude-code/testing'

test('Statusdatei wird geschrieben; die Warnungen stehen im State für offene-punkte', async ($, on) => {
  const geschrieben: { path: string; text: string }[] = []
  const state: { key: string; value: unknown }[] = []
  on('env.get', (_, e) => ({ value: (e as { name?: string }).name === 'HOME' ? '/home/probe' : undefined }))
  on('session.id', () => ({ value: 'sitzung-1' }))
  on('command.register', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('clock.every', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('ui.toast', () => ({ value: {} }))
  on('state.set', ($, e, next) => {
    state.push({ key: (e as { key: string }).key, value: (e as { value: unknown }).value })
    return next(e)
  })
  on('fs.write', (_, e) => {
    geschrieben.push(e as { path: string; text: string })
    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { tokens: 190_000, window: 200_000, percent: 95 }, rateLimits: [], changed: ['context'] })

  // nur bei geändertem Inhalt geschrieben: zuletzt der Stand nach der Messung
  const letzte = geschrieben[geschrieben.length - 1]
  expect(new Set(geschrieben.map(x => x.text)).size).toBe(geschrieben.length)
  expect(letzte?.path).toBe('/home/probe/.claude/kontext-anzeige/sitzung-1.json')
  const inhalt = JSON.parse(letzte?.text ?? '{}')
  expect(inhalt.hinweis.text).toContain('/compact')

  const warnungen = state.filter(x => x.key === 'warnungen').at(-1)?.value
  expect(warnungen).toEqual([expect.objectContaining({ schluessel: 'kontext-kritisch', stufe: 'warn' })])
  // Gleicher Stand: kein zweites Schreiben (sonst zeichnet offene-punkte ständig neu).
  const vorher = state.filter(x => x.key === 'warnungen').length
  await $.session.measure({ context: { tokens: 190_000, window: 200_000, percent: 95 }, rateLimits: [], changed: ['context'] })
  expect(state.filter(x => x.key === 'warnungen').length).toBe(vorher)
})

test('/kontext test schickt Einblendung, Statuszeile und Systemmeldung zur Probe', async ($, on) => {
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  const meldungen: string[] = []
  on('session.surfaces', () => ({ value: ['terminal', 'mobile'] }))
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('clock.after', () => ({ value: { cancel: () => undefined } }) as never)
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text))
    return { value: {} }
  })
  on('ui.status', (_, e) => {
    status.push((e as { text?: string }).text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    meldungen.push(String((e as { text?: string }).text))
    return { value: undefined } as never
  })
  const r = await $.command.run({ command: 'kontext', args: 'test' } as never)
  const text = String((r as { text?: string }).text)
  expect(text).toContain('Oberflächen: terminal, mobile')
  expect(text).toContain('Systemmeldung „Probe 3/3“ – abgeschickt')
  expect(toasts).toEqual(['Probe 1/3: Einblendung von kontext-anzeige'])
  expect(status).toEqual(['Probe 2/3: Statuszeile von kontext-anzeige'])
  expect(meldungen).toEqual(['Probe 3/3: Systemmeldung von kontext-anzeige'])
})

test('Windows: ohne HOME landet die Datei unter USERPROFILE', async ($, on) => {
  const pfade: string[] = []
  on('env.get', (_, e) => ({ value: (e as { name?: string }).name === 'USERPROFILE' ? 'C:\\Users\\Nutzer' : undefined }))
  on('session.id', () => ({ value: 's2' }))
  on('command.register', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('clock.every', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('ui.toast', () => ({ value: {} }))
  on('fs.write', (_, e) => {
    pfade.push((e as { path: string }).path)
    return { value: undefined }
  })
  await $.session.start({ cwd: 'C:\\', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { tokens: 10_000, window: 200_000, percent: 5 }, rateLimits: [], changed: ['context'] })
  expect(pfade.length).toBeGreaterThan(0)
  // unter Linux ist C:\ kein absoluter Pfad, der Test-Kit stellt das Arbeitsverzeichnis davor
  expect(pfade.every(p => p.endsWith('C:\\Users\\Nutzer/.claude/kontext-anzeige/s2.json'))).toBe(true)
})
