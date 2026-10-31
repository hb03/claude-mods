import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  ABGLEICH_NACH_MS, ABGLEICH_TAKT_MS, GESCHLOSSEN_HALTEN_MS, MAX_PUNKTE, REST_ALT_MS,
  abgleichFaellig, abgleichen, ablageLesen, ablageText, alteReste, befehlEntfernen, befehlSperren, befehlVerschieben, begrenzen,
  geschlossenFuehren, uebernehmen, zuGeschlossen,
} from '../hooks/logik'

const TAG = 24 * 3600_000
const JETZT = 20 * TAG

const punkt = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: JETZT - TAG, ...extra,
})

describe('Grabsteine: Geschlossenes geht nicht wieder auf', () => {
  test('aus der Liste gefallen, von einer anderen Sitzung offen zurückgeschrieben: bleibt draußen', () => {
    const geschlossen = { a: { status: 'erledigt' as const, zeit: JETZT - 1000 } }
    // Hier kennt man a nicht mehr (begrenzt), die Datei hat es offen von einer Sitzung, die es nie erfuhr.
    const l = abgleichen([punkt('b', { nr: 2 })], [punkt('a', { nr: 1, sitzung: 'B' }), punkt('b', { nr: 2 })], 2, geschlossen)
    expect(l.map(p => p.id)).toEqual(['b'])
  })

  test('hier noch offen, anderswo später geschlossen: schließt sich; danach wieder geöffnet: bleibt offen', () => {
    const geschlossen = { a: { status: 'verworfen' as const, zeit: JETZT - 1000, ergebnis: 'dort verworfen' } }
    expect(zuGeschlossen([punkt('a')], geschlossen)[0]).toMatchObject({ status: 'verworfen', ergebnis: 'dort verworfen', geaendert: JETZT - 1000 })
    expect(zuGeschlossen([punkt('a', { geaendert: JETZT })], geschlossen)[0]?.status).toBe('offen')
    // Ohne Ergebnis im Grabstein steht da, woher das Schließen kam.
    expect(zuGeschlossen([punkt('a')], { a: { status: 'erledigt', zeit: JETZT } })[0]?.ergebnis).toBe('in einer anderen Sitzung geschlossen')
  })

  test('fortschreiben: neuester gewinnt, Wiederöffnen löscht, Altes fällt weg', () => {
    const g = geschlossenFuehren(
      [punkt('a', { status: 'erledigt', geaendert: JETZT - 10, ergebnis: 'x'.repeat(500) }), punkt('b', { geaendert: JETZT - 5 }), punkt('c')],
      JETZT,
      { b: { status: 'erledigt', zeit: JETZT - 50 }, c: { status: 'erledigt', zeit: JETZT - 50 }, d: { status: 'erledigt', zeit: JETZT - GESCHLOSSEN_HALTEN_MS - 1 } },
      { a: { status: 'verworfen', zeit: JETZT - 100 } },
    )
    expect(Object.keys(g).sort()).toEqual(['a', 'c'])
    expect(g.a).toMatchObject({ status: 'erledigt', zeit: JETZT - 10 })
    expect(g.a?.ergebnis?.length).toBe(160)
  })

  test('stehen in offen.md und kommen beim Lesen zurück', () => {
    const geschlossen = { a: { status: 'erledigt' as const, zeit: JETZT - 1000 } }
    const a = ablageLesen(ablageText({ punkte: [punkt('b', { nr: 2 })], ueberblick: '', hoechsteNr: 2, geschlossen }, JETZT))
    expect(a?.geschlossen).toEqual(geschlossen)
    // Ältere Dateien ohne Grabsteine: leer.
    expect(ablageLesen(ablageText({ punkte: [], ueberblick: '' }, JETZT))?.geschlossen).toEqual({})
  })

  test('ab MAX_PUNKTE offenen bleibt nichts Erledigtes stehen (slice(-0) hielt alles)', () => {
    const offen = Array.from({ length: MAX_PUNKTE }, (_, i) => punkt(`o${i}`))
    expect(begrenzen([...offen, punkt('z', { status: 'erledigt' })]).length).toBe(MAX_PUNKTE)
    expect(begrenzen([...offen.slice(1), punkt('z', { status: 'erledigt' })]).map(p => p.id)).toContain('z')
  })

  test('geprüft gilt für alle Sitzungen', () => {
    const l = abgleichen([punkt('a', { nr: 1 })], [punkt('a', { nr: 1, geprueft: JETZT })], 1)
    expect(l[0]?.geprueft).toBe(JETZT)
  })
})

describe('Mehrere Sitzungen: wer was tut', () => {
  test('übernehmen lässt Punkte lebender Sitzungen bei ihnen', () => {
    const u = uebernehmen([punkt('a', { sitzung: 'B' }), punkt('b', { sitzung: 'C' }), punkt('c')], 'A', undefined, new Set(['B']))
    expect(u.map(p => p.sitzung)).toEqual(['B', 'A', 'A'])
  })

  test('der Abgleich ist je Takt einmal im Projekt fällig', () => {
    expect(abgleichFaellig('', JETZT)).toBe(true)
    expect(abgleichFaellig(`${JETZT - 10 * 60_000} B\n`, JETZT)).toBe(false)
    expect(abgleichFaellig(`${JETZT - ABGLEICH_TAKT_MS + 4 * 60_000} B\n`, JETZT)).toBe(true)
    // Uhr der anderen Sitzung voraus: lieber noch einmal abgleichen als nie.
    expect(abgleichFaellig(`${JETZT + 60_000} B\n`, JETZT)).toBe(true)
  })

  test('alte .tmp sind Reste, frische und andere Dateien nicht', () => {
    const e = (name: string, alter: number) => ({ name, kind: 'file', mtimeMs: JETZT - alter })
    expect(alteReste([e('offen.json.4f2a9c1b.tmp', REST_ALT_MS), e('offen.md.neu.tmp', REST_ALT_MS + 1), e('offen.md.abc.tmp', 1000), e('offen.md', TAG)], JETZT))
      .toEqual(['offen.json.4f2a9c1b.tmp', 'offen.md.neu.tmp'])
  })

  test('Befehle: Windows mit Backslashes über cmd, sonst die üblichen', () => {
    expect(befehlSperren('C:/p/offene-punkte/.sperre', true)).toEqual(['cmd', '/c', 'mkdir', 'C:\\p\\offene-punkte\\.sperre'])
    expect(befehlVerschieben('/p/a.tmp', '/p/a', false)).toEqual(['mv', '-f', '/p/a.tmp', '/p/a'])
    expect(befehlEntfernen(['C:/p/a', 'C:/p/b'], true)).toEqual(['cmd', '/c', 'del', '/q', 'C:\\p\\a', 'C:\\p\\b'])
  })
})

// ---------------------------------------------------------------- Im Betrieb

const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const ORDNER = '/projekt/offene-punkte'

function grundlage(on: On, dateien: Map<string, string>, befehle: string[][]) {
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
  punkte: [punkt('a', { nr: 1, erstellt: START - ABGLEICH_NACH_MS - 1000, sitzung: 'alt' })], ueberblick: '', hoechsteNr: 1,
}, START - 1000)

test('Abgleich: eben von einer anderen Sitzung gemacht - kein Haiku-Aufruf', async ($, on) => {
  const uhr = mock.clock(on, { now: START })
  const dateien = new Map([[`${ORDNER}/offen.md`, altePunkte()], [`${ORDNER}/abgleich.txt`, `${START - 10 * 60_000} B\n`]])
  const befehle: string[][] = []
  grundlage(on, dateien, befehle)
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
  grundlage(on, dateien, befehle)
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
