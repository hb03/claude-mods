import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import { ablageText, befehle, datum, kurzNummern, uebergabeIndex, uebergabeText } from '../hooks/logik'
import { OFFEN, befehl, gespeichert, pfad } from './helfer'
import type { Eng } from './helfer'

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

const band = {
  plugin: 'offene-punkte',
  component: 'AbovePrompt' as const,
  surface: 'terminal' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

const T = new Date(2026, 9, 14, 15, 0).getTime()

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

function grundlageFremde(on: On, dateien: Map<string, string>) {
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

function grundlageGedanken(on: On, dateien: Map<string, string>) {
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

const JETZT = 1_800_000_000_000

function grundlageMarken(on: On, toasts: string[]) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text))
    return { value: {} } as never
  })
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

const fertig = (answer: string, turnId: string) =>
  ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId }) as never

// Mi 14.10.2026, 21:40 Ortszeit
const T_UEBERGABE = new Date(2026, 9, 14, 21, 40).getTime()

const ARCHIV = '/projekt/offene-punkte/uebergaben'

const WARTET = `${ARCHIV}/wartet.txt`

const INHALT = '## Ziel\nÜbergabe einbauen.\n\n## Nächster Schritt\n- Tests laufen lassen\n\n## Dateien und Befehle\n`claude plugin test .`'

type Welt = {
  dateien: Map<string, string>
  /** Was an Claude ging: je Nachricht der mitgeschickte Kontext. */
  kontexte: string[]
  /** Befehle, die der Mod selbst ausführt (/clear). */
  befehle: string[]
  forks: string[]
  toasts: string[]
}

function grundlageUebergabe(on: On, opt: { fork?: unknown; verlauf?: unknown[]; clearFehlt?: boolean; schreibenKaputt?: boolean } = {}): Welt {
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

const eingabe = ($: Eng, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)

const start = ($: Eng) => $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)

// So 11.10.2026, 14:00 Ortszeit
const T_BETRIEB = new Date(2026, 9, 11, 14, 0).getTime()

type Umgebung = {
  /** Was in der Eingabezeile steht (prompt.read). */
  box?: { text: string }
  /** Nimmt die Eingabezeile Text von prompt.fill an? Aus: isFilled false (Dialog, headless). */
  fuellbar?: boolean
  /** Ob ein Pane gesetzt ist (ui.open). */
  pane?: { isPlaced: boolean }
}

function grundlageBetrieb(on: On, dateien: Map<string, string>, umgebung: Umgebung = {}) {
  const box = umgebung.box ?? { text: '' }
  const pane = umgebung.pane ?? { isPlaced: false }
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: pane.isPlaced } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  ;(on as unknown as (name: string, hook: () => unknown) => void)('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('prompt.fill', (_, e) => {
    if (umgebung.fuellbar === false) return { isFilled: false, text: box.text, cursor: box.text.length } as never
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    return { isFilled: true, text: box.text, cursor: box.text.length } as never
  })
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
}

const bandBetrieb = {
  plugin: 'offene-punkte', component: 'AbovePrompt' as const, surface: 'terminal' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

const fertigBetrieb = ($: Eng, answer: string) =>
  $.turn.complete({ answer, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)

/** Claudes Antwort mit ```offen-Block aus { neu: [...] }; der Block wird erst nach uhr.settle() ausgewertet. */
const blockAntwort = (input: { neu: { titel: string; art: string; frage: string; optionen: { label: string }[] }[] }) =>
  'Eingetragen.\n\n```offen\n' + input.neu.map(p =>
    `# ${p.titel} | ${p.art}\n${p.frage}\n` + p.optionen.map((o, i) => `${'abcd'[i]}) ${o.label}`).join('\n')).join('\n') + '\n```'

const call = ($: Eng, input: Parameters<typeof blockAntwort>[0]) => fertigBetrieb($, blockAntwort(input))

/** Steht eine Frage mit diesem Text über der Eingabe? */
async function frageZeigt($: Eng, muster: RegExp) {
  const ui = await $.ui.mount(bandBetrieb as never)
  const gefunden = await ui.find({ type: 'Text', text: muster })
  await ui.unmount()
  return gefunden !== undefined
}

const FREIGABE = { titel: 'Freigabe Push', art: 'entscheidung', frage: 'Darf ich pushen?', optionen: [{ label: 'Ja, pushen', antwort: 'Ja, pushen' }] }

const LOGO = { titel: 'Logo einbauen', art: 'entscheidung', frage: 'Soll das Logo rein?', optionen: [{ label: 'Ja, einbauen', antwort: 'Ja, einbauen' }] }

const ZWEI = { neu: [FREIGABE, LOGO] }

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

const punktNeu = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }, { label: 'Nein', antwort: '' }],
  status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

function grundlageNeu(on: On, dateien: Map<string, string>, box = { text: '' }) {
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

for (const [fork, erwartet] of [
  [{ isAnswered: true, text: '## Worum es ging\nStatuszeile.' }, '## Worum es ging'],
  [{ isAnswered: false, reason: 'nothing-to-fork' }, 'Noch nichts zusammenzufassen'],
  [{ isAnswered: false, reason: 'api-error' }, 'nicht möglich (api-error)'],
] as const) {
  test(`/zusammenfassung: ${fork.isAnswered ? 'Antwort' : fork.reason}`, async ($, on) => {
    grundlage(on)
    const gefragt: string[] = []
    // Genau ein Fork (die Zusammenfassung); der Überblick kommt nicht mehr als zweiter Fork.
    on('model.fork', (_, e) => {
      gefragt.push(String((e as { prompt?: string }).prompt))
      return { value: fork } as never
    })
    const r = await $.command.run({ command: 'zusammenfassung', args: '' } as never)
    expect(String((r as { text?: string }).text)).toContain(erwartet)
    expect(gefragt.length).toBe(1)
    expect(gefragt[0]).toContain('Was du noch tun musst')
  })
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

describe('/offen klären mit Punkten anderer Sitzungen', () => {
  test('nur fremde: sagt das und nennt „klären alle“; „klären alle“ übernimmt sie, die Marke schließt', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    const texte = grundlageFremde(on, dateien)
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

test('notieren, senden, Marke: der Vermerk wandert von offen über gesendet zu erledigt', async ($, on) => {
  const uhr = mock.clock(on, { now: new Date(2026, 9, 14, 9, 5).getTime() })
  const dateien = new Map<string, string>()
  grundlageGedanken(on, dateien)
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
  grundlageGedanken(on, dateien)
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
  grundlageGedanken(on, dateien)
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

test('Block → Nummer kommt mit der nächsten Nachricht (auch von einem Peer); geratene Marke wird gemeldet', async ($, on) => {
  const uhr = mock.clock(on, { now: JETZT })
  const toasts: string[] = []
  grundlageMarken(on, toasts)
  const kontexte: string[] = []
  on('prompt.submit', (_, e) => {
    kontexte.push((e.context ?? []).join('\n'))
    return { text: e.text } as never
  })

  await $.turn.complete(fertig('```offen\n# Version pushen | aufgabe\nPushst du 0.16.6?\na) Push freigeben\n```', 't1'))
  await uhr.settle()
  await $.prompt.submit({ text: 'Antwort vom Peer', origin: { kind: 'peer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).toContain('Dein Block hat angelegt: #1 „Version pushen“')

  // Geraten: #3 gibt es nicht - nichts schließt, der Nutzer sieht es, Claude erfährt es
  await $.turn.complete(fertig('Fertig.\nerledigt: #3', 't2'))
  await uhr.settle()
  expect(toasts.some(t => t.includes('#3 gibt es nicht'))).toBe(true)
  await $.prompt.submit({ text: 'weiter', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).toContain('#3 gibt es nicht')
  expect(kontexte.at(-1)).toContain('Offen sind #1 „Version pushen“')

  // Richtig: schließt und meldet nichts nach
  await $.turn.complete(fertig('Gepusht.\nerledigt: #1', 't3'))
  await uhr.settle()
  await $.prompt.submit({ text: 'danke', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).not.toContain('nichts geschlossen')
})

test('Interview-Bitte abgeschickt: der Punkt ruht in /offen, eine Änderung von Claude weckt ihn', async ($, on) => {
  const uhr = mock.clock(on, { now: JETZT })
  grundlageMarken(on, [])
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  const offen = async (args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

  await $.turn.complete(fertig('```offen\n# Upload umbauen | entscheidung\nWie soll der Upload laufen?\na) In Teilen\n```', 't1'))
  await uhr.settle()
  await $.prompt.submit({ text: 'Lass uns den offenen Punkt #1 „Upload umbauen“ im Planungsinterview durchgehen: frag mich die offenen Details einzeln ab.', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  expect(await offen('')).toContain('im Planungsinterview')

  await $.turn.complete(fertig('```offen\n# #1 Upload umbauen\nNur noch: welches Limit?\n```', 't2'))
  await uhr.settle()
  expect(await offen('')).not.toContain('im Planungsinterview')
  expect(await offen('')).toContain('welches Limit')
})

describe('/offen übergabe', () => {
  test('schreibt die Übergabe ins Archiv, merkt sie vor, macht /clear – die neue Unterhaltung bekommt sie einmal', async ($, on) => {
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on, { verlauf: [{ role: 'user', text: 'Hallo', toolUses: [] }] })
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
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on, { verlauf: [{ role: 'user', text: 'Hallo', toolUses: [] }] })
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
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on, { verlauf: [] })
    w.dateien.set(`${ARCHIV}/2026-10-14-2140.md`, uebergabeText(INHALT, T_UEBERGABE, 'alt'))
    w.dateien.set(WARTET, '2026-10-14-2140.md\n')
    await start($)
    await uhr.settle()
    await eingabe($, 'Mach weiter')
    expect(w.kontexte[0]).toContain('Übergabe aus der vorigen Sitzung')
    expect(w.dateien.get(WARTET)).toBe('')
  })

  test('scheitert der Fork oder das Schreiben, bleibt die Sitzung – kein /clear, nichts vorgemerkt', async ($, on) => {
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on, { fork: { isAnswered: false, reason: 'api-error' } })
    expect(await befehl($, 'übergabe')).toContain('nicht geschrieben (api-error)')
    await uhr.settle()
    expect(w.befehle).toEqual([])
    expect(w.dateien.has(WARTET)).toBe(false)
  })

  test('kann das Archiv nicht geschrieben werden: kein /clear', async ($, on) => {
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on, { schreibenKaputt: true })
    expect(await befehl($, 'übergabe')).toContain('nicht gespeichert')
    await uhr.settle()
    expect(w.befehle).toEqual([])
  })

  test('nimmt die Engine /clear nicht an, liegt es in der Eingabe', async ($, on) => {
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on, { clearFehlt: true })
    await befehl($, 'übergabe')
    await uhr.settle()
    expect(w.befehle).toEqual(['clear'])
    expect(w.toasts.some(t => t.includes('/clear liegt in der Eingabe'))).toBe(true)
  })

  test('übergaben listet das Archiv, übergabe 2 zeigt die ältere', async ($, on) => {
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on)
    w.dateien.set(`${ARCHIV}/2026-10-13-0900.md`, uebergabeText('## Ziel\nAlt.', T_UEBERGABE - 86_400_000, 'alt'))
    w.dateien.set(`${ARCHIV}/index.md`, uebergabeIndex('', '2026-10-13-0900.md', '## Ziel\nAlt.', T_UEBERGABE - 86_400_000))
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
    const uhr = mock.clock(on, { now: T_UEBERGABE })
    const w = grundlageUebergabe(on, { verlauf: [{ role: 'user', text: 'Bau den Knopf.', toolUses: [] }] })
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

describe('/offen alle weg|erledigt', () => {
  test('„alle weg Aufgeräumt“: alle verworfen, der Verlauf hat Kurzeinträge', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    await call($, ZWEI)
    await uhr.settle()

    expect(await befehl($, 'alle weg Aufgeräumt')).toBe('2 Punkte verworfen.')
    await uhr.settle()
    expect(await frageZeigt($, /Darf ich pushen\?|Soll das Logo rein\?/)).toBe(false)
    expect(gespeichert(dateien).map(p => p.status)).toEqual(['verworfen', 'verworfen'])

    const verlauf = String(dateien.get(`/projekt/offene-punkte/antworten-${datum(T_BETRIEB)}.md`))
    expect(verlauf).toContain('· #1 Freigabe Push – verworfen')
    expect(verlauf).toContain('· #2 Logo einbauen – verworfen')
    expect(verlauf.split('gesammelt verworfen – Aufgeräumt')).toHaveLength(3)
    expect(verlauf).not.toContain('**Möglichkeiten:**')
    expect(verlauf).not.toContain('**Abwägung:**')

    expect(await befehl($, 'alle weg')).toBe('Es ist nichts offen.')
  })

  test('„alle erledigt“: Kurzeinträge „automatisch geschlossen“, ohne Möglichkeiten', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    await call($, ZWEI)
    await uhr.settle()

    expect(await befehl($, 'alle erledigt')).toBe('2 Punkte erledigt.')
    await uhr.settle()
    const verlauf = String(dateien.get(`/projekt/offene-punkte/antworten-${datum(T_BETRIEB)}.md`))
    expect(verlauf).toContain('· #1 Freigabe Push – automatisch geschlossen')
    expect(verlauf).toContain('**Ergebnis:** gesammelt erledigt')
    expect(verlauf).not.toContain('**Möglichkeiten:**')
  })
})

test('Später → Morgen: der Punkt ruht bis Mitternacht und ist danach wieder dran', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({ punkte: [punktSitzungen('a', { nr: 1, titel: 'Ausrollen' })], ueberblick: '' }, 1)]])
  grundlageSitzungen(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'mobile', isInteractive: true } as never)
  await uhr.settle()

  const ui = await $.ui.mount(bandSitzungen('mobile') as never)
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
  const danach = await $.ui.mount(bandSitzungen('mobile') as never)
  expect(await danach.find({ type: 'Text', text: 'Ausrollen' })).toBeDefined()
  await danach.unmount()
})

test('/offen <Nr> aktuell holt einen zurückgelegten Punkt sofort zurück', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({ punkte: [
    punktSitzungen('a', { nr: 1, titel: 'Ausrollen', ruht: { bis: SONNTAG + 7 * 86_400_000 } }),
    punktSitzungen('b', { nr: 2, titel: 'Aufräumen', zurueckgestellt: 2 }),
  ], ueberblick: '' }, 1)]])
  grundlageSitzungen(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'mobile', isInteractive: true } as never)
  await uhr.settle()

  const r = await $.command.run({ command: 'offen', args: '1 aktuell' } as never)
  expect(String((r as { text?: string }).text)).toBe('„Ausrollen“: wieder aktuell.')
  await $.command.run({ command: 'offen', args: '2 aktuell' } as never)
  await uhr.settle()
  expect(dateien.get(OFFEN)).not.toContain('ruht bis')
  expect(dateien.get(OFFEN)).not.toContain('zurückgestellt')
  const ui = await $.ui.mount(bandSitzungen('mobile') as never)
  expect(await ui.find({ type: 'Text', text: 'Ausrollen' })).toBeDefined()
  await ui.unmount()
})

test('/offen neu legt einen Punkt mit der nächsten Nummer an, /offen <Nr> später morgen legt ihn zurück; Nummern kommen nie zweimal', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([
    [OFFEN, ablageText({ punkte: [punktSitzungen('a', { nr: 1, titel: 'Ausrollen' })], ueberblick: '', hoechsteNr: 4 }, 1)],
    ['/projekt/offene-punkte/antworten-2026-10-01.md', '# Antworten\n\n## 10:00 · #6 Alt – entschieden\n'],
  ])
  grundlageSitzungen(on, dateien, [{ name: 'antworten-2026-10-01.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }])
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

test('Kurzformen /erledigt und /weg schließen einen oder mehrere Punkte', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({
    punkte: [punktSitzungen('a', { nr: 1, titel: 'Eins' }), punktSitzungen('b', { nr: 2, titel: 'Zwei' }), punktSitzungen('c', { nr: 3, titel: 'Drei' })],
    ueberblick: '',
  }, 1)]])
  grundlageSitzungen(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  const lauf = async (command: string, args: string) => String(((await $.command.run({ command, args } as never)) as { text?: string }).text)
  expect(await lauf('erledigt', '1 #3')).toBe('„Eins“: erledigt.\n„Drei“: erledigt.')
  expect(await lauf('weg', '2')).toBe('„Zwei“: verworfen.')
  expect(await lauf('erledigt', 'alles')).toContain('Verwendung: /erledigt')
  expect(kurzNummern('2, 2 4')).toEqual([2, 4])
  await uhr.settle()
  expect(dateien.get(OFFEN)).not.toContain('### 1. Eins')
})

test('„erledigt: #N“ von Claude schließt sofort, /offen zeigt es mit 🤖, aktuell öffnet wieder', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  const dateien = new Map([[OFFEN, ablageText({
    punkte: [punktSitzungen('a', { nr: 1, titel: 'Seite neu laden' }), punktSitzungen('b', { nr: 2, titel: 'Freigabe' })],
    ueberblick: '',
  }, 1)]])
  grundlageSitzungen(on, dateien)
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

test('/offen: zurückgelegte Punkte stehen gedämpft für sich, ohne Auswahl, und lassen sich wieder aufnehmen', async ($, on) => {
  const jetzt = 1_800_000_000_000
  const uhr = mock.clock(on, { now: jetzt })
  const dateien = new Map<string, string>([
    ['/projekt/offene-punkte/offen.md', ablageText({
      punkte: [
        punktNeu('dran', { titel: 'Sitemap einreichen', nr: 1 }),
        punktNeu('ruht', { titel: 'Logo tauschen', nr: 2, ruht: { bis: jetzt + 3 * 86_400_000 } }),
      ],
      ueberblick: '',
    }, 1)],
  ])
  grundlageNeu(on, dateien)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()

  const text = String(((await $.command.run({ command: 'offen', args: '' } as never)) as { text?: string }).text)
  expect(text).toMatch(/1\. Sitemap einreichen[\s\S]*Zurückgelegt \(1\):\n2\. Logo tauschen – ruht bis /)
  expect(text).not.toContain('Logo tauschen (')

  const pane = await $.ui.mount({ plugin: 'offene-punkte', surface: 'terminal', component: 'Pane', requestId: 'offene-punkte', props: {} } as never)
  expect(await pane.find({ type: 'Text', text: /zurückgelegt \(1\)/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /⏸ Logo tauschen · ruht bis / })).toBeDefined()
  // Nur der laufende Punkt hat eine Auswahl.
  expect((await pane.findAll({ type: 'Select' })).length).toBe(1)
  const auf = await pane.find({ type: 'Button', text: 'Jetzt aufnehmen' })
  expect(auf).toBeDefined()
  await pane.press({ key: String((auf as { key?: string }).key) })
  await uhr.settle()
  await pane.unmount()

  const danach = String(((await $.command.run({ command: 'offen', args: '' } as never)) as { text?: string }).text)
  expect(danach).not.toContain('Zurückgelegt')
  expect(danach).toContain('2. Logo tauschen')
})
