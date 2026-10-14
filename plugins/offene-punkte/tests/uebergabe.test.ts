import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { indexZeile, kommando, uebergabeDateien, uebergabeIndex, uebergabeName, uebergabeText } from '../hooks/logik'

type Eng = Parameters<TestBody>[0]

// Mi 14.10.2026, 21:40 Ortszeit
const T = new Date(2026, 9, 14, 21, 40).getTime()

const ARCHIV = '/projekt/offene-punkte/uebergaben'
const WARTET = `${ARCHIV}/wartet.txt`
const INHALT = '## Ziel\nÜbergabe einbauen.\n\n## Nächster Schritt\n- Tests laufen lassen\n\n## Dateien und Befehle\n`claude plugin test .`'

// ---------------------------------------------------------------- A) reine Funktionen

describe('Übergabe: Befehl und Archiv', () => {
  test('/offen übergabe, übergabe nur, übergaben, übergabe 2 – auch ohne Umlaut', () => {
    expect(kommando('übergabe')).toEqual({ art: 'uebergabe', clear: true })
    expect(kommando('Uebergabe nur')).toEqual({ art: 'uebergabe', clear: false })
    expect(kommando('übergaben')).toEqual({ art: 'uebergaben' })
    expect(kommando('übergabe 2')).toEqual({ art: 'uebergabe-zeigen', nummer: 2 })
    expect(kommando('übergabe bitte').art).toBe('fehler')
  })

  test('Namen nach Minute, in derselben Minute mit Zähler; sortiert neueste zuerst, Fremdes bleibt draußen', () => {
    expect(uebergabeName(T, [])).toBe('2026-10-14-2140.md')
    expect(uebergabeName(T, ['2026-10-14-2140.md', '2026-10-14-2140-2.md'])).toBe('2026-10-14-2140-3.md')
    expect(uebergabeDateien(['index.md', 'wartet.txt', '2026-10-13-0900.md', '2026-10-14-2140.md', '2026-10-14-2140-2.md', 'notiz.md']))
      .toEqual(['2026-10-14-2140-2.md', '2026-10-14-2140.md', '2026-10-13-0900.md'])
  })

  test('der Index nimmt Ziel und nächsten Schritt, neueste oben, dieselbe Datei nur einmal', () => {
    const eins = uebergabeIndex('', '2026-10-13-0900.md', '## Ziel\nAlt.', T - 86_400_000)
    const zwei = uebergabeIndex(eins, '2026-10-14-2140.md', INHALT, T)
    const zeilen = zwei.split('\n').filter(z => z.startsWith('- '))
    expect(zeilen.length).toBe(2)
    expect(zeilen[0]).toContain('[2026-10-14-2140.md]')
    expect(zeilen[0]).toContain('Ziel: Übergabe einbauen.')
    expect(zeilen[0]).toContain('Weiter: Tests laufen lassen')
    expect(indexZeile(zwei, '2026-10-13-0900.md')).toContain('Ziel: Alt.')
    expect(uebergabeIndex(zwei, '2026-10-14-2140.md', INHALT, T).split('\n').filter(z => z.startsWith('- ')).length).toBe(2)
    expect(uebergabeText(INHALT, T, 'abcdef123456')).toMatch(/^# Übergabe · 14\.10\.2026 21:40\n\nSitzung abcdef12 /)
  })
})

// ---------------------------------------------------------------- B) Engine

const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

type Welt = {
  dateien: Map<string, string>
  /** Was an Claude ging: je Nachricht der mitgeschickte Kontext. */
  kontexte: string[]
  /** Befehle, die der Mod selbst ausführt (/clear). */
  befehle: string[]
  forks: string[]
  toasts: string[]
}

function grundlage(on: On, opt: { fork?: unknown; verlauf?: unknown[]; clearFehlt?: boolean; schreibenKaputt?: boolean } = {}): Welt {
  const w: Welt = { dateien: new Map(), kontexte: [], befehle: [], forks: [], toasts: [] }
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', (_, e) => {
    w.toasts.push(String((e as { text?: string }).text))
    return { value: {} } as never
  })
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('session.end', () => ({ sessionId: 's1' }) as never)
  on('session.root', () => ({ value: '/projekt' }) as never)
  on('session.id', () => ({ value: 'sitzung-a' }) as never)
  on('session.messages', () => ({ value: opt.verlauf ?? [] }) as never)
  on('env.get', () => ({ value: undefined }) as never)
  on('fs.stat', (_, e) => {
    if (pfad(e.path) === '/projekt/.git') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
    throw new Error('ENOENT')
  })
  on('fs.read', (_, e) => {
    const t = w.dateien.get(pfad(e.path))
    if (t === undefined) throw new Error('ENOENT')
    return { value: t } as never
  })
  on('fs.write', (_, e) => {
    if (opt.schreibenKaputt === true && pfad(e.path).startsWith(ARCHIV)) throw new Error('EACCES')
    w.dateien.set(pfad(e.path), e.text)
    return { value: undefined } as never
  })
  on('fs.list', (_, e) => {
    const ordner = `${pfad(e.path).replace(/\/$/, '')}/`
    const namen = [...w.dateien.keys()].filter(k => k.startsWith(ordner) && !k.slice(ordner.length).includes('/'))
    if (namen.length === 0) throw new Error('ENOENT')
    return { value: namen.map(k => ({ name: k.slice(ordner.length), kind: 'file' })) } as never
  })
  on('model.fork', (_, e) => {
    w.forks.push(String((e as { prompt?: string }).prompt))
    return { value: opt.fork ?? { isAnswered: true, text: INHALT } } as never
  })
  on('command.run', { command: 'clear' }, () => {
    w.befehle.push('clear')
    if (opt.clearFehlt === true) throw new Error('unbekannt')
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    w.kontexte.push((e.context ?? []).join('\n'))
    return { text: e.text } as never
  })
  ;(on as unknown as (name: string, hook: () => unknown) => void)('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => ({ isFilled: true, text: e.text, cursor: e.text.length }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  return w
}

const befehl = async ($: Eng, args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)
const eingabe = ($: Eng, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
const start = ($: Eng) => $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)

describe('/offen übergabe', () => {
  test('schreibt die Übergabe ins Archiv, merkt sie vor, macht /clear – die neue Unterhaltung bekommt sie einmal', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on, { verlauf: [{ role: 'user', text: 'Hallo', toolUses: [] }] })
    await start($)
    await uhr.settle()
    const r = await befehl($, 'übergabe')
    await uhr.settle()
    expect(w.forks.length).toBe(1)
    expect(w.forks[0]).toContain('ÜBERGABE')
    expect(r).toContain(`${ARCHIV}/2026-10-14-2140.md`)
    expect(w.dateien.get(`${ARCHIV}/2026-10-14-2140.md`)).toContain('Übergabe einbauen.')
    expect(w.dateien.get(`${ARCHIV}/index.md`)).toContain('Ziel: Übergabe einbauen.')
    expect(w.dateien.get(WARTET)?.trim()).toBe('2026-10-14-2140.md')
    expect(w.befehle).toEqual(['clear'])

    await $.session.end({ reason: 'clear' } as never)
    await uhr.settle()
    expect(w.toasts.some(t => t.includes('Übergabe liegt bereit'))).toBe(true)
    await eingabe($, 'Weiter geht’s')
    await eingabe($, 'Und noch was')
    expect(w.kontexte[0]).toContain('Übergabe aus der vorigen Sitzung')
    expect(w.kontexte[0]).toContain('Tests laufen lassen')
    expect(w.kontexte[0]).toContain(`${ARCHIV}/index.md`)
    expect(w.kontexte[1]).not.toContain('Übergabe aus der vorigen Sitzung')
    expect(w.dateien.get(WARTET)).toBe('')
  })

  test('mit „nur“ kein /clear; die laufende Unterhaltung holt die Übergabe nicht selbst ab', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on, { verlauf: [{ role: 'user', text: 'Hallo', toolUses: [] }] })
    await start($)
    await uhr.settle()
    expect(await befehl($, 'übergabe nur')).toContain('nächste neue Unterhaltung')
    await uhr.settle()
    expect(w.befehle).toEqual([])
    await eingabe($, 'weiter')
    expect(w.kontexte[0]).not.toContain('Übergabe aus der vorigen Sitzung')
    expect(w.dateien.get(WARTET)?.trim()).toBe('2026-10-14-2140.md')
  })

  test('ein Neustart ohne Verlauf bekommt die wartende Übergabe', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on, { verlauf: [] })
    w.dateien.set(`${ARCHIV}/2026-10-14-2140.md`, uebergabeText(INHALT, T, 'alt'))
    w.dateien.set(WARTET, '2026-10-14-2140.md\n')
    await start($)
    await uhr.settle()
    await eingabe($, 'Mach weiter')
    expect(w.kontexte[0]).toContain('Übergabe aus der vorigen Sitzung')
    expect(w.dateien.get(WARTET)).toBe('')
  })

  test('scheitert der Fork oder das Schreiben, bleibt die Sitzung – kein /clear, nichts vorgemerkt', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on, { fork: { isAnswered: false, reason: 'api-error' } })
    expect(await befehl($, 'übergabe')).toContain('nicht geschrieben (api-error)')
    await uhr.settle()
    expect(w.befehle).toEqual([])
    expect(w.dateien.has(WARTET)).toBe(false)
  })

  test('kann das Archiv nicht geschrieben werden: kein /clear', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on, { schreibenKaputt: true })
    expect(await befehl($, 'übergabe')).toContain('nicht gespeichert')
    await uhr.settle()
    expect(w.befehle).toEqual([])
  })

  test('nimmt die Engine /clear nicht an, liegt es in der Eingabe', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on, { clearFehlt: true })
    await befehl($, 'übergabe')
    await uhr.settle()
    expect(w.befehle).toEqual(['clear'])
    expect(w.toasts.some(t => t.includes('/clear liegt in der Eingabe'))).toBe(true)
  })

  test('übergaben listet das Archiv, übergabe 2 zeigt die ältere', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on)
    w.dateien.set(`${ARCHIV}/2026-10-13-0900.md`, uebergabeText('## Ziel\nAlt.', T - 86_400_000, 'alt'))
    w.dateien.set(`${ARCHIV}/index.md`, uebergabeIndex('', '2026-10-13-0900.md', '## Ziel\nAlt.', T - 86_400_000))
    await befehl($, 'übergabe nur')
    await uhr.settle()
    const liste = await befehl($, 'übergaben')
    expect(liste).toContain('Übergaben (2, neueste zuerst)')
    expect(liste).toMatch(/1\. 14\.10\.2026 21:40 .*wartet auf die nächste Unterhaltung/)
    expect(liste).toContain('2. 13.10.2026 21:40')
    expect(await befehl($, 'übergabe 2')).toContain('Alt.')
    expect(await befehl($, 'übergabe 5')).toContain('Keine Übergabe 5')
  })

  test('ohne wartende Übergabe bekommt die neue Unterhaltung den Überblick, einmal', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const w = grundlage(on, { verlauf: [{ role: 'user', text: 'Bau den Knopf.', toolUses: [] }] })
    // offen.md mit Überblick, wie die letzte Sitzung sie hinterließ.
    on('model.complete', () => ({ value: { isAnswered: true, text: '- **Ziel:** Knopf bauen\n- **Gerade:** Tests' } }) as never)
    await befehl($, 'überblick')
    await uhr.settle()
    await $.session.end({ reason: 'clear' } as never)
    await uhr.settle()
    await eingabe($, 'Neue Frage')
    await eingabe($, 'Zweite')
    expect(w.kontexte[0]).toContain('Stand der letzten Sitzung')
    expect(w.kontexte[0]).toContain('**Ziel:** Knopf bauen')
    expect(w.kontexte[1]).not.toContain('Stand der letzten Sitzung')
  })
})
