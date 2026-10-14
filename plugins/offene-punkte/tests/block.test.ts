import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { HINWEIS_BLOCK, antwortIn, befehle, blockLesen, sammelText } from '../hooks/logik'

const BLOCK = `Alles gebaut.

\`\`\`offen
# Geräte-Token eintragen | aufgabe | blockiert
Hast du das Token im Abholer eingetragen?
a) eingetragen, Test starten
b) Fehler:
info: Ohne Token kann ich die Grenze nicht prüfen.
anleitung: 1. Token auf https://sprache.31d.de/geraete anlegen
2. In die Datei eintragen:
$ nano pc/abholer.lokal.json
# #12 Upload-Grenze | entscheidung
Welche Grenze: 55 MB oder aufteilen?
a) 55 MB (empfohlen)
b) Absätze aufteilen
\`\`\`
`

describe('Block in der Antwort', () => {
  test('liest neue Punkte und Änderungen per Nummer; Labels sind zugleich die Antwort', () => {
    const r = blockLesen(BLOCK)
    expect(r.neu.map(p => p.titel)).toEqual(['Geräte-Token eintragen'])
    const p = r.neu[0]!
    expect([p.art, p.stufe, p.frage, p.info]).toEqual(['aufgabe', 'blockiert', 'Hast du das Token im Abholer eingetragen?', 'Ohne Token kann ich die Grenze nicht prüfen.'])
    expect(p.optionen).toEqual([
      { label: 'eingetragen, Test starten', antwort: 'eingetragen, Test starten' },
      { label: 'Fehler:', antwort: 'Fehler:' },
    ])
    expect(p.anleitung).toContain('1. Token auf https://sprache.31d.de/geraete anlegen')
    expect(p.anleitung).toContain('$ nano pc/abholer.lokal.json')
    expect(befehle(p.anleitung)).toEqual(['nano pc/abholer.lokal.json'])
    expect(r.aenderungen).toEqual([{
      nr: 12,
      titel: 'Upload-Grenze',
      // seit 0.16.6: die Art im Kopf geht mit (ohne Angabe bleibt sie, wie sie ist)
      art: 'entscheidung',
      frage: 'Welche Grenze: 55 MB oder aufteilen?',
      optionen: [{ label: '55 MB (empfohlen)', antwort: '55 MB (empfohlen)' }, { label: 'Absätze aufteilen', antwort: 'Absätze aufteilen' }],
    }])
  })

  test('ohne Zaun nichts; ohne Kopfzeile nichts; ohne Möglichkeit fällt der Punkt weg', () => {
    expect(blockLesen('Fertig. erledigt: #3')).toEqual({ neu: [], aenderungen: [] })
    expect(blockLesen('```offen\nnur Text\n```')).toEqual({ neu: [], aenderungen: [] })
    expect(blockLesen('```offen\n# Ohne Wahl\nFrage?\n```').neu).toEqual([])
  })

  test('Vorgaben: art und stufe auch als Zeile, feste Knöpfe fallen weg, mehrzeilige Frage', () => {
    const r = blockLesen('```offene-punkte\n# Freigabe\nSoll ich\nausrollen?\nart: entscheidung\nstufe: angebot\na) Ja, ausrollen\nb) Später\n```')
    expect(r.neu[0]?.frage).toBe('Soll ich ausrollen?')
    expect([r.neu[0]?.art, r.neu[0]?.stufe]).toEqual(['entscheidung', 'angebot'])
    expect(r.neu[0]?.optionen.map(o => o.label)).toEqual(['Ja, ausrollen'])
  })

  test('der Hinweis erklärt den Block und die Marken', () => {
    expect(HINWEIS_BLOCK).toContain('```offen')
    expect(HINWEIS_BLOCK).toContain('erledigt: #<Nr>')
    // geht in jede Sitzung: knapp halten (0.16.6: +„bei dir“-Satz, 0.16.7: +Nummern nicht raten)
    expect(HINWEIS_BLOCK.length).toBeLessThan(2_000)
  })

  test('Antwort mit Label: die Frage steht dabei, antwortIn findet den Text trotzdem', () => {
    const t = sammelText([{ titel: 'Upload-Grenze', text: '55 MB (empfohlen)', frage: 'Welche Grenze?' }])
    expect(t).toBe('Zum offenen Punkt „Upload-Grenze“ (Welche Grenze?): 55 MB (empfohlen)')
    expect(antwortIn(t, 'Upload-Grenze')).toBe('55 MB (empfohlen)')
    expect(sammelText([{ titel: 'A', text: 'x' }])).toBe('Zum offenen Punkt „A“: x')
    expect(sammelText([{ titel: 'A', text: 'x', frage: 'A?' }, { titel: 'B', text: 'y' }])).toBe('Zu den offenen Punkten:\n- „A“ (A?): x\n- „B“: y')
  })
})

// ---------------------------------------------------------------- Ablauf

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
  surface: 'terminal' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

test('ein Block in der Antwort legt den Punkt an - ohne Haiku; die Wahl schickt Label und Frage', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlage(on)
  let haiku = 0
  on('model.complete', () => {
    haiku++
    return { value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}' } } as never
  })
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  // Die Schlussfrage allein riefe Haiku - mit Block nicht.
  await $.turn.complete({ answer: `${BLOCK}\nSoll ich weitermachen?`, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  expect(haiku).toBe(0)

  const ui = await $.ui.mount(band as never)
  expect(await ui.find({ type: 'Text', text: /Hast du das Token im Abholer eingetragen\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /■ Blockiert/ })).toBeDefined()
  const sel = await ui.find({ type: 'Select' })
  // Die erste Antwort steht als Knopf "a) …" neben dem Menü
  const knopfA = await ui.find({ type: 'Button', text: /^a\) / })
  expect(knopfA).toBeDefined()
  await ui.press({ key: String((knopfA as { key?: string }).key) })
  await uhr.advance(5_000)
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Geräte-Token eintragen“ (Hast du das Token im Abholer eingetragen?): eingetragen, Test starten'])
  await ui.unmount()
})

test('„# #<Nr> Titel“ im Block ändert den bestehenden Punkt statt einen neuen anzulegen', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlage(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}' } }) as never)
  await $.turn.complete({ answer: '```offen\n# Grenze wählen | entscheidung\nWelche Grenze?\na) 8 MB\nb) 55 MB\n```', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  await $.turn.complete({ answer: 'Neue Lage.\n```offen\n# #1 Grenze festlegen\nWelche Grenze jetzt: 55 oder 100 MB?\na) 55 MB\nb) 100 MB\n```', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't2' } as never)
  await uhr.settle()
  const liste = String(((await $.command.run({ command: 'offen', args: '' } as never)) as { text?: string }).text)
  expect(liste).toContain('1. Grenze festlegen')
  expect(liste).toContain('Welche Grenze jetzt: 55 oder 100 MB?')
  expect(liste).toContain('b) 100 MB')
  expect(liste).not.toContain('2. ')
})
