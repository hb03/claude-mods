import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Punkt } from '../types'
import { ablageLesen, ablageText, fragbar, fremd, kommando, nichtsFragbar, uebernehmen, zusammenfuehren } from '../hooks/logik'

// 0.16.9: Punkte ohne Sitzung (vor dem /clear angelegt, im Abgleich „unbekannt“) galten nach dem /clear
// als fremd - /offen zeigte drei, /offen klären meldete „Es ist nichts offen.“ (android-bot, 14.10.2026).

const T = new Date(2026, 9, 14, 15, 0).getTime()
const OFFEN = '/projekt/offene-punkte/offen.md'

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

describe('Punkte ohne Sitzung', () => {
  test('„unbekannt“, leer oder ohne Sitzung ist nicht fremd; eine echte andere Sitzung schon', () => {
    for (const sitzung of [undefined, '', 'unbekannt']) expect(fremd(punkt(1, 'x', { sitzung }), 'A')).toBe(false)
    expect(fremd(punkt(1, 'x', { sitzung: 'B' }), 'A')).toBe(true)
    expect(fragbar([punkt(1, 'x', { sitzung: 'unbekannt' })], { sitzung: 'A', jetzt: T })).toHaveLength(1)
  })

  test('nach /clear gehen auch Punkte ohne Sitzung mit; die einer anderen Sitzung bleiben', () => {
    const l = uebernehmen([punkt(1, 'a', { sitzung: 'alt' }), punkt(2, 'b', { sitzung: 'unbekannt' }), punkt(3, 'c'), punkt(4, 'd', { sitzung: 'B' })], 'neu', 'alt')
    expect(l.map(p => p.sitzung)).toEqual(['neu', 'neu', 'neu', 'B'])
  })

  test('neue Punkte tragen die Sitzung, die sie anlegt', () => {
    let n = 0
    const neu = { titel: 'Neu', frage: 'Neu?', info: '', art: 'entscheidung' as const, anleitung: '', optionen: [] }
    const l = zusammenfuehren([], { neu: [neu], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }, T, () => `n${++n}`, 0, 'A')
    expect(l[0]?.sitzung).toBe('A')
    expect(zusammenfuehren([], { neu: [neu], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }, T, () => 'x')[0]?.sitzung).toBeUndefined()
  })
})

describe('nichtsFragbar', () => {
  const s = { sitzung: 'A', jetzt: T }
  test('nichts da: „Es ist nichts offen.“', () => {
    expect(nichtsFragbar([], s)).toBe('Es ist nichts offen.')
    expect(nichtsFragbar([punkt(1, 'x', { status: 'erledigt' })], s)).toBe('Es ist nichts offen.')
  })
  test('nennt fremde und zurückgelegte Punkte statt „nichts offen“', () => {
    const l = [punkt(1, 'a', { sitzung: 'B' }), punkt(2, 'b', { sitzung: 'C' }), punkt(3, 'c', { ruht: { bis: T + 1 } })]
    expect(nichtsFragbar(l, s, ', /offen klären alle übernimmt und klärt sie'))
      .toBe('In dieser Sitzung ist nichts offen – 2 Punkte gehören anderen Sitzungen, 1 Punkt ist zurückgelegt. /offen zeigt sie, /offen klären alle übernimmt und klärt sie.')
    expect(nichtsFragbar([punkt(1, 'a', { sitzung: 'B' })], s)).toBe('In dieser Sitzung ist nichts offen – 1 Punkt gehört einer anderen Sitzung. /offen zeigt sie.')
  })
})

describe('kommando: klären alle', () => {
  test('„klären alle“, „alle klären“, „klaeren alle“', () => {
    for (const a of ['klären alle', 'alle klären', 'klaeren alle', ' Alle Klären ']) expect(kommando(a)).toEqual({ art: 'klaeren', alle: true })
    expect(kommando('klären')).toEqual({ art: 'klaeren', alle: false })
  })
})

// ---------------------------------------------------------------- im Ablauf

const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function grundlage(on: On, dateien: Map<string, string>) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('command.register', () => ({ value: {} }) as never)
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
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  const texte: string[] = []
  on('prompt.submit', (_, e) => {
    texte.push(e.text)
    return { text: e.text } as never
  })
  return texte
}

const befehl = async ($: Parameters<TestBody>[0], args: string) =>
  String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

const gespeichert = (dateien: Map<string, string>) => ablageLesen(String(dateien.get(OFFEN)))?.punkte ?? []

describe('/offen klären mit Punkten anderer Sitzungen', () => {
  test('nur fremde: sagt das und nennt „klären alle“; „klären alle“ übernimmt sie, die Marke schließt', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    const texte = grundlage(on, dateien)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    // Eine andere Sitzung schreibt ihre Punkte; der nächste Abgleich holt sie her (Sitzung bleibt B).
    dateien.set(OFFEN, ablageText({ punkte: [punkt(5, 'Fremder Punkt', { sitzung: 'B' })], ueberblick: '', hoechsteNr: 5 }, T))
    expect(await befehl($, 'neu Eigener Punkt')).toContain('Eigener Punkt')
    await uhr.settle()
    expect(gespeichert(dateien).find(p => p.nr === 5)?.sitzung).toBe('B')

    // Eigene Punkte da: geklärt werden sie, der fremde wird genannt.
    expect(await befehl($, 'klären')).toBe('Klärung von 1 Punkt geht an Claude (1 weitere aus anderen Sitzungen oder zurückgelegt: /offen klären alle).')
    await uhr.settle()
    expect(texte).toHaveLength(1)
    expect(texte[0]).not.toContain('Fremder Punkt')
    await $.turn.complete({ answer: 'Noch offen.', reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't0' } as never)
    await uhr.settle()

    // Nur noch der fremde: statt „Es ist nichts offen.“
    expect(await befehl($, 'alle erledigt')).toBe('1 Punkt erledigt.')
    await uhr.settle()
    expect(await befehl($, 'alle weg')).toBe('In dieser Sitzung ist nichts offen – 1 Punkt gehört einer anderen Sitzung. /offen zeigt sie, /offen <Nr> erledigt|weg schließt einzelne.')
    expect(await befehl($, 'klären')).toBe('In dieser Sitzung ist nichts offen – 1 Punkt gehört einer anderen Sitzung. /offen zeigt sie, /offen klären alle übernimmt und klärt sie.')
    await uhr.settle()
    expect(texte).toHaveLength(1)

    expect(await befehl($, 'klären alle')).toBe('Klärung von 1 Punkt geht an Claude (1 aus anderen Sitzungen hierher übernommen).')
    await uhr.settle()
    expect(texte).toHaveLength(2)
    expect(texte[1]).toStartWith('Automatische Klärung')
    expect(texte[1]).toContain('#5 Fremder Punkt')
    expect(gespeichert(dateien).find(p => p.nr === 5)?.sitzung).toBe('A')

    await $.turn.complete({ answer: 'Geprüft.\nerledigt: #5 – längst umgesetzt', reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
    await uhr.settle()
    expect(gespeichert(dateien).find(p => p.nr === 5)?.status).toBe('erledigt')
  })
})
