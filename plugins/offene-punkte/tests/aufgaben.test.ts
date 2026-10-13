import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { lies, statuszeile } from '../hooks/logik'
import type { Punkt } from '../types'

const ANTWORT = 'Die Statuszeile ist fertig. Auf dem PC musst du noch den Eintrag in C:/Users/Nutzer/.claude/settings.json ändern. '.repeat(5)

const ANLEITUNG = '1. In `C:/Users/Nutzer/.claude/settings.json` den Eintrag ersetzen:\n```json\n"statusLine": { "refreshInterval": 30 }\n```'

const HAIKU = (ueberblick: string) => JSON.stringify({
  neu: [{
    titel: 'Statuszeile auf dem PC',
    art: 'aufgabe',
    frage: 'Hast du den Eintrag auf dem PC geändert?',
    info: 'Ich komme nicht an den PC.',
    anleitung: ANLEITUNG,
    optionen: [{ label: 'Erledigt', antwort: 'Habe ich eingetragen.' }, { label: 'Erledige ich selbst', antwort: '' }],
  }],
  erledigt: [],
  ueberblick,
})

function grundlage(on: On) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: {} }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

const band = {
  plugin: 'offene-punkte',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

describe('Lesen', () => {
  test('Art, Anleitung und Überblick; Unbekanntes wird Entscheidung', async () => {
    const a = lies(JSON.stringify({
      neu: [
        { titel: 'A', art: 'aufgabe', frage: 'A?', anleitung: 'tu x', optionen: [{ label: 'Ok', antwort: '' }] },
        { titel: 'B', art: 'quatsch', frage: 'B?', optionen: [{ label: 'Ok', antwort: '' }] },
      ],
      erledigt: [],
      ueberblick: '- **Ziel:** Test',
    }))
    expect(a?.neu.map(p => [p.art, p.anleitung])).toEqual([['aufgabe', 'tu x'], ['entscheidung', '']])
    expect(a?.ueberblick).toBe('- **Ziel:** Test')
    expect(lies('{"neu":[],"erledigt":[]}')?.ueberblick).toBe('')
  })

  test('Statuszeile zählt Aufgaben gesondert, ohne Aufgaben kein Zusatz', async () => {
    const p = (id: string, art: Punkt['art']): Punkt => ({ id, titel: id, frage: '?', info: '', art, anleitung: '', optionen: [], status: 'offen', zurueckgestellt: 0, erstellt: 1 })
    expect(statuszeile([p('a', 'aufgabe'), p('b', 'entscheidung')], false)).toBe('◆ 2 offen (1 zu tun) · /offen')
    expect(statuszeile([p('b', 'entscheidung')], false)).toBe('◆ 1 offen · /offen')
  })
})

test('Aufgabe zeigt ihre Anleitung über der Eingabe; der Überblick geht in die nächste Auswertung', { options: { auswertung: 'haiku' } }, async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlage(on)
  const anfragen: string[] = []
  const antworten = [HAIKU('- **Ziel:** Statuszeile einrichten'), '{"neu":[],"erledigt":[],"ueberblick":""}']
  on('model.complete', (_, e) => {
    anfragen.push(String(e.prompt))
    return { value: { isAnswered: true, text: antworten.shift() ?? '{}' } } as never
  })

  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()

  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...band, surface } as never)
    expect(await ui.find({ type: 'Text', text: /◆ Zu tun/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /settings\.json/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /refreshInterval/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't2' } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(2)
  expect(anfragen[0]).toContain('BISHERIGER ÜBERBLICK:\n(noch keiner)')
  expect(anfragen[1]).toContain('BISHERIGER ÜBERBLICK:\n- **Ziel:** Statuszeile einrichten')

  // leerer Überblick in der zweiten Antwort überschreibt den alten nicht
  const offen = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((offen as { text?: string }).text)).toContain('Überblick:\n- **Ziel:** Statuszeile einrichten')
  expect(String((offen as { text?: string }).text)).toContain('Zu tun: Statuszeile auf dem PC')
  expect(String((offen as { text?: string }).text)).toContain('refreshInterval')
})

test('Entscheidung ohne Anleitung zeigt keinen Markdown-Block', { options: { auswertung: 'haiku' } }, async ($, on) => {
  const uhr = mock.clock(on)
  grundlage(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: JSON.stringify({ neu: [{ titel: 'Ausrollen', art: 'entscheidung', frage: 'Ausrollen?', optionen: [{ label: 'Ja', antwort: 'Ja.' }] }], erledigt: [] }) } }) as never)
  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  const ui = await $.ui.mount({ ...band, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /◆ Offen/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

for (const [fork, erwartet] of [
  [{ isAnswered: true, text: '## Worum es ging\nStatuszeile.' }, '## Worum es ging'],
  [{ isAnswered: false, reason: 'nothing-to-fork' }, 'Noch nichts zusammenzufassen'],
  [{ isAnswered: false, reason: 'api-error' }, 'nicht möglich (api-error)'],
] as const) {
  test(`/zusammenfassung: ${fork.isAnswered ? 'Antwort' : fork.reason}`, async ($, on) => {
    grundlage(on)
    const gefragt: string[] = []
    // Genau ein Fork (die Zusammenfassung); der Überblick kommt nicht mehr als zweiter Fork.
    on('model.fork', (_, e) => {
      gefragt.push(String((e as { prompt?: string }).prompt))
      return { value: fork } as never
    })
    const r = await $.command.run({ command: 'zusammenfassung', args: '' } as never)
    expect(String((r as { text?: string }).text)).toContain(erwartet)
    expect(gefragt.length).toBe(1)
    expect(gefragt[0]).toContain('Was du noch tun musst')
  })
}

/** Der Verlauf, wie $.session.messages() ihn liefert, und Haiku, das daraus den Überblick schreibt. */
function verlaufUndHaiku(on: On, ueberblick: string) {
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'Bau den Knopf.', toolUses: [] },
    { role: 'assistant', text: 'Der Knopf ist gebaut, die Tests laufen.', toolUses: [] },
  ] }) as never)
  const anfragen: string[] = []
  on('model.complete', (_, e) => {
    anfragen.push(String((e as { prompt?: string }).prompt))
    return { value: { isAnswered: true, text: ueberblick } } as never
  })
  return anfragen
}

test('/zusammenfassung schreibt den Überblick neu – aus dem Verlauf per Haiku, ein alter Stand bleibt nicht stehen', async ($, on) => {
  grundlage(on)
  const uhr = mock.clock(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: '## Worum es ging\nKnopf.' } }) as never)
  const anfragen = verlaufUndHaiku(on, 'Hier der Überblick:\n- **Ziel:** Knopf bauen\n- **Gerade:** Tests')
  await $.command.run({ command: 'zusammenfassung', args: '' } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(1)
  expect(anfragen[0]).toContain('NUTZER: Bau den Knopf.')
  expect(anfragen[0]).toContain('ASSISTENT: Der Knopf ist gebaut')
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  const text = String((r as { text?: string }).text)
  expect(text).toContain('**Gerade:** Tests')
  expect(text).not.toContain('Hier der Überblick')
})

test('/zusammenfassung ohne brauchbaren Überblick lässt den alten stehen', async ($, on) => {
  grundlage(on)
  const uhr = mock.clock(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: '## Worum es ging\nKnopf.' } }) as never)
  verlaufUndHaiku(on, 'Keine Liste.')
  await $.command.run({ command: 'zusammenfassung', args: '' } as never)
  await uhr.settle()
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((r as { text?: string }).text)).not.toContain('Keine Liste')
})

test('/offen überblick schreibt den Überblick aus dem Verlauf neu', async ($, on) => {
  grundlage(on)
  const uhr = mock.clock(on)
  const anfragen = verlaufUndHaiku(on, '- **Ziel:** Knopf bauen\n- **Erledigt:** Tests grün')
  const r = await $.command.run({ command: 'offen', args: 'überblick' } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(1)
  expect(String((r as { text?: string }).text)).toContain('**Erledigt:** Tests grün')
})
