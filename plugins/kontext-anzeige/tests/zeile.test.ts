import { expect, test } from 'claude-code/testing'

const band = {
  plugin: 'kontext-anzeige',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 9, contentRows: 0 },
  },
}

test('Zeile zeigt Kontext, Limit und den Vorschlag zu /compact', { options: { zeileUeberEingabe: true } }, async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {})
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text))
    return { value: {} }
  })
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  await $.session.measure({
    context: { tokens: 130_000, window: 200_000, percent: 65 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23 }, { kind: 'seven_day', percentUsed: 8 }],
    cost: { usd: 2.5 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  expect(toasts.filter(t => t.includes('/compact')).length).toBe(1)
  await $.session.measure({
    context: { tokens: 132_000, window: 200_000, percent: 66 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23 }, { kind: 'seven_day', percentUsed: 8 }],
    changed: ['context'],
  })
  expect(toasts.filter(t => t.includes('/compact')).length).toBe(1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band, surface } as never)
    expect(await ui.find({ type: 'Text', text: /Kontext .*66 %/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h ▰▱▱▱▱ 23 %/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Woche ▱▱▱▱▱ 8 %/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/compact/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Zeile bleibt leer vor der ersten Antwort', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {})
  })
  const ui = await $.ui.mount({ ...band, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Kontext/ })).toBeUndefined()
  await ui.unmount()
})
