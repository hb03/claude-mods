import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { VERSION, ablageDaten, installierteVersion, neuerAlsLaufend, schlussMarken } from '../hooks/logik'

describe('Marken, locker geschrieben (G4)', () => {
  test('ohne Doppelpunkt, mit „Punkt“, Nummer voran', () => {
    expect(schlussMarken('erledigt #3').map(m => m.nr)).toEqual([3])
    expect(schlussMarken('erledigt: Punkt 4').map(m => m.nr)).toEqual([4])
    expect(schlussMarken('Damit ist #5 erledigt.').map(m => m.nr)).toEqual([5])
    expect(schlussMarken('#6 überholt').map(m => [m.nr, m.ueberholt])).toEqual([[6, true]])
    expect(schlussMarken('erledigt Punkt 7 und #8 erledigt').map(m => m.nr).sort()).toEqual([7, 8])
  })

  test('Prosa und Zahlen ohne Bezug sind keine Marken; die Doppelpunkt-Form behält den Grund', () => {
    expect(schlussMarken('Punkt 3 ist erledigt')).toEqual([])
    expect(schlussMarken('erledigt 3 Dinge')).toEqual([])
    expect(schlussMarken('erledigt: #3, #5 – alles drin')).toEqual([
      { nr: 3, ueberholt: false, grund: 'alles drin' },
      { nr: 5, ueberholt: false, grund: 'alles drin' },
    ])
  })
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
