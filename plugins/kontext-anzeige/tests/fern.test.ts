import { expect, test } from 'claude-code/testing'

const MESSUNG = {
  context: { tokens: 130_000, window: 200_000, percent: 65 },
  rateLimits: [],
  changed: ['context' as const],
}

for (const [flaechen, erwartet] of [
  [['terminal', 'mobile'], true],
  [['terminal'], false],
] as const) {
  test(`Statuszeile bei ${flaechen.join('+')}: ${erwartet ? 'gesetzt' : 'leer'}`, async ($, on) => {
    const status: (string | undefined)[] = []
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('session.surfaces', () => ({ value: flaechen }))
    on('clock.now', () => ({ value: 1_800_000_000_000 }))
    on('ui.toast', () => ({ value: {} }))
    on('ui.status', (_, e) => {
      status.push((e as { text?: string }).text)
      return { value: undefined }
    })
    await $.session.measure(MESSUNG)
    const gesetzt = status.filter(t => t !== undefined)
    if (erwartet) {
      expect(gesetzt.length).toBe(1)
      expect(gesetzt[0]).toContain('65 %')
      expect(gesetzt[0]).toContain('/compact')
    } else {
      expect(gesetzt.length).toBe(0)
    }
  })
}

for (const [bruecke, erwartet] of [
  ['session_abc', true],
  [undefined, false],
] as const) {
  test(`Fernsteuerung ${bruecke ? 'an' : 'aus'}: Statuszeile ${erwartet ? 'gesetzt' : 'leer'}`, async ($, on) => {
    const status: (string | undefined)[] = []
    on('env.get', () => ({ value: bruecke }))
    on('command.register', () => ({ value: {} }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
    on('clock.every', () => ({ value: {} }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    on('clock.now', () => ({ value: 1_800_000_000_000 }))
    on('ui.toast', () => ({ value: {} }))
    on('ui.status', (_, e) => {
      status.push((e as { text?: string }).text)
      return { value: undefined }
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.session.measure(MESSUNG)
    expect(status.filter(t => t !== undefined).length).toBe(erwartet ? 1 : 0)
  })
}

test('Option statuszeile aus: auch bei Handy keine Statuszeile', { options: { statuszeile: false } }, async ($, on) => {
  const status: (string | undefined)[] = []
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.surfaces', () => ({ value: ['terminal', 'mobile'] }))
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('ui.toast', () => ({ value: {} }))
  on('ui.status', (_, e) => {
    status.push((e as { text?: string }).text)
    return { value: undefined }
  })
  await $.session.measure(MESSUNG)
  expect(status.filter(t => t !== undefined).length).toBe(0)
})
