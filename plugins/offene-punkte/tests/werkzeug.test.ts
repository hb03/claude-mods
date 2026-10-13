import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { ANGEBOT_VERFALL, VERALTET_NACH, altern, nachfassen, werkzeugLesen } from '../hooks/logik'
import type { Punkt } from '../types'

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: '?', info: '', art: 'entscheidung', anleitung: '', optionen: [],
  status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

describe('nachfassen', () => {
  test('Frage oder Bitte am Ende', () => {
    expect(nachfassen('Alles gebaut und getestet. Soll ich pushen?')).toBe(true)
    expect(nachfassen('Fertig. Prüfe bitte die Seite auf deinem Handy.')).toBe(true)
    expect(nachfassen('Alles gebaut und getestet. Die Änderung ist drin.')).toBe(false)
    expect(nachfassen('Soll ich?')).toBe(false)
    expect(nachfassen('')).toBe(false)
  })
})

describe('altern', () => {
  test('Erwähnung per #Nr oder Titel setzt zurück, sonst +1', () => {
    const liste = [
      punkt(1, 'Freigabe Ausrollen', { ohneBezug: 3 }),
      punkt(2, 'Datenschutztext', { ohneBezug: 3 }),
      punkt(3, 'Sonstiges', { ohneBezug: 3 }),
      punkt(12, 'Zwölf', { ohneBezug: 3 }),
    ]
    const r = altern(liste, 'Zu #2 mache ich weiter, die freigabe ausrollen kommt später. #123 ist etwas anderes.', 1000)
    expect(r.map(p => p.ohneBezug)).toEqual([0, 0, 4, 4])
    expect(r.every(p => p.status === 'offen')).toBe(true)
  })

  test('schließt bei VERALTET_NACH, Angebot bei ANGEBOT_VERFALL', () => {
    const r = altern([
      punkt(1, 'Alt', { ohneBezug: VERALTET_NACH - 1 }),
      punkt(2, 'Frisch', { ohneBezug: VERALTET_NACH - 2 }),
      punkt(3, 'Angebot', { stufe: 'angebot', ohneBezug: ANGEBOT_VERFALL - 1 }),
      punkt(4, 'Normal', { ohneBezug: ANGEBOT_VERFALL - 1 }),
    ], 'nichts davon', 5000)
    expect(r.map(p => p.status)).toEqual(['erledigt', 'offen', 'erledigt', 'offen'])
    expect(r[0]?.auto?.zeit).toBe(5000)
  })
})

describe('werkzeugLesen', () => {
  test('nr als "#3" wird angenommen, Müll fällt weg', () => {
    const r = werkzeugLesen({
      neu: [{ titel: 'A', art: 'aufgabe', frage: 'A?', optionen: [{ label: 'Ok', antwort: '' }] }, 'quatsch', 5],
      schliessen: [{ nr: '#3', ueberholt: true, grund: 'x' }, { nr: 4 }, { nr: 'abc' }, { nr: 1.5 }, null, 'x', {}],
    })
    expect(r.neu.map(p => p.titel)).toEqual(['A'])
    expect(r.marken.map(m => [m.nr, m.ueberholt])).toEqual([[3, true], [4, false]])
    expect(werkzeugLesen('nix')).toEqual({ neu: [], marken: [] })
    expect(werkzeugLesen({ neu: 'x', schliessen: 'y' })).toEqual({ neu: [], marken: [] })
  })
})

function grundlage(on: On) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
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

const NEU = {
  neu: [{ titel: 'Freigabe Push', art: 'entscheidung', frage: 'Darf ich pushen?', optionen: [{ label: 'Ja, pushen', antwort: 'Ja, push.' }] }],
}

const call = ($: { tool: { call: (x: never) => Promise<unknown> } }, input: unknown) =>
  $.tool.call({ tool: 'mcp__offene-punkte__punkte', input } as never) as Promise<{ text?: string; isError?: boolean }>

describe('Werkzeug punkte', () => {
  test('legt Punkt #1 an, zeigt die Frage und schließt per Nummer', async ($, on) => {
    const uhr = mock.clock(on, { now: 1_800_000_000_000 })
    grundlage(on)
    const r = await call($, NEU)
    await uhr.settle()
    expect(JSON.stringify(r)).toContain('#1')
    const ui = await $.ui.mount({ ...band, surface: 'terminal' } as never)
    expect(await ui.find({ type: 'Text', text: /Darf ich pushen\?/ })).toBeDefined()
    await ui.unmount()

    const z = await call($, { schliessen: [{ nr: 1, ueberholt: true, grund: 'x' }] })
    await uhr.settle()
    expect(JSON.stringify(z)).toContain('geschlossen: #1')
    const ui2 = await $.ui.mount({ ...band, surface: 'terminal' } as never)
    expect(await ui2.find({ type: 'Text', text: /Darf ich pushen\?/ })).toBeUndefined()
    await ui2.unmount()
  })

  test('leerer Aufruf wird abgewiesen', async ($, on) => {
    mock.clock(on)
    grundlage(on)
    const r = await call($, {})
    expect(JSON.stringify(r)).toContain('Nichts übergeben')
  })

  const antworten = (on: On) => {
    const anfragen: string[] = []
    on('model.complete', (_, e) => {
      anfragen.push(String(e.prompt))
      return { value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}' } } as never
    })
    return anfragen
  }
  const fertig = ($: { turn: { complete: (x: never) => Promise<unknown> } }, answer: string) =>
    $.turn.complete({ answer, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)

  test('Standard: nach Werkzeugnutzung kein Haiku', async ($, on) => {
    const uhr = mock.clock(on)
    grundlage(on)
    const anfragen = antworten(on)
    await call($, NEU)
    await fertig($, 'Ich habe es eingetragen. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(0)
  })

  test('Standard: Frage am Ende ohne Werkzeug ruft Haiku genau einmal', async ($, on) => {
    const uhr = mock.clock(on)
    grundlage(on)
    const anfragen = antworten(on)
    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(1)
  })

  test('Standard: Antwort ohne Frage ruft kein Haiku', async ($, on) => {
    const uhr = mock.clock(on)
    grundlage(on)
    const anfragen = antworten(on)
    await fertig($, 'Alles gebaut und getestet. '.repeat(30))
    await uhr.settle()
    expect(anfragen.length).toBe(0)
  })
})
