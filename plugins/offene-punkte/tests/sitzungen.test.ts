import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt, Warnung } from '../types'
import {
  hoechsteImVerlauf, kommando, notiz, nummerieren, verlaufsEintraege, zusammenfuehren,
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
    // Geschlossen behält seine Nummer; Nummer 2 ist hier offen vergeben: c bekommt die nächste.
    expect(l.find(p => p.id === 'a')?.nr).toBe(1)
    expect(l.find(p => p.id === 'c')).toMatchObject({ status: 'offen', sitzung: 'B', nr: 3 })
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
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
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

// ---------------------------------------------------------------- 0.8.0: fortlaufende Nummern, Später mit Termin, /offen neu

describe('Nummern, Termin und eigene Punkte', () => {
  test('/offen liest später mit Termin und neu mit Text (Groß- und Kleinschreibung bleibt)', async () => {
    expect(kommando('3 später morgen')).toEqual({ art: 'punkt', nummer: 3, tun: 'spaeter', bis: 'morgen' })
    expect(kommando('3 spaeter woche')).toEqual({ art: 'punkt', nummer: 3, tun: 'spaeter', bis: 'woche' })
    expect(kommando('3 später')).toEqual({ art: 'punkt', nummer: 3, tun: 'spaeter' })
    expect(kommando('3 a c')).toEqual({ art: 'punkt', nummer: 3, tun: 'optionen', optionen: [0, 2] })
    expect(kommando('3 c,a,c')).toEqual({ art: 'punkt', nummer: 3, tun: 'optionen', optionen: [0, 2] })
    expect(kommando('3 b')).toEqual({ art: 'punkt', nummer: 3, tun: 'option', option: 1 })
    expect(kommando('3 später gestern').art).toBe('fehler')
    expect(kommando('3 erledigt morgen').art).toBe('fehler')
    expect(kommando('neu Mail an Kai schreiben')).toEqual({ art: 'neu', text: 'Mail an Kai schreiben' })
    expect(kommando('Neu  zwei\nZeilen')).toEqual({ art: 'neu', text: 'zwei\nZeilen' })
    expect(kommando('neu').art).toBe('fehler')
  })

  test('eigener Punkt: Titel aus den ersten Wörtern, ohne Antworten; die Auswertung lässt ihn in Ruhe', async () => {
    const p = notiz('Schnellumschalter für alle laufenden Projekte, mit Zuständen.', 'n1', 5, 'A')
    expect([p.titel, p.frage, p.optionen, p.vonNutzer, p.sitzung]).toEqual(['Schnellumschalter für alle laufenden Projekte …', 'Schnellumschalter für alle laufenden Projekte, mit Zuständen.', [], true, 'A'])
    expect(notiz('Kurz.', 'n2', 5, '').titel).toBe('Kurz')
    const l = zusammenfuehren([{ ...p, nr: 1 }], { neu: [], aktualisiert: [{ id: 'n1', frage: 'anders?' }], erledigt: ['n1'], erwaehnt: [], ueberblick: '' }, 6, () => 'x')
    expect([l[0]?.status, l[0]?.frage, l[0]?.ohneBezug]).toEqual(['offen', p.frage, 0])
    const text = ablageText({ punkte: [{ ...p, nr: 1 }], ueberblick: '' }, 1)
    expect(text).not.toContain('Möglichkeiten')
    expect(ablageLesen(text)?.punkte[0]?.vonNutzer).toBe(true)
  })

  test('der Zähler übersteht die Datei; geschlossene behalten ihre Nummer; der Verlauf nennt sie', async () => {
    const text = ablageText({ punkte: [punkt('a', { nr: 3, status: 'erledigt' }), punkt('b', { nr: 4 })], ueberblick: '', hoechsteNr: 9 }, 1)
    const a = ablageLesen(text)!
    expect([a.hoechsteNr, a.punkte.map(p => p.nr)]).toEqual([9, [4, 3]])
    // Ältere Datei ohne Zähler: die höchste Nummer in der Liste
    expect(ablageLesen(text.replace(',"hoechsteNr":9', ''))?.hoechsteNr).toBe(4)

    const e = verlaufsEintraege([punkt('b', { nr: 4 })], [punkt('b', { nr: 4, status: 'erledigt', ergebnis: 'Ja' })], SONNTAG)
    expect(e[0]).toContain('## 14:00 · #4 b – entschieden')
    expect(hoechsteImVerlauf(`${e[0]}\n### 09:00 · #12 alt – verworfen\n## 10:00 · ohne Nummer – entschieden\n`)).toBe(12)
  })
})

test('/offen neu legt einen Punkt mit der nächsten Nummer an, /offen <Nr> später morgen legt ihn zurück; Nummern kommen nie zweimal', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([
    [OFFEN, ablageText({ punkte: [punkt('a', { nr: 1, titel: 'Ausrollen' })], ueberblick: '', hoechsteNr: 4 }, 1)],
    ['/projekt/offene-punkte/antworten-2026-10-01.md', '# Antworten\n\n## 10:00 · #6 Alt – entschieden\n'],
  ])
  grundlage(on, dateien, [{ name: 'antworten-2026-10-01.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }])
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  const lauf = async (args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)
  expect(await lauf('neu Gedanken-Knopf neben Senden bauen')).toBe('Punkt 7 angelegt: „Gedanken-Knopf neben Senden bauen“')
  await uhr.settle()
  expect(dateien.get(OFFEN)).toContain('### 7. Gedanken-Knopf neben Senden bauen')

  expect(await lauf('7 später morgen')).toBe('„Gedanken-Knopf neben Senden bauen“: ruht bis Mo 12.10.')
  await uhr.settle()
  expect(dateien.get(OFFEN)).toContain('### 7. Gedanken-Knopf neben Senden bauen (ruht bis Mo 12.10.)')

  await lauf('7 erledigt')
  await uhr.settle()
  expect(dateien.get('/projekt/offene-punkte/antworten-2026-10-11.md')).toContain('· #7 Gedanken-Knopf neben Senden bauen – entschieden')
  expect(await lauf('neu Noch einer')).toBe('Punkt 8 angelegt: „Noch einer“')
})

test('„erledigt: #N“ von Claude schließt sofort, /offen zeigt es mit 🤖, aktuell öffnet wieder', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({
    punkte: [punkt('a', { nr: 1, titel: 'Seite neu laden' }), punkt('b', { nr: 2, titel: 'Freigabe' })],
    ueberblick: '',
  }, 1)]])
  grundlage(on, dateien)
  on('prompt.context', (_, e) => ({ blocks: e.blocks }) as never)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  // Der Hinweis an Claude steht einmal im Kontext der Unterhaltung
  const kontext = await $.prompt.context({ blocks: [] } as never)
  expect(JSON.stringify(kontext)).toContain('erledigt: #<Nr>')

  // Kurze Antwort (keine Auswertung durch Haiku) - die Marke wirkt trotzdem
  await $.turn.complete({ answer: 'Neu geladen.\nerledigt: #1', reason: 'answer', durationMs: 10, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  const lauf = async (args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)
  const liste = await lauf('')
  expect(liste).toContain('Automatisch erledigt (1')
  expect(liste).toContain('🤖 1. Seite neu laden – von Claude als erledigt gemeldet')
  // Gegenprobe: #2 ist nicht genannt und bleibt offen
  expect(liste).toMatch(/2\. Freigabe/)
  expect(String(dateien.get(OFFEN))).toContain('- 🤖 Seite neu laden')

  expect(await lauf('1 aktuell')).toBe('„Seite neu laden“ ist wieder offen.')
  await uhr.settle()
  const danach = await lauf('')
  expect(danach).not.toContain('Automatisch erledigt')
  expect(danach).toMatch(/1\. Seite neu laden/)
})

describe('Doppelte Nummern (0.11.1)', () => {
  test('zwei Sitzungen zählen beide #1: die jüngere offene bekommt eine neue Nummer, geschlossene bleiben', async () => {
    // Sitzung A (Datei): #1 lange geschlossen, #41 offen. Sitzung B hat ohne Zählerstand eine eigene #1 vergeben.
    const datei = [punkt('alt', { nr: 1, titel: 'Alter Punkt', status: 'erledigt', erstellt: 10 }),
      punkt('a41', { nr: 41, titel: 'Offen in A', erstellt: 20 })]
    const b = [punkt('neu', { nr: 1, titel: 'Neu in B', erstellt: 30 })]
    const liste = abgleichen(b, datei, 41)
    const nr = (id: string) => liste.find(p => p.id === id)?.nr
    expect(nr('neu')).toBe(42)
    expect(nr('alt')).toBe(1)
    expect(nr('a41')).toBe(41)
    // Gegenprobe: ohne Kollision bleibt jede Nummer, wie sie ist
    const ohne = abgleichen([punkt('x', { nr: 42, erstellt: 30 })], datei, 41)
    expect(ohne.find(p => p.id === 'x')?.nr).toBe(42)
  })

  test('zwei offene mit gleicher Nummer: der ältere behält sie; auch beim Einlesen der Datei', async () => {
    const roh = ablageText({ punkte: [punkt('frueh', { nr: 1, erstellt: 5 }), punkt('spaet', { nr: 1, erstellt: 9 })], ueberblick: '', hoechsteNr: 7 }, 1)
    const gelesen = ablageLesen(roh)?.punkte ?? []
    expect(gelesen.find(p => p.id === 'frueh')?.nr).toBe(1)
    expect(gelesen.find(p => p.id === 'spaet')?.nr).toBe(8)
  })
})

test('Sitzung ohne geladenen Zählerstand (wie claude -p) vergibt die nächste freie Nummer, nicht #1', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({
    punkte: [punkt('alt', { nr: 1, titel: 'Alter Punkt', status: 'erledigt' }), punkt('a', { nr: 41, titel: 'Offen in A' })],
    ueberblick: '', hoechsteNr: 41,
  }, 1)]])
  grundlage(on, dateien)
  on('model.complete', () => ({ value: { isAnswered: true, text: JSON.stringify({ neu: [{ titel: 'Neu in B', frage: 'Soll ich?', optionen: [{ label: 'Ja', antwort: 'Ja.' }] }], erledigt: [] }),
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  // Kein session.start: die Liste ist leer, der Zähler steht auf 0
  const antwort = 'Soll ich das so machen? Ich brauche deine Freigabe dafür, bevor ich weitermache. '.repeat(6)
  await $.turn.complete({ answer: antwort, reason: 'answer', durationMs: 10, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  const d = ablageLesen(String(dateien.get(OFFEN)))
  expect(d?.punkte.find(p => p.titel === 'Neu in B')?.nr).toBe(42)
  expect(d?.punkte.find(p => p.id === 'alt')?.nr).toBe(1)
})
