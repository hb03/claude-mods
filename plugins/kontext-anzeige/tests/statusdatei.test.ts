import { expect, test } from 'claude-code/testing'

const band = {
  plugin: 'kontext-anzeige',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 9, contentRows: 0 } },
}

for (const zeile of [true, false]) {
  test(`Zeile über der Eingabe ${zeile ? 'an' : 'aus'}; Statusdatei wird geschrieben`, { options: { zeileUeberEingabe: zeile } }, async ($, on) => {
    const geschrieben: { path: string; text: string }[] = []
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
    on('fs.write', (_, e) => {
      geschrieben.push(e as { path: string; text: string })
      return { value: undefined }
    })
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {})
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.session.measure({ context: { tokens: 130_000, window: 200_000, percent: 65 }, rateLimits: [], changed: ['context'] })

    // nur bei geändertem Inhalt geschrieben: zuletzt der Stand nach der Messung
    const letzte = geschrieben[geschrieben.length - 1]
    expect(new Set(geschrieben.map(x => x.text)).size).toBe(geschrieben.length)
    expect(letzte?.path).toBe('/home/probe/.claude/kontext-anzeige/sitzung-1.json')
    const inhalt = JSON.parse(letzte?.text ?? '{}')
    expect(inhalt.hinweis.text).toContain('/compact')

    const ui = await $.ui.mount({ ...band, surface: 'terminal' } as never)
    const gefunden = await ui.find({ type: 'Text', text: /Kontext/ })
    if (zeile) expect(gefunden).toBeDefined()
    else expect(gefunden).toBeUndefined()
    await ui.unmount()
  })
}

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
