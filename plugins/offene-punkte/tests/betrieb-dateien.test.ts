import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  ABGLEICH_NACH_MS, ABGLEICH_TAKT_MS, VERSION, ablageDaten, ablageLesen, ablageText, befehle, installierteVersion, neuerAlsLaufend
} from '../hooks/logik'
import { OFFEN, pfad } from './helfer'

const punkt = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }, { label: 'Nein', antwort: '' }],
  status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

const ANTWORT = 'Die Seite ist fertig. Soll ich sie ausrollen? '.repeat(12)

const HAIKU = JSON.stringify({
  neu: [{
    titel: 'Ausrollen', art: 'entscheidung', stufe: 'blockiert', frage: 'Soll ich ausrollen?', info: 'Getestet, nicht live.',
    abwaegung: 'Tests sind grün; heute ist wenig Verkehr.', optionen: [{ label: 'Ja', antwort: 'Ja, rolle aus.' }],
  }],
  erledigt: [],
})

function grundlage(on: On, dateien: Map<string, string>, box = { text: '' }) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  // Die Eingabe, wie sie gerade steht (ein Aufruf ohne eigenes Ereignis in den Typen).
  ;(on as unknown as (name: string, hook: () => unknown) => void)('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.root', () => ({ value: '/projekt' }) as never)
  on('env.get', () => ({ value: '/home/x' }) as never)
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
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

const band = (surface: 'terminal' | 'desktop' | 'mobile') => ({
  plugin: 'offene-punkte', component: 'AbovePrompt' as const, surface,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
})

const TAG = 24 * 3600_000

const JETZT = 20 * TAG

const punktMehrsitzung = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: JETZT - TAG, ...extra,
})

const ORDNER = '/projekt/offene-punkte'

function grundlageMehrsitzung(on: On, dateien: Map<string, string>, befehle: string[][]) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('session.root', () => ({ value: '/projekt' }) as never)
  on('session.id', () => ({ value: 'A' }) as never)
  on('env.get', () => ({ value: undefined }) as never)
  on('fs.exists', (_, e) => ({ value: pfad(e.path) === ORDNER || dateien.has(pfad(e.path)) }) as never)
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
  // mkdir, mv, rmdir und git log: gelingen und werden mitgeschrieben; mv verschiebt wirklich.
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    befehle.push(argv)
    if (argv[0] === 'mv') {
      const von = dateien.get(pfad(argv[2] ?? ''))
      if (von !== undefined) {
        dateien.set(pfad(argv[3] ?? ''), von)
        dateien.delete(pfad(argv[2] ?? ''))
      }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
}

function haiku(on: On) {
  const arten: string[] = []
  on('model.complete', (_, e) => {
    arten.push(String(e.prompt).slice(0, 40))
    return { value: { isAnswered: true, text: '{"ergebnisse":[]}' } } as never
  })
  return arten
}

const START = JETZT

const altePunkte = () => ablageText({
  punkte: [punktMehrsitzung('a', { nr: 1, erstellt: START - ABGLEICH_NACH_MS - 1000, sitzung: 'alt' })], ueberblick: '', hoechsteNr: 1,
}, START - 1000)

const punktSitzungen = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

// So 11.10.2026, 14:00 Ortszeit
const SONNTAG = new Date(2026, 9, 11, 14, 0).getTime()

type Eintrag = { name: string; kind: 'file'; size: number; mtimeMs: number; isLink: boolean }

function grundlageSitzungen(on: On, dateien: Map<string, string>, liste: Eintrag[] = []) {
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
  on('fs.list', () => ({ value: liste }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

const bandSitzungen = (surface: 'terminal' | 'mobile') => ({
  plugin: 'offene-punkte', component: 'AbovePrompt' as const, surface,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
})

test('Punkte landen in offen.md, Antworten mit Abwägung im Tagesverlauf, die Ausnahme in .git/info/exclude', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  const dateien = new Map<string, string>()
  grundlage(on, dateien)
  on('model.complete', () => ({ value: { isAnswered: true, text: HAIKU } }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)

  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  expect(dateien.get('/projekt/.git/info/exclude')).toContain('/offene-punkte/')
  expect(dateien.get('/projekt/offene-punkte/offen.md')).toContain('### 1. Ausrollen (blockiert)')

  const ui = await $.ui.mount(band('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /■ Blockiert/ })).toBeDefined()
  // Abgesetzt: roter Rahmen um die Frage; die Auswahl zeigt "bitte wählen" statt "none".
  const rahmen = (await ui.find({ type: 'Box' })) as { props?: { borderStyle?: string; borderColor?: string } } | undefined
  expect([rahmen?.props?.borderStyle, rahmen?.props?.borderColor]).toEqual(['round', 'red'])
  const sel = await ui.find({ type: 'Select' })
  expect((sel as { props?: { value?: string } }).props?.value).toBe('__keine')
  await $.ui.select({ plugin: 'offene-punkte', key: String((sel as { key?: string }).key), value: '__keine' } as never)
  expect(dateien.get('/projekt/offene-punkte/offen.md')).toContain('### 1. Ausrollen')
  // Die erste Antwort steht als Knopf "a) …" neben dem Menü
  const knopfA = await ui.find({ type: 'Button', text: /^a\) / })
  expect(knopfA).toBeDefined()
  await ui.press({ key: String((knopfA as { key?: string }).key) })
  await ui.unmount()
  // Erst wenn die Antwort bei Claude ist (alle beantwortet: nach 5 s), schließt sich der Punkt.
  await uhr.advance(5_000)

  const verlauf = [...dateien.entries()].find(([k]) => /antworten-\d{4}-\d\d-\d\d\.md$/.test(k))?.[1] ?? ''
  expect(verlauf).toContain('Ausrollen – entschieden')
  expect(verlauf).toContain('Tests sind grün')
  expect(verlauf).toContain('**Ergebnis:** Ja – „Ja, rolle aus.“')
  expect(dateien.get('/projekt/offene-punkte/offen.md')).toContain('Nichts offen.')
})

test('neue Sitzung übernimmt die Punkte aus offen.md; /offen 1 erledigt und Wieder öffnen', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  const dateien = new Map<string, string>([
    ['/projekt/offene-punkte/offen.md', ablageText({ punkte: [punkt('alt1', { titel: 'Sitemap einreichen' })], ueberblick: '- **Ziel:** SEO' }, 1)],
  ])
  grundlage(on, dateien)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  const liste = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((liste as { text?: string }).text)).toContain('1. Sitemap einreichen')
  expect(String((liste as { text?: string }).text)).toContain('Überblick:\n- **Ziel:** SEO')

  const r = await $.command.run({ command: 'offen', args: '1 erledigt' } as never)
  expect(String((r as { text?: string }).text)).toBe('„Sitemap einreichen“: erledigt.')

  const pane = await $.ui.mount({ plugin: 'offene-punkte', surface: 'terminal', component: 'Pane', requestId: 'offene-punkte', props: {} } as never)
  const auf = await pane.find({ type: 'Button', text: 'Wieder öffnen' })
  expect(auf).toBeDefined()
  await pane.press({ key: String((auf as { key?: string }).key) })
  await pane.unmount()
  const wieder = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((wieder as { text?: string }).text)).toContain('1. Sitemap einreichen')
})

test('Abgleich: eben von einer anderen Sitzung gemacht - kein Haiku-Aufruf', async ($, on) => {
  const uhr = mock.clock(on, { now: START })
  const dateien = new Map([[`${ORDNER}/offen.md`, altePunkte()], [`${ORDNER}/abgleich.txt`, `${START - 10 * 60_000} B\n`]])
  const befehle: string[][] = []
  grundlageMehrsitzung(on, dateien, befehle)
  const anfragen = haiku(on)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()
  expect(anfragen).toEqual([])
  expect(dateien.get(`${ORDNER}/abgleich.txt`)).toBe(`${START - 10 * 60_000} B\n`)
})

test('Abgleich fällig: diese Sitzung trägt sich ein und fragt Haiku; geschrieben wird unter der Sperre', async ($, on) => {
  const uhr = mock.clock(on, { now: START })
  const dateien = new Map([[`${ORDNER}/offen.md`, altePunkte()], [`${ORDNER}/abgleich.txt`, `${START - 2 * ABGLEICH_TAKT_MS} B\n`]])
  const befehle: string[][] = []
  grundlageMehrsitzung(on, dateien, befehle)
  const anfragen = haiku(on)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(1)
  expect(dateien.get(`${ORDNER}/abgleich.txt`)).toBe(`${START} A\n`)
  // Jedes mv auf offen.md liegt zwischen mkdir und rmdir der Sperre.
  const art = befehle.map(b => (b[0] === 'mkdir' || b[0] === 'rmdir' ? b[0] : b[0] === 'mv' && String(b[3]).endsWith('offen.md') ? 'mv' : '')).filter(x => x !== '')
  expect(art.length).toBeGreaterThan(0)
  let gesperrt = false
  for (const a of art) {
    if (a === 'mkdir') gesperrt = true
    else if (a === 'rmdir') gesperrt = false
    else expect(gesperrt).toBe(true)
  }
  // Keine liegengebliebene .tmp.
  expect([...dateien.keys()].filter(k => k.endsWith('.tmp'))).toEqual([])
  // Der geprüfte Punkt steht mit Grabsteinfeld-freiem, lesbarem Stand in offen.md.
  expect(ablageLesen(dateien.get(`${ORDNER}/offen.md`) ?? '')?.punkte[0]?.geprueft).toBe(START)
})

test('Abgleich im Betrieb: fremde Punkte nur in /offen, geschlossene schließen sich', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({
    punkte: [punktSitzungen('a', { nr: 1, titel: 'Ausrollen' }), punktSitzungen('c', { nr: 2, titel: 'Eigenes' })],
    ueberblick: '',
  }, 1)]])
  grundlageSitzungen(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  // Sitzung B hat inzwischen a geschlossen und b angelegt.
  dateien.set(OFFEN, ablageText({
    punkte: [
      punktSitzungen('a', { nr: 1, titel: 'Ausrollen', sitzung: 'B', status: 'erledigt', ergebnis: 'in B entschieden', geaendert: SONNTAG }),
      punktSitzungen('b', { nr: 3, titel: 'Mail einrichten', sitzung: 'B' }),
      punktSitzungen('c', { nr: 2, titel: 'Eigenes', sitzung: 'A' }),
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

  const ui = await $.ui.mount(bandSitzungen('terminal') as never)
  expect(await ui.find({ type: 'Text', text: 'Eigenes' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Mail einrichten' })).toBeUndefined()
  await ui.unmount()
})

test('alte Tagesverläufe wandern beim Start in die Monatsdatei', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([
    ['/projekt/offene-punkte/antworten-2026-08-01.md', '# Antworten auf offene Punkte – 2026-08-01\n\nWas entschieden, erledigt oder verworfen wurde, mit den Gründen von damals.\n\n## 10:00 · X – entschieden\n'],
  ])
  grundlageSitzungen(on, dateien, ['antworten-2026-08-01.md', 'antworten-2026-10-10.md'].map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })))
  const befehle: string[][] = []
  on('process.run', (_, e) => {
    befehle.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  expect(dateien.get('/projekt/offene-punkte/antworten-2026-08.md')).toContain('## 2026-08-01\n\n### 10:00 · X – entschieden')
  // Der Startabgleich schreibt offen.md und offen.json ebenfalls über process.run (mv -f): hier zählen nur die rm-Aufrufe.
  expect(befehle.filter(b => b[0] === 'rm')).toEqual([['rm', '-f', '/projekt/offene-punkte/antworten-2026-08-01.md']])
})

test('Sitzung ohne geladenen Zählerstand (wie claude -p) vergibt die nächste freie Nummer, nicht #1', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({
    punkte: [punktSitzungen('alt', { nr: 1, titel: 'Alter Punkt', status: 'erledigt' }), punktSitzungen('a', { nr: 41, titel: 'Offen in A' })],
    ueberblick: '', hoechsteNr: 41,
  }, 1)]])
  grundlageSitzungen(on, dateien)
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

describe('Versionsdrift (G3)', () => {
  const INSTALLIERT = JSON.stringify({ version: 2, plugins: { 'kontext-anzeige@eigene-plugins': [{ version: '0.4.0' }], 'offene-punkte@eigene-plugins': [{ version: '9.9.9' }] } })

  test('liest die installierte Fassung; nur eine neuere lohnt den Neustart', () => {
    expect(installierteVersion(INSTALLIERT)).toBe('9.9.9')
    expect(installierteVersion('kaputt')).toBe('')
    expect(neuerAlsLaufend('9.9.9')).toBe(true)
    expect(neuerAlsLaufend(VERSION)).toBe(false)
    expect(neuerAlsLaufend('0.1.0')).toBe(false)
    expect(neuerAlsLaufend('')).toBe(false)
  })

  test('offen.json nennt die installierte Fassung nur bei Abweichung', () => {
    const leer = { punkte: [], ueberblick: '' }
    expect(JSON.parse(ablageDaten(leer, 1, '9.9.9'))).toMatchObject({ version: VERSION, installiert: '9.9.9' })
    expect(JSON.parse(ablageDaten(leer, 1, VERSION))).not.toHaveProperty('installiert')
    expect(JSON.parse(ablageDaten(leer, 1))).not.toHaveProperty('installiert')
  })

  const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

  function grundlage(on: On, dateien: Map<string, string>, toasts: string[]) {
    on('ui.status', () => ({ value: undefined }) as never)
    on('ui.log', () => ({ value: undefined }) as never)
    on('ui.toast', (_, e) => {
      toasts.push(String((e as { text?: string }).text))
      return { value: {} } as never
    })
    on('ui.open', () => ({ value: { isPlaced: false } }) as never)
    on('command.register', () => ({ value: {} }) as never)
    on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('session.root', () => ({ value: '/projekt' }) as never)
    on('session.id', () => ({ value: 'A' }) as never)
    on('env.get', (_, e) => ({ value: (e as { name?: string }).name === 'HOME' ? '/home/x' : undefined }) as never)
    on('fs.stat', (_, e) => {
      if (pfad(e.path) === '/projekt/.git') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
      throw new Error('ENOENT')
    })
    on('fs.read', (_, e) => {
      // Die eigene plugin.json, wo auch immer der Test-Host das Plugin hinlegt
      const t = dateien.get(pfad(e.path)) ?? (pfad(e.path).endsWith('/.claude-plugin/plugin.json') ? dateien.get('PLUGIN_JSON') : undefined)
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

  test('beim Start: Toast bei neuerer Installation, und offen.json trägt sie', async ($, on) => {
    const uhr = mock.clock(on, { now: 1_800_000_000_000 })
    const dateien = new Map<string, string>([['/home/x/.claude/plugins/installed_plugins.json', INSTALLIERT]])
    const toasts: string[] = []
    grundlage(on, dateien, toasts)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    expect(toasts.some(t => t.includes('9.9.9 ist installiert'))).toBe(true)
    await $.command.run({ command: 'offen', args: 'neu Probe' } as never)
    await uhr.settle()
    expect(JSON.parse(dateien.get('/projekt/offene-punkte/offen.json') ?? '{}')).toMatchObject({ installiert: '9.9.9' })
  })

  test('die laufende Fassung kommt aus der eigenen plugin.json, nicht aus der Konstante', async ($, on) => {
    const uhr = mock.clock(on, { now: 1_800_000_000_000 })
    const dateien = new Map<string, string>([
      ['/home/x/.claude/plugins/installed_plugins.json', INSTALLIERT],
      ['PLUGIN_JSON', '{ "name": "offene-punkte", "version": "9.9.9" }'],
    ])
    const toasts: string[] = []
    grundlage(on, dateien, toasts)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    // installiert 9.9.9 = laufend 9.9.9: kein Hinweis
    expect(toasts.some(t => t.includes('installiert'))).toBe(false)
    await $.command.run({ command: 'offen', args: 'neu Probe' } as never)
    await uhr.settle()
    const d = JSON.parse(dateien.get('/projekt/offene-punkte/offen.json') ?? '{}') as { version?: string; installiert?: string }
    expect(d.version).toBe('9.9.9')
    expect(d.installiert).toBeUndefined()
  })

  test('ohne Abweichung kein Toast', async ($, on) => {
    const uhr = mock.clock(on, { now: 1_800_000_000_000 })
    const dateien = new Map<string, string>([['/home/x/.claude/plugins/installed_plugins.json', INSTALLIERT.replace('9.9.9', VERSION)]])
    const toasts: string[] = []
    grundlage(on, dateien, toasts)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    expect(toasts.some(t => t.includes('installiert'))).toBe(false)
  })
})
