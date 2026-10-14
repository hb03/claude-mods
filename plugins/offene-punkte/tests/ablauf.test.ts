import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const ANTWORT = 'Stufe 1 ist gebaut. Vor dem Freischalten brauche ich von dir: die Datenschutzerklärung und eine Freigabe zum Ausrollen. '.repeat(5)

const HAIKU = JSON.stringify({
  neu: [{
    titel: 'Freigabe zum Ausrollen',
    frage: 'Soll ich Stufe 1 ausrollen?',
    info: 'Der Zweig ist getestet, aber nicht live.',
    optionen: [
      { label: 'Ja, ausrollen', antwort: 'Ja, rolle Stufe 1 aus.' },
      { label: 'Noch warten', antwort: '' },
    ],
  }],
  erledigt: [],
})

/** Was jede Sitzung hat: Statuszeile und Protokollzeile. */
function oberflaeche(on: On) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
}

const band = (surface: 'terminal' | 'mobile') => ({
  plugin: 'offene-punkte',
  component: 'AbovePrompt' as const,
  surface,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9, contentRows: 0 },
  },
})

test('nach einer Antwort steht die offene Frage über der Eingabe, die Wahl geht an Claude', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  oberflaeche(on)
  const anfragen: string[] = []
  on('model.complete', (_, e) => {
    anfragen.push(String(e.prompt))
    return { value: { isAnswered: true, text: HAIKU, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })

  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(1)
  expect(anfragen[0]).toContain('Vor dem Freischalten')

  const ui = await $.ui.mount(band('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /Freigabe zum Ausrollen/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Soll ich Stufe 1 ausrollen\?/ })).toBeDefined()

  const sel = await ui.find({ type: 'Select' })
  expect(sel).toBeDefined()
  // Die erste Antwort steht als Knopf "a) …" neben dem Menü
  const knopfA = await ui.find({ type: 'Button', text: /^a\) / })
  expect(knopfA).toBeDefined()
  await ui.press({ key: String((knopfA as { key?: string }).key) })
  await uhr.advance(5_000)
  expect(gesendet).toEqual(['Zum offenen Punkt „Freigabe zum Ausrollen“: Ja, rolle Stufe 1 aus.'])
  await ui.unmount()

  // Beantwortet: die Zeile ist wieder leer.
  const leer = await $.ui.mount(band('terminal') as never)
  expect(await leer.find({ type: 'Text', text: /Freigabe zum Ausrollen/ })).toBeUndefined()
  await leer.unmount()
})

test('kurze Antworten und abgebrochene Turns werden nicht ausgewertet', async ($, on) => {
  const uhr = mock.clock(on)
  oberflaeche(on)
  let aufrufe = 0
  on('model.complete', () => {
    aufrufe++
    return { value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}' } } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'Erledigt.', reason: 'answer', durationMs: 10, isAborted: false, turnId: 't1' } as never)
  await $.turn.complete({ answer: ANTWORT, reason: 'aborted', durationMs: 10, isAborted: true, turnId: 't2' } as never)
  await uhr.settle()
  expect(aufrufe).toBe(0)
})

test('auf dem Handy stehen die Antworten als Knöpfe', async ($, on) => {
  const uhr = mock.clock(on)
  oberflaeche(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: HAIKU } }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  const ui = await $.ui.mount(band('mobile') as never)
  expect(await ui.find({ type: 'Button', text: 'Ja, ausrollen' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Später' })).toBeDefined()
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  await ui.unmount()
})
