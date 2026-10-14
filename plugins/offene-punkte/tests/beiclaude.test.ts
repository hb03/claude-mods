import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  abgelehnteAenderungen, abschliessen, aenderungenZuIds, antwortIn, beiClaudeFertig, perMarkeSchliessen, sammelText, zusammenfuehren,
} from '../hooks/logik'

const punkt = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel: `Punkt ${nr}`, frage: `Frage ${nr}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})
const JETZT = 1_800_000_000_000
const leer = { neu: [], erledigt: [], erwaehnt: [], ueberblick: '' }

describe('Antwort „bei Claude“ (0.16.6)', () => {
  test('abschliessen mit Sendezeit: erledigt liegt bei Claude, verworfen nicht', () => {
    const l = [
      punkt(1, { ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung', reihe: 1 } }),
      punkt(2, { ausstehend: { status: 'verworfen', ergebnis: 'nicht relevant', text: '', wo: 'sammlung', reihe: 2 } }),
    ]
    const r = abschliessen(l, new Set(['p1', 'p2']), new Map(), JETZT)
    expect(r[0]).toMatchObject({ status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT })
    expect(r[1]?.beiClaude).toBeUndefined()
    // ohne Sendezeit wie bisher
    expect(abschliessen(l, new Set(['p1']))[0]?.beiClaude).toBeUndefined()
  })

  test('beiClaudeFertig: der Turn mit der Antwort oder ein späterer beendet es, ein schon laufender nicht', () => {
    const l = [punkt(1, { status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT })]
    // Turn lief schon, als die Antwort abging, und trug sie nicht
    expect(beiClaudeFertig(l, JETZT - 10, 'etwas anderes')[0]?.beiClaude).toBe(JETZT)
    // Turn begann danach
    expect(beiClaudeFertig(l, JETZT + 1)[0]?.beiClaude).toBeUndefined()
    // Turn trug die Antwort (gleiche Millisekunde)
    const r = beiClaudeFertig(l, JETZT, 'Zum offenen Punkt #1 „Punkt 1“: Ja.')[0]
    expect(r?.beiClaude).toBeUndefined()
    expect(r).toMatchObject({ status: 'erledigt', ergebnis: 'Ja' })
  })

  test('„erledigt: #N“ auf einen beantworteten Punkt bestätigt ihn, ohne ihn neu zu schließen', () => {
    const l = [punkt(1, { status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT }), punkt(2)]
    const r = perMarkeSchliessen(l, [1], JETZT + 5)
    expect(r[0]?.beiClaude).toBeUndefined()
    expect(r[0]?.ergebnis).toBe('Ja · von Claude als umgesetzt gemeldet')
    expect(r[0]?.auto).toBeUndefined()
    expect(r[1]?.status).toBe('offen')
  })

  test('Nummer in der Nachricht an Claude; antwortIn trennt auch Zeilen mit Nummer', () => {
    expect(sammelText([{ titel: 'A', text: 'x', nr: 3 }])).toBe('Zum offenen Punkt #3 „A“: x')
    const t = sammelText([{ titel: 'A', text: 'x', nr: 3 }, { titel: 'B', text: 'y', nr: 4 }])
    expect(t).toBe('Zu den offenen Punkten:\n- #3 „A“: x\n- #4 „B“: y')
    expect(antwortIn(t, 'A')).toBe('x')
    expect(antwortIn(t, 'B')).toBe('y')
  })
})

describe('Änderung an einem geschlossenen Punkt (0.16.6)', () => {
  test('ein erledigter (auch beantworteter) Punkt öffnet sich mit der Änderung wieder', () => {
    const l = [punkt(68, { status: 'erledigt', ergebnis: 'Doppelung bereinigen', beiClaude: JETZT, auto: { grund: 'x', zeit: 1 } })]
    const aktualisiert = aenderungenZuIds(l, [{ nr: 68, frage: 'Erneut im Leitstand klären?', art: 'aufgabe' } as never])
    expect(aktualisiert).toHaveLength(1)
    const r = zusammenfuehren(l, { ...leer, aktualisiert }, JETZT + 1, () => 'neu')[0]!
    expect(r).toMatchObject({ status: 'offen', frage: 'Erneut im Leitstand klären?', nr: 68, geaendert: JETZT + 1 })
    expect(r.ergebnis).toBeUndefined()
    expect(r.beiClaude).toBeUndefined()
    expect(r.auto).toBeUndefined()
  })

  test('verworfen bleibt zu und wird als abgelehnt gemeldet; offen geht vor geschlossen bei gleicher Nummer', () => {
    const l = [punkt(5, { status: 'verworfen' }), punkt(6, { id: 'alt', status: 'erledigt', geaendert: 1 }), punkt(6, { id: 'neu' })]
    const a = [{ nr: 5, frage: 'X?' }, { nr: 6, frage: 'Y?' }, { nr: 9, frage: 'Z?' }] as never[]
    expect(aenderungenZuIds(l, a).map(x => x.id)).toEqual(['neu'])
    expect(abgelehnteAenderungen(l, a).map(x => x.nr)).toEqual([5, 9])
  })

  test('vom Nutzer selbst angelegte Punkte öffnet eine Änderung nicht', () => {
    const l = [punkt(2, { status: 'erledigt', vonNutzer: true })]
    const r = zusammenfuehren(l, { ...leer, aktualisiert: aenderungenZuIds(l, [{ nr: 2, frage: 'Neu?' } as never]) }, JETZT, () => 'n')[0]
    expect(r?.status).toBe('erledigt')
  })
})

// ---------------------------------------------------------------- Ablauf

function grundlage(on: On) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
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

const band = {
  plugin: 'offene-punkte',
  component: 'AbovePrompt' as const,
  surface: 'terminal' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

const BLOCK = '```offen\n# Doppelung bereinigen | entscheidung | blockiert\nSoll die doppelte Aufnahme bereinigt werden?\na) Im Leitstand bereinigen\nb) Vorerst lassen\n```'
const fertig = (answer: string, turnId: string) =>
  ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId }) as never

test('Wahl → bei Claude → Claude öffnet mit „# #1“ wieder; /offen 1 sagt bei Geschlossenem, was ist', async ($, on) => {
  const uhr = mock.clock(on, { now: JETZT })
  grundlage(on)
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  const offen = async (args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

  await $.turn.complete(fertig(`Bitte klären.\n${BLOCK}`, 't1'))
  await uhr.settle()
  const ui = await $.ui.mount(band as never)
  const knopfA = await ui.find({ type: 'Button', text: /^a\) / })
  await ui.press({ key: String((knopfA as { key?: string }).key) })
  await uhr.advance(5_000)
  await ui.unmount()
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Doppelung bereinigen“ (Soll die doppelte Aufnahme bereinigt werden?): Im Leitstand bereinigen'])

  // Geschlossen: /offen 1 b sagt, was mit #1 ist, statt „gibt es nicht“
  expect(await offen('1 b')).toContain('#1 „Doppelung bereinigen“ ist schon erledigt')

  // Claudes Turn mit der Antwort: der Punkt ist noch nicht fertig, er öffnet ihn wieder
  await $.turn.start({ text: gesendet[0]!, turnId: 't2' } as never)
  await $.turn.complete(fertig('Im Ordner liegen noch beide Videos.\n```offen\n# #1 Doppelung bereinigen | aufgabe | blockiert\nIm Leitstand erneut über „Doppelte klären“ bereinigen?\na) Erledigt: im Leitstand bereinigt\n```', 't2'))
  await uhr.settle()
  const liste = await offen('')
  expect(liste).toContain('1. Zu tun: Doppelung bereinigen')
  expect(liste).toContain('erneut über „Doppelte klären“')
})

test('ohne Marke und ohne Änderung bleibt die Antwort beantwortet; eine Änderung an Verworfenem erfährt Claude', async ($, on) => {
  const uhr = mock.clock(on, { now: JETZT })
  grundlage(on)
  const kontexte: string[] = []
  on('prompt.submit', (_, e) => {
    kontexte.push((e.context ?? []).join('\n'))
    return { text: e.text } as never
  })
  const offen = async (args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

  await $.turn.complete(fertig(BLOCK, 't1'))
  await uhr.settle()
  expect(await offen('1 b')).toContain('Vorerst lassen')
  await uhr.advance(5_000)
  await $.turn.start({ text: 'Zum offenen Punkt #1 „Doppelung bereinigen“: Vorerst lassen', turnId: 't2' } as never)
  await $.turn.complete(fertig('Gut, ich lasse es.', 't2'))
  await uhr.settle()
  expect(await offen('')).toContain('Nichts offen')

  // Ein zweiter Punkt, den der Nutzer verwirft; Claude ändert ihn trotzdem
  await $.turn.complete(fertig('```offen\n# Zweiter Punkt | entscheidung\nNoch etwas?\na) Ja\n```', 't3'))
  await uhr.settle()
  expect(await offen('2 weg')).toContain('verworfen')
  await $.turn.complete(fertig('```offen\n# #2 Zweiter Punkt\nDoch noch etwas?\n```', 't4'))
  await uhr.settle()
  expect(await offen('')).toContain('Nichts offen')
  await $.prompt.submit({ text: 'weiter', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).toContain('#2 „Zweiter Punkt“ ist vom Nutzer verworfen')
})
