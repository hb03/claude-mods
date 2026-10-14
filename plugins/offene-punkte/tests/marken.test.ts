import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import { HINWEIS_BLOCK, HINWEIS_CLAUDE, HINWEIS_WERKZEUG, markenHinweis, markenOhneTreffer, perMarkeSchliessen, schlussMarken } from '../hooks/logik'

const punkt = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel: `Punkt ${nr}`, frage: `Frage ${nr}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})
const JETZT = 1_800_000_000_000
const HIER = 'sitzung-a'

describe('Marken nur für eigene Punkte (0.16.7)', () => {
  test('eine Nummer aus einer anderen Sitzung schließt nichts', () => {
    const l = [punkt(1, { sitzung: 'sitzung-b' }), punkt(2, { sitzung: HIER }), punkt(3)]
    const r = perMarkeSchliessen(l, [1, 2, 3], JETZT, HIER)
    expect(r.map(p => p.status)).toEqual(['offen', 'erledigt', 'erledigt'])
  })

  test('ohne Sitzung wie bisher (Tests, claude -p)', () => {
    expect(perMarkeSchliessen([punkt(1, { sitzung: 'sitzung-b' })], [1], JETZT)[0]?.status).toBe('erledigt')
  })

  test('auch per Titel kein fremder Punkt', () => {
    const l = [punkt(1, { titel: 'Leitstand neu starten', sitzung: 'sitzung-b' })]
    expect(perMarkeSchliessen(l, schlussMarken('erledigt: Leitstand neu starten'), JETZT, HIER)[0]?.status).toBe('offen')
  })
})

describe('markenOhneTreffer: geratene Nummern fallen auf', () => {
  const l = [
    punkt(95, { titel: '0.16.6 pushen', sitzung: HIER }),
    punkt(96, { sitzung: HIER }),
    punkt(7, { sitzung: 'sitzung-b' }),
    punkt(8, { sitzung: HIER, status: 'erledigt', ergebnis: 'alt', geaendert: JETZT - 10_000 }),
  ]

  test('getroffene Marken melden nichts', () => {
    expect(markenOhneTreffer(l, schlussMarken('erledigt: #95, #96'), HIER, JETZT)).toEqual([])
  })

  test('nicht vorhanden, fremd, schon zu und unbekannter Titel', () => {
    const marken = schlussMarken('erledigt: #1, #7, #8\nerledigt: Gibt es gar nicht')
    expect(markenOhneTreffer(l, marken, HIER, JETZT)).toEqual([
      '#1 gibt es nicht',
      '#7 gehört einer anderen Sitzung',
      '#8 „Punkt 8“ war schon geschlossen',
      '„Gibt es gar nicht“ passt zu keinem offenen Punkt',
    ])
  })

  test('der Nutzer war schneller: seit der letzten Nachricht geschlossen oder Antwort unterwegs zählt als Treffer', () => {
    const frisch = [
      punkt(8, { sitzung: HIER, status: 'erledigt', ergebnis: 'Ja', geaendert: JETZT + 5 }),
      punkt(9, { sitzung: HIER, ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung' } }),
    ]
    expect(markenOhneTreffer(frisch, schlussMarken('erledigt: #8, #9'), HIER, JETZT)).toEqual([])
  })

  test('beantwortet und bei Claude ist ein Treffer', () => {
    const bei = [punkt(4, { sitzung: HIER, status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT - 10_000 })]
    expect(markenOhneTreffer(bei, schlussMarken('erledigt: #4'), HIER, JETZT)).toEqual([])
  })

  test('der Hinweis an Claude nennt die eigenen offenen Nummern, keine fremden', () => {
    const h = markenHinweis(['#1 gibt es nicht'], l, HIER)
    expect(h).toContain('#1 gibt es nicht')
    expect(h).toContain('#95 „0.16.6 pushen“')
    expect(h).toContain('#96')
    expect(h).not.toContain('#7')
    expect(h).toContain('nie raten')
    expect(markenHinweis([], l, HIER)).toBe('')
  })
})

test('alle Hinweise sagen: Nummern nicht raten, sonst per Titel', () => {
  for (const h of [HINWEIS_BLOCK, HINWEIS_CLAUDE, HINWEIS_WERKZEUG]) {
    expect(h).toContain('nie raten oder hochzählen')
    expect(h).toContain('„erledigt: Titel“')
  }
})

// ---------------------------------------------------------------- Ablauf

function grundlage(on: On, toasts: string[]) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text))
    return { value: {} } as never
  })
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}' } }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}
const fertig = (answer: string, turnId: string) =>
  ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId }) as never

test('Block → Nummer kommt mit der nächsten Nachricht (auch von einem Peer); geratene Marke wird gemeldet', async ($, on) => {
  const uhr = mock.clock(on, { now: JETZT })
  const toasts: string[] = []
  grundlage(on, toasts)
  const kontexte: string[] = []
  on('prompt.submit', (_, e) => {
    kontexte.push((e.context ?? []).join('\n'))
    return { text: e.text } as never
  })

  await $.turn.complete(fertig('```offen\n# Version pushen | aufgabe\nPushst du 0.16.6?\na) Push freigeben\n```', 't1'))
  await uhr.settle()
  await $.prompt.submit({ text: 'Antwort vom Peer', origin: { kind: 'peer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).toContain('Dein Block hat angelegt: #1 „Version pushen“')

  // Geraten: #3 gibt es nicht - nichts schließt, der Nutzer sieht es, Claude erfährt es
  await $.turn.complete(fertig('Fertig.\nerledigt: #3', 't2'))
  await uhr.settle()
  expect(toasts.some(t => t.includes('#3 gibt es nicht'))).toBe(true)
  await $.prompt.submit({ text: 'weiter', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).toContain('#3 gibt es nicht')
  expect(kontexte.at(-1)).toContain('Offen sind #1 „Version pushen“')

  // Richtig: schließt und meldet nichts nach
  await $.turn.complete(fertig('Gepusht.\nerledigt: #1', 't3'))
  await uhr.settle()
  await $.prompt.submit({ text: 'danke', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).not.toContain('nichts geschlossen')
})
