import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt, Warnung } from '../types'
import {
  abgleichen, ablageLesen, ablageText, alteVerlaeufe, fragbar, monatsKopf, ruhe, statuszeile, stempeln, tagText, tagAnhaengen, uebernehmen, zuZeigen,
} from '../hooks/logik'

const punkt = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

// So 11.10.2026, 14:00 Ortszeit
const SONNTAG = new Date(2026, 9, 11, 14, 0).getTime()

describe('Abgleich zwischen Sitzungen', () => {
  test('geschlossen gewinnt; nur dort stehende Punkte kommen mit ihrer Sitzung dazu', async () => {
    const eigene = [punkt('a', { nr: 1, sitzung: 'A' }), punkt('b', { nr: 2, sitzung: 'A' })]
    const datei = [
      punkt('a', { nr: 1, sitzung: 'B', status: 'erledigt', ergebnis: 'dort entschieden', geaendert: 5 }),
      punkt('b', { nr: 2, sitzung: 'A' }),
      punkt('c', { nr: 2, sitzung: 'B' }),
      punkt('d', { sitzung: 'B', status: 'verworfen' }),
    ]
    const l = abgleichen(eigene, datei)
    expect(l.find(p => p.id === 'a')).toMatchObject({ status: 'erledigt', ergebnis: 'dort entschieden', sitzung: 'A' })
    expect(l.find(p => p.id === 'a')?.nr).toBeUndefined()
    // Nummer 2 ist hier vergeben: c bekommt die kleinste freie.
    expect(l.find(p => p.id === 'c')).toMatchObject({ status: 'offen', sitzung: 'B', nr: 1 })
    expect(l.find(p => p.id === 'b')?.nr).toBe(2)
    expect(l.find(p => p.id === 'd')?.status).toBe('verworfen')
  })

  test('hier wieder geöffnet (nach dem Schließen dort) bleibt offen; ein Schließen hier bleibt zu', async () => {
    const datei = [punkt('a', { status: 'erledigt', geaendert: 5 }), punkt('b')]
    const l = abgleichen([punkt('a', { geaendert: 9 }), punkt('b', { status: 'verworfen', geaendert: 9 })], datei)
    expect(l.map(p => p.status)).toEqual(['offen', 'verworfen'])
    // Vor dem Schließen dort geöffnet: das Schließen gewinnt.
    expect(abgleichen([punkt('a', { geaendert: 3 })], datei).find(p => p.id === 'a')?.status).toBe('erledigt')
  })

  test('stempeln merkt Wechsel zwischen offen und geschlossen; übernehmen macht Punkte zu eigenen', async () => {
    const l = stempeln([punkt('a'), punkt('b')], [punkt('a', { status: 'erledigt' }), punkt('b', { titel: 'neu' })], 7)
    expect(l.map(p => p.geaendert)).toEqual([7, undefined])
    const u = uebernehmen([punkt('a', { sitzung: 'alt' }), punkt('b', { sitzung: 'B' }), punkt('c', { sitzung: 'alt', status: 'erledigt' })], 'neu', 'alt')
    expect(u.map(p => p.sitzung)).toEqual(['neu', 'B', 'alt'])
  })

  test('gefragt wird nur, was zu dieser Sitzung gehört und nicht ruht; die Statuszeile nennt den Rest', async () => {
    const s = { sitzung: 'A', jetzt: SONNTAG }
    const liste = [
      punkt('eigen', { sitzung: 'A' }),
      punkt('alt'),
      punkt('fremd', { sitzung: 'B' }),
      punkt('morgen', { ruht: { bis: SONNTAG + 1 } }),
      punkt('vorbei', { ruht: { bis: SONNTAG - 1 } }),
      punkt('sitzung', { ruht: { sitzung: 'A' } }),
      punkt('letzte', { ruht: { sitzung: 'X' } }),
    ]
    expect(fragbar(liste, s).map(p => p.id)).toEqual(['eigen', 'alt', 'vorbei', 'letzte'])
    expect(statuszeile(liste, false, s)).toBe(`◆ 4 offen (3 zurückgelegt – nächster ${tagText(SONNTAG + 1)}) · /offen`)
    expect(statuszeile([punkt('fremd', { sitzung: 'B' })], false, s)).toBe('◇ 1 zurückgelegt · /offen')
  })

  test('die Statuszeile nennt, wann der nächste zurückgelegte Punkt wieder dran ist', async () => {
    const s = { sitzung: 'A', jetzt: SONNTAG }
    const montag = ruhe('woche', s).bis ?? 0
    const morgen = ruhe('morgen', s).bis ?? 0
    expect(statuszeile([punkt('m', { ruht: { bis: montag } })], false, s)).toBe(`◇ 1 zurückgelegt bis ${tagText(montag)} · /offen`)
    expect(statuszeile([punkt('m', { ruht: { bis: montag } }), punkt('t', { ruht: { bis: morgen } }), punkt('x')], false, s))
      .toBe(`◆ 1 offen (2 zurückgelegt – nächster ${tagText(morgen)}) · /offen`)
    expect(statuszeile([punkt('a', { ruht: { sitzung: 'A' } }), punkt('b', { ruht: { sitzung: 'A' } })], false, s))
      .toBe('◇ 2 zurückgelegt bis zur nächsten Sitzung · /offen')
    expect(statuszeile([punkt('v', { ruht: { bis: SONNTAG - 1 } })], false, s)).toBe('◆ 1 offen · /offen')
  })

  test('Ruhezeiten: Mitternacht morgen, in drei Tagen, nächster Montag; nächste Sitzung', async () => {
    const s = { sitzung: 'A', jetzt: SONNTAG }
    expect(new Date(ruhe('morgen', s).bis!).toString()).toBe(new Date(2026, 9, 12).toString())
    expect(new Date(ruhe('drei', s).bis!).toString()).toBe(new Date(2026, 9, 14).toString())
    expect(new Date(ruhe('woche', s).bis!).toString()).toBe(new Date(2026, 9, 12).toString())
    const montag = { sitzung: 'A', jetzt: new Date(2026, 9, 12, 9).getTime() }
    expect(new Date(ruhe('woche', montag).bis!).toString()).toBe(new Date(2026, 9, 19).toString())
    expect(ruhe('sitzung', s)).toEqual({ sitzung: 'A' })
  })

  test('Sitzung, Ruhe und Zeitstempel überstehen die Datei', async () => {
    const text = ablageText({ punkte: [punkt('a', { sitzung: 'A', ruht: { bis: SONNTAG + 86_400_000 }, geaendert: 3 })], ueberblick: '' }, SONNTAG)
    expect(text).toContain('a (ruht bis Mo 12.10.)')
    expect(ablageLesen(text)?.punkte[0]).toMatchObject({ sitzung: 'A', ruht: { bis: SONNTAG + 86_400_000 }, geaendert: 3 })
  })
})

describe('Verlauf und Warnungen', () => {
  test('Tagesverläufe älter als 30 Tage nach Monat; ein Tag kommt nur einmal in die Monatsdatei', async () => {
    const m = alteVerlaeufe(['antworten-2026-08-30.md', 'antworten-2026-09-02.md', 'antworten-2026-08-01.md', 'antworten-2026-09-20.md', 'offen.md', 'antworten-2026-08.md'], SONNTAG)
    expect([...m]).toEqual([['2026-08', ['2026-08-01', '2026-08-30']], ['2026-09', ['2026-09-02']]])

    const tag = '# Antworten auf offene Punkte – 2026-08-01\n\nWas entschieden, erledigt oder verworfen wurde, mit den Gründen von damals.\n\n## 10:00 · X – entschieden\n\n**Frage:** ?\n'
    const einmal = tagAnhaengen(monatsKopf('2026-08'), '2026-08-01', tag)
    expect(einmal).toContain('\n## 2026-08-01\n\n### 10:00 · X – entschieden\n')
    expect(einmal).not.toContain('Gründen von damals.\n\n###')
    expect(tagAnhaengen(einmal!, '2026-08-01', tag)).toBeNull()
  })

  test('über der Eingabe nur Warnungen, ohne die ausgeblendeten', async () => {
    const w: Warnung[] = [
      { schluessel: 'kontext-kritisch', stufe: 'warn', text: 'Auto-Compact' },
      { schluessel: 'cache-kalt', stufe: 'info', text: 'kalt' },
      { schluessel: 'cache-bald', stufe: 'warn', text: 'bald' },
    ]
    expect(zuZeigen(w, ['cache-bald']).map(x => x.schluessel)).toEqual(['kontext-kritisch'])
  })
})

// ---------------------------------------------------------------- Ablauf

type Eintrag = { name: string; kind: 'file'; size: number; mtimeMs: number; isLink: boolean }

function grundlage(on: On, dateien: Map<string, string>, liste: Eintrag[] = []) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  ;(on as unknown as (name: string, hook: () => unknown) => void)('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('session.root', () => ({ value: '/projekt' }) as never)
  on('session.id', () => ({ value: 'A' }) as never)
  on('env.get', () => ({ value: undefined }) as never)
  on('fs.stat', (_, e) => {
    if (e.path === '/projekt/.git') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
    throw new Error('ENOENT')
  })
  on('fs.read', (_, e) => {
    const t = dateien.get(e.path)
    if (t === undefined) throw new Error('ENOENT')
    return { value: t } as never
  })
  on('fs.write', (_, e) => {
    dateien.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('fs.list', () => ({ value: liste }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

const band = (surface: 'terminal' | 'mobile') => ({
  plugin: 'offene-punkte', component: 'AbovePrompt' as const, surface,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
})

const OFFEN = '/projekt/offene-punkte/offen.md'

test('Abgleich im Betrieb: fremde Punkte nur in /offen, geschlossene schließen sich', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({
    punkte: [punkt('a', { nr: 1, titel: 'Ausrollen' }), punkt('c', { nr: 2, titel: 'Eigenes' })],
    ueberblick: '',
  }, 1)]])
  grundlage(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  // Sitzung B hat inzwischen a geschlossen und b angelegt.
  dateien.set(OFFEN, ablageText({
    punkte: [
      punkt('a', { nr: 1, titel: 'Ausrollen', sitzung: 'B', status: 'erledigt', ergebnis: 'in B entschieden', geaendert: SONNTAG }),
      punkt('b', { nr: 3, titel: 'Mail einrichten', sitzung: 'B' }),
      punkt('c', { nr: 2, titel: 'Eigenes', sitzung: 'A' }),
    ],
    ueberblick: '',
  }, SONNTAG))
  // Eine Änderung hier: c zurückstellen schreibt die Datei und gleicht dabei ab.
  await $.command.run({ command: 'offen', args: '2 später' } as never)
  await uhr.settle()

  const liste = String(((await $.command.run({ command: 'offen', args: '' } as never)) as { text?: string }).text)
  expect(liste).not.toContain('Ausrollen –')
  expect(liste).toContain('3. Mail einrichten (aus anderer Sitzung)')
  expect(dateien.get(OFFEN)).toContain('✓ Ausrollen: in B entschieden')

  const ui = await $.ui.mount(band('terminal') as never)
  expect(await ui.find({ type: 'Text', text: 'Eigenes' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Mail einrichten' })).toBeUndefined()
  await ui.unmount()
})

test('Später → Morgen: der Punkt ruht bis Mitternacht und ist danach wieder dran', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({ punkte: [punkt('a', { nr: 1, titel: 'Ausrollen' })], ueberblick: '' }, 1)]])
  grundlage(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'mobile', isInteractive: true } as never)
  await uhr.settle()

  const ui = await $.ui.mount(band('mobile') as never)
  const spaeter = await ui.find({ type: 'Button', text: 'Später' })
  await ui.press({ key: String((spaeter as { key?: string }).key) })
  const morgen = await ui.find({ type: 'Button', text: 'Morgen' })
  expect(morgen).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Nächste Sitzung' })).toBeDefined()
  await ui.press({ key: String((morgen as { key?: string }).key) })
  await uhr.settle()
  expect(await ui.find({ type: 'Text', text: 'Ausrollen' })).toBeUndefined()
  await ui.unmount()
  expect(dateien.get(OFFEN)).toContain('Ausrollen (ruht bis Mo 12.10.)')

  await uhr.advance(12 * 3_600_000)
  const danach = await $.ui.mount(band('mobile') as never)
  expect(await danach.find({ type: 'Text', text: 'Ausrollen' })).toBeDefined()
  await danach.unmount()
})

test('/offen <Nr> aktuell holt einen zurückgelegten Punkt sofort zurück', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({ punkte: [
    punkt('a', { nr: 1, titel: 'Ausrollen', ruht: { bis: SONNTAG + 7 * 86_400_000 } }),
    punkt('b', { nr: 2, titel: 'Aufräumen', zurueckgestellt: 2 }),
  ], ueberblick: '' }, 1)]])
  grundlage(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'mobile', isInteractive: true } as never)
  await uhr.settle()

  const r = await $.command.run({ command: 'offen', args: '1 aktuell' } as never)
  expect(String((r as { text?: string }).text)).toBe('„Ausrollen“: wieder aktuell.')
  await $.command.run({ command: 'offen', args: '2 aktuell' } as never)
  await uhr.settle()
  expect(dateien.get(OFFEN)).not.toContain('ruht bis')
  expect(dateien.get(OFFEN)).not.toContain('zurückgestellt')
  const ui = await $.ui.mount(band('mobile') as never)
  expect(await ui.find({ type: 'Text', text: 'Ausrollen' })).toBeDefined()
  await ui.unmount()
})

test('Warnungen von kontext-anzeige stehen über der Eingabe, mit /compact und Ausblenden', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  grundlage(on, new Map())
  const warnungen: Warnung[] = [
    { schluessel: 'kontext-kritisch', stufe: 'warn', text: 'Auto-Compact steht bevor' },
    { schluessel: 'cache-kalt', stufe: 'info', text: 'Cache abgelaufen' },
  ]
  on('state.get', ($, e, next) => (e.plugin === 'kontext-anzeige' ? { value: { value: warnungen, version: 1 } } : next(e)) as never)
  const box = { text: '' }
  on('prompt.fill', (_, e) => {
    box.text = e.text
    return { isFilled: true } as never
  })
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  const ui = await $.ui.mount(band('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /Auto-Compact steht bevor/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Cache abgelaufen/ })).toBeUndefined()
  const compact = await ui.find({ type: 'Button', text: '/compact' })
  await ui.press({ key: String((compact as { key?: string }).key) })
  await uhr.settle()
  expect(box.text).toBe('/compact ')
  const aus = await ui.find({ type: 'Button', text: 'Ausblenden' })
  await ui.press({ key: String((aus as { key?: string }).key) })
  await uhr.settle()
  expect(await ui.find({ type: 'Text', text: /Auto-Compact steht bevor/ })).toBeUndefined()
  await ui.unmount()
})

test('alte Tagesverläufe wandern beim Start in die Monatsdatei', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([
    ['/projekt/offene-punkte/antworten-2026-08-01.md', '# Antworten auf offene Punkte – 2026-08-01\n\nWas entschieden, erledigt oder verworfen wurde, mit den Gründen von damals.\n\n## 10:00 · X – entschieden\n'],
  ])
  grundlage(on, dateien, ['antworten-2026-08-01.md', 'antworten-2026-10-10.md'].map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })))
  const befehle: string[][] = []
  on('process.run', (_, e) => {
    befehle.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  expect(dateien.get('/projekt/offene-punkte/antworten-2026-08.md')).toContain('## 2026-08-01\n\n### 10:00 · X – entschieden')
  expect(befehle).toEqual([['rm', '-f', '/projekt/offene-punkte/antworten-2026-08-01.md']])
})
