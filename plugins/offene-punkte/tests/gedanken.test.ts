import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { gedankeBitte, gedankeZustand, gedankenLesen, gedankenMarken, gedankenPruefBitte, gedankenText, kommando, naechsteGedankenNr, zeitText } from '../hooks/logik'

const DATEI = `# Gedanken

Was mir einfällt.

### G1 · 13.10.2026 22:10 · offen
Den Leitstand nachts drosseln.

### G2 · 13.10.2026 22:15 · gesendet
Logo-Overlay
auch auf geraet3.

### G3 · 12.10.2026 09:00 · erledigt 13.10. · Commit abc1234
Alte Idee.
`

describe('gedanken.md', () => {
  test('lesen: Kopf bleibt, Einträge mit Nummer, Zeit, Vermerk und mehrzeiligem Text', () => {
    const d = gedankenLesen(DATEI)
    expect(d.kopf).toBe('# Gedanken\n\nWas mir einfällt.\n')
    expect(d.gedanken.map(g => [g.nr, g.zeit, g.vermerk])).toEqual([
      [1, '13.10.2026 22:10', 'offen'],
      [2, '13.10.2026 22:15', 'gesendet'],
      [3, '12.10.2026 09:00', 'erledigt 13.10. · Commit abc1234'],
    ])
    expect(d.gedanken[1]?.text).toBe('Logo-Overlay\nauch auf geraet3.')
    expect(d.gedanken.map(gedankeZustand)).toEqual(['offen', 'in Arbeit', 'verarbeitet'])
    expect(naechsteGedankenNr(d)).toBe(4)
  })

  test('schreiben und wieder lesen ergibt dasselbe; leere Datei bekommt den Standardkopf', () => {
    const d = gedankenLesen(DATEI)
    expect(gedankenLesen(gedankenText(d))).toEqual(d)
    const leer = gedankenLesen('')
    expect(leer).toEqual({ kopf: '', gedanken: [] })
    expect(gedankenText({ kopf: '', gedanken: [{ nr: 1, zeit: '14.10.2026 09:00', vermerk: 'offen', text: 'Hallo' }] }))
      .toBe('# Gedanken\n\nEinfälle, die noch nicht dran sind; wird von offene-punkte und claude-web geschrieben.\n\n### G1 · 14.10.2026 09:00 · offen\nHallo\n')
  })

  test('claude-web-Dateien: Abschnitte „## …“ gehören zu keinem Gedanken; alte Vermerke zählen als verarbeitet', () => {
    const d = gedankenLesen([
      '# Gedanken', '', '## Offen', '', '### G1 · 13.10.2026 22:10 · offen', 'A', '', '## In Arbeit', '',
      '### G2 · 13.10.2026 22:11 · als offener Punkt #4', 'B', '', '## Verarbeitet', '', '### G3 · 13.10.2026 22:12 · in den Chat gegeben', 'C', '',
    ].join('\n'))
    expect(d.kopf).toBe('# Gedanken\n')
    expect(d.gedanken.map(g => g.text)).toEqual(['A', 'B', 'C'])
    expect(d.gedanken.map(gedankeZustand)).toEqual(['offen', 'verarbeitet', 'verarbeitet'])
    expect(gedankeZustand({ nr: 9, zeit: '', vermerk: 'als Punkt #12', text: '' })).toBe('verarbeitet')
    expect(gedankenText(d)).not.toContain('## Offen')
  })

  test('Marken von Claude: erledigt mit Commit, verworfen mit Grund; G ohne Buchstabe geht auch', () => {
    const jetzt = new Date(2026, 9, 14, 9, 5).getTime()
    expect(zeitText(jetzt)).toBe('14.10.2026 09:05')
    expect(gedankenMarken('Fertig.\ngedanke erledigt: G2 – Commit abc1234\ngedanke verworfen: 5 – zu teuer', jetzt)).toEqual([
      { nr: 2, vermerk: 'erledigt 14.10. · Commit abc1234' },
      { nr: 5, vermerk: 'verworfen 14.10. · zu teuer' },
    ])
    expect(gedankenMarken('Der Gedanke ist erledigt.', jetzt)).toEqual([])
  })

  test('Bitten nennen Nummer, Text und die Marke; die Prüfung ist eine Automatische Klärung', () => {
    const g = { nr: 2, zeit: '13.10.2026 22:15', vermerk: 'offen', text: 'Logo-Overlay auch auf geraet3.' }
    expect(gedankeBitte(g, 'senden')).toContain('Gedanke G2 (13.10.2026 22:15): Logo-Overlay auch auf geraet3.')
    expect(gedankeBitte(g, 'senden')).toContain('gedanke erledigt: G2')
    expect(gedankeBitte(g, 'interview')).toContain('Planungsinterview')
    expect(gedankenPruefBitte([g])).toMatch(/^Automatische Klärung der Gedanken/)
    expect(gedankenPruefBitte([g])).toContain('G2 (offen)')
  })

  test('/offen-Befehle für Gedanken', () => {
    expect(kommando('gedanke Den Leitstand nachts drosseln')).toEqual({ art: 'gedanke-neu', text: 'Den Leitstand nachts drosseln' })
    expect(kommando('gedanke 3 Dinge prüfen')).toEqual({ art: 'gedanke-neu', text: '3 Dinge prüfen' })
    expect(kommando('gedanke')).toMatchObject({ art: 'fehler' })
    expect(kommando('gedanken')).toEqual({ art: 'gedanken' })
    expect(kommando('gedanken prüfen')).toEqual({ art: 'gedanken-pruefen' })
    expect(kommando('gedanke 2 senden')).toEqual({ art: 'gedanke', nummer: 2, tun: 'senden', text: '' })
    expect(kommando('gedanke G2 Interview')).toEqual({ art: 'gedanke', nummer: 2, tun: 'interview', text: '' })
    expect(kommando('gedanke 2 erledigt von Hand')).toEqual({ art: 'gedanke', nummer: 2, tun: 'erledigt', text: 'von Hand' })
  })
})

// ---------------------------------------------------------------- Ablauf

const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function grundlage(on: On, dateien: Map<string, string>) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.root', () => ({ value: '/projekt' }) as never)
  on('session.id', () => ({ value: 'A' }) as never)
  on('env.get', () => ({ value: undefined }) as never)
  on('fs.stat', (_, e) => {
    if (pfad(e.path) === '/projekt/.git') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
    throw new Error('ENOENT')
  })
  on('fs.read', (_, e) => {
    const t = dateien.get(pfad(e.path))
    if (t === undefined) throw new Error('ENOENT')
    return { value: t } as never
  })
  on('fs.write', (_, e) => {
    dateien.set(pfad(e.path), e.text)
    return { value: undefined } as never
  })
  on('fs.list', () => ({ value: [] }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

const GEDANKEN = '/projekt/offene-punkte/gedanken.md'

test('notieren, senden, Marke: der Vermerk wandert von offen über gesendet zu erledigt', async ($, on) => {
  const uhr = mock.clock(on, { now: new Date(2026, 9, 14, 9, 5).getTime() })
  const dateien = new Map<string, string>()
  grundlage(on, dateien)
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  const r1 = String(((await $.command.run({ command: 'offen', args: 'gedanke Den Leitstand nachts drosseln' } as never)) as { text?: string }).text)
  expect(r1).toContain('Gedanke G1 notiert')
  expect(dateien.get(GEDANKEN)).toContain('### G1 · 14.10.2026 09:05 · offen\nDen Leitstand nachts drosseln')

  const liste = String(((await $.command.run({ command: 'offen', args: 'gedanken' } as never)) as { text?: string }).text)
  expect(liste).toContain('G1 · 14.10.2026 09:05 · offen: Den Leitstand nachts drosseln')

  const r2 = String(((await $.command.run({ command: 'offen', args: 'gedanke 1 senden' } as never)) as { text?: string }).text)
  expect(r2).toBe('G1 geht an Claude.')
  await uhr.settle()
  expect(gesendet).toHaveLength(1)
  expect(gesendet[0]).toContain('Gedanke G1 (14.10.2026 09:05): Den Leitstand nachts drosseln')
  expect(dateien.get(GEDANKEN)).toContain('### G1 · 14.10.2026 09:05 · gesendet')

  await $.turn.complete({ answer: 'Eingebaut und committet.\n\ngedanke erledigt: G1 – Commit abc1234', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  expect(dateien.get(GEDANKEN)).toContain('### G1 · 14.10.2026 09:05 · erledigt 14.10. · Commit abc1234')
  expect(String(((await $.command.run({ command: 'offen', args: 'gedanken' } as never)) as { text?: string }).text)).toContain('Keine Gedanken offen')
})

test('als Punkt: aus dem Gedanken wird ein eigener offener Punkt, der Vermerk nennt die Nummer', async ($, on) => {
  const uhr = mock.clock(on, { now: new Date(2026, 9, 14, 9, 5).getTime() })
  const dateien = new Map<string, string>([[GEDANKEN, '### G7 · 13.10.2026 22:10 · offen\nLogo-Overlay auch auf geraet3 einbauen\n']])
  grundlage(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()
  const r = String(((await $.command.run({ command: 'offen', args: 'gedanke 7 punkt' } as never)) as { text?: string }).text)
  expect(r).toContain('G7 ist jetzt Punkt 1')
  await uhr.settle()
  expect(dateien.get(GEDANKEN)).toContain('### G7 · 13.10.2026 22:10 · als Punkt #1')
  const offen = String(((await $.command.run({ command: 'offen', args: '' } as never)) as { text?: string }).text)
  expect(offen).toContain('1. Logo-Overlay auch auf geraet3')
  expect(offen).toContain('Vom Nutzer notiert.')
})

test('prüfen: ein Maschinen-Turn, dessen Antwort nicht ausgewertet wird, aber Marken setzt', async ($, on) => {
  const uhr = mock.clock(on, { now: new Date(2026, 9, 14, 9, 5).getTime() })
  const dateien = new Map<string, string>([[GEDANKEN, '### G1 · 13.10.2026 22:10 · gesendet\nA\n\n### G2 · 13.10.2026 22:11 · offen\nB\n']])
  grundlage(on, dateien)
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
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()
  const r = String(((await $.command.run({ command: 'offen', args: 'gedanken prüfen' } as never)) as { text?: string }).text)
  expect(r).toContain('Prüfung von 1')
  await uhr.settle()
  expect(gesendet[0]).toContain('G1 (gesendet): A')
  expect(gesendet[0]).not.toContain('G2')
  await $.turn.complete({ answer: 'Geprüft. Soll ich noch etwas tun?\ngedanke verworfen: G1 – nicht mehr nötig', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  expect(haiku).toBe(0)
  expect(dateien.get(GEDANKEN)).toContain('### G1 · 13.10.2026 22:10 · verworfen 14.10. · nicht mehr nötig')
})
