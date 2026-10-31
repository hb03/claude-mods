import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { datum } from '../hooks/logik'
import type { Auswertung } from '../hooks/logik'
import { OFFEN, befehl, gespeichert, pfad } from './helfer'
import type { Eng } from './helfer'

const ANTWORT = 'Stufe 1 ist gebaut. Vor dem Freischalten brauche ich von dir: die Datenschutzerklärung und eine Freigabe zum Ausrollen. '.repeat(5)

const HAIKU = JSON.stringify({
  neu: [{
    titel: 'Freigabe zum Ausrollen',
    frage: 'Soll ich Stufe 1 ausrollen?',
    info: 'Der Zweig ist getestet, aber nicht live.',
    optionen: [
      { label: 'Ja, ausrollen', antwort: 'Ja, rolle Stufe 1 aus.' },
      { label: 'Noch warten', antwort: '' },
    ],
  }],
  erledigt: [],
})

/** Was jede Sitzung hat: Statuszeile und Protokollzeile. */
function oberflaeche(on: On) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
}

const band = (surface: 'terminal' | 'mobile') => ({
  plugin: 'offene-punkte',
  component: 'AbovePrompt' as const,
  surface,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9, contentRows: 0 },
  },
})

const JETZT = 1_800_000_000_000

function grundlage(on: On) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
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

const bandBeiclaude = {
  plugin: 'offene-punkte',
  component: 'AbovePrompt' as const,
  surface: 'terminal' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

const BLOCK = '```offen\n# Doppelung bereinigen | entscheidung | blockiert\nSoll die doppelte Aufnahme bereinigt werden?\na) Im Leitstand bereinigen\nb) Vorerst lassen\n```'

const fertig = (answer: string, turnId: string) =>
  ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId }) as never

const leer: Auswertung = { neu: [], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }

const ANTWORT_NEU = 'Die Seite ist fertig. Soll ich sie ausrollen? '.repeat(12)

const HAIKU_NEU = JSON.stringify({
  neu: [{
    titel: 'Ausrollen', art: 'entscheidung', stufe: 'blockiert', frage: 'Soll ich ausrollen?', info: 'Getestet, nicht live.',
    abwaegung: 'Tests sind grün; heute ist wenig Verkehr.', optionen: [{ label: 'Ja', antwort: 'Ja, rolle aus.' }],
  }],
  erledigt: [],
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

const bandNeu = (surface: 'terminal' | 'desktop' | 'mobile') => ({
  plugin: 'offene-punkte', component: 'AbovePrompt' as const, surface,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
})

const ZWEI = JSON.stringify({
  neu: [
    { titel: 'Variante', art: 'entscheidung', frage: 'A oder B?', optionen: [{ label: 'A', antwort: 'Nimm A.' }, { label: 'B', antwort: 'Nimm B.' }] },
    { titel: 'Ausrollen', art: 'entscheidung', frage: 'Gleich ausrollen?', optionen: [{ label: 'Ja', antwort: 'Ja, gleich.' }, { label: 'Kein Rollout', antwort: '' }] },
  ],
  erledigt: [],
})

async function zweiFragen($: Parameters<TestBody>[0], on: On) {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlageNeu(on, new Map())
  on('model.complete', () => ({ value: { isAnswered: true, text: ZWEI } }) as never)
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  return { uhr, gesendet }
}

async function vorgelegt($: Parameters<TestBody>[0], on: On) {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  const box = { text: '' }
  grundlageNeu(on, new Map(), box)
  on('prompt.edit', (_, e) => ({ text: e.text + e.inputText, cursor: e.cursor + 1 }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: ZWEI } }) as never)
  on('prompt.fill', (_, e) => {
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    return { isFilled: true } as never
  })
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  await $.command.run({ command: 'offen', args: '1 b' } as never)
  const r = await $.command.run({ command: 'offen', args: '2 a' } as never)
  await uhr.settle()
  return { uhr, box, gesendet, r: String((r as { text?: string }).text) }
}

const NACHRICHT = 'Zu den offenen Punkten:\n- #1 „Variante“: Nimm B.\n- #2 „Ausrollen“: Ja, gleich.'

// So 11.10.2026, 14:00 Ortszeit
const T = new Date(2026, 9, 11, 14, 0).getTime()

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

const eingabe = ($: Eng, text: string, kind: string) => $.prompt.submit({ text, origin: { kind } } as never)

/** Was die Eingaben des Mods an Claude schicken (prompt.submit am Boden). */
function gesendet(on: On) {
  const texte: string[] = []
  on('prompt.submit', (_, e) => {
    texte.push(e.text)
    return { text: e.text } as never
  })
  return texte
}

/** Steht eine Frage mit diesem Text über der Eingabe? */
async function frageZeigt($: Eng, muster: RegExp) {
  const ui = await $.ui.mount(bandBetrieb as never)
  const gefunden = await ui.find({ type: 'Text', text: muster })
  await ui.unmount()
  return gefunden !== undefined
}

const FREIGABE = { titel: 'Freigabe Push', art: 'entscheidung', frage: 'Darf ich pushen?', optionen: [{ label: 'Ja, pushen', antwort: 'Ja, pushen' }] }

const LOGO = { titel: 'Logo einbauen', art: 'entscheidung', frage: 'Soll das Logo rein?', optionen: [{ label: 'Ja, einbauen', antwort: 'Ja, einbauen' }] }

const EINS = { neu: [FREIGABE] }

const ZWEI_BETRIEB = { neu: [FREIGABE, LOGO] }

test('nach einer Antwort steht die offene Frage über der Eingabe, die Wahl geht an Claude', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  oberflaeche(on)
  const anfragen: string[] = []
  on('model.complete', (_, e) => {
    anfragen.push(String(e.prompt))
    return { value: { isAnswered: true, text: HAIKU, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })

  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(1)
  expect(anfragen[0]).toContain('Vor dem Freischalten')

  const ui = await $.ui.mount(band('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /Freigabe zum Ausrollen/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Soll ich Stufe 1 ausrollen\?/ })).toBeDefined()

  const sel = await ui.find({ type: 'Select' })
  expect(sel).toBeDefined()
  // Die erste Antwort steht als Knopf "a) …" neben dem Menü
  const knopfA = await ui.find({ type: 'Button', text: /^a\) / })
  expect(knopfA).toBeDefined()
  await ui.press({ key: String((knopfA as { key?: string }).key) })
  await uhr.advance(5_000)
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Freigabe zum Ausrollen“: Ja, rolle Stufe 1 aus.'])
  await ui.unmount()

  // Beantwortet: die Zeile ist wieder leer.
  const leer = await $.ui.mount(band('terminal') as never)
  expect(await leer.find({ type: 'Text', text: /Freigabe zum Ausrollen/ })).toBeUndefined()
  await leer.unmount()
})

test('Wahl → bei Claude → Claude öffnet mit „# #1“ wieder; /offen 1 sagt bei Geschlossenem, was ist', async ($, on) => {
  const uhr = mock.clock(on, { now: JETZT })
  grundlage(on)
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  const offen = async (args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

  await $.turn.complete(fertig(`Bitte klären.\n${BLOCK}`, 't1'))
  await uhr.settle()
  const ui = await $.ui.mount(bandBeiclaude as never)
  const knopfA = await ui.find({ type: 'Button', text: /^a\) / })
  await ui.press({ key: String((knopfA as { key?: string }).key) })
  await uhr.advance(5_000)
  await ui.unmount()
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Doppelung bereinigen“ (Soll die doppelte Aufnahme bereinigt werden?): Im Leitstand bereinigen'])

  // Geschlossen: /offen 1 b sagt, was mit #1 ist, statt „gibt es nicht“
  expect(await offen('1 b')).toContain('#1 „Doppelung bereinigen“ ist schon erledigt')

  // Claudes Turn mit der Antwort: der Punkt ist noch nicht fertig, er öffnet ihn wieder
  await $.turn.start({ text: gesendet[0]!, turnId: 't2' } as never)
  await $.turn.complete(fertig('Im Ordner liegen noch beide Videos.\n```offen\n# #1 Doppelung bereinigen | aufgabe | blockiert\nIm Leitstand erneut über „Doppelte klären“ bereinigen?\na) Erledigt: im Leitstand bereinigt\n```', 't2'))
  await uhr.settle()
  const liste = await offen('')
  expect(liste).toContain('1. Zu tun: Doppelung bereinigen')
  expect(liste).toContain('erneut über „Doppelte klären“')
})

test('ohne Marke und ohne Änderung bleibt die Antwort beantwortet; eine Änderung an Verworfenem erfährt Claude', async ($, on) => {
  const uhr = mock.clock(on, { now: JETZT })
  grundlage(on)
  const kontexte: string[] = []
  on('prompt.submit', (_, e) => {
    kontexte.push((e.context ?? []).join('\n'))
    return { text: e.text } as never
  })
  const offen = async (args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

  await $.turn.complete(fertig(BLOCK, 't1'))
  await uhr.settle()
  expect(await offen('1 b')).toContain('Vorerst lassen')
  await uhr.advance(5_000)
  await $.turn.start({ text: 'Zum offenen Punkt #1 „Doppelung bereinigen“: Vorerst lassen', turnId: 't2' } as never)
  await $.turn.complete(fertig('Gut, ich lasse es.', 't2'))
  await uhr.settle()
  expect(await offen('')).toContain('Nichts offen')

  // Ein zweiter Punkt, den der Nutzer verwirft; Claude ändert ihn trotzdem
  await $.turn.complete(fertig('```offen\n# Zweiter Punkt | entscheidung\nNoch etwas?\na) Ja\n```', 't3'))
  await uhr.settle()
  expect(await offen('2 weg')).toContain('verworfen')
  await $.turn.complete(fertig('```offen\n# #2 Zweiter Punkt\nDoch noch etwas?\n```', 't4'))
  await uhr.settle()
  expect(await offen('')).toContain('Nichts offen')
  await $.prompt.submit({ text: 'weiter', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  expect(kontexte.at(-1)).toContain('#2 „Zweiter Punkt“ ist vom Nutzer verworfen')
})

test('eigene Antwort: Textfeld unter der Auswahl, Enter schickt ab und schließt den Punkt', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlageNeu(on, new Map())
  on('model.complete', () => ({ value: { isAnswered: true, text: HAIKU_NEU } }) as never)
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(bandNeu(surface) as never)
    const sel = await ui.find({ type: 'Select' })
    expect((sel as { props?: { options?: { label?: string }[] } }).props?.options?.some(o => o.label === 'Eigene Antwort …')).toBe(true)
    await ui.unmount()
  }

  const ui = await $.ui.mount(bandNeu('terminal') as never)
  const sel = await ui.find({ type: 'Select' })
  await $.ui.select({ plugin: 'offene-punkte', key: String((sel as { key?: string }).key), value: '__eigene' } as never)
  const feld = await ui.find({ type: 'Input' })
  expect(feld).toBeDefined()
  await $.ui.input({ plugin: 'offene-punkte', key: String((feld as { key?: string }).key), text: 'Erst morgen früh.' } as never)
  await uhr.advance(5_000)
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Ausrollen“: Erst morgen früh.'])
  await ui.unmount()
  const danach = await $.ui.mount(bandNeu('terminal') as never)
  expect(await danach.find({ type: 'Text', text: /Ausrollen/ })).toBeUndefined()
  await danach.unmount()
})

test('auf dem Handy legt "Eigene Antwort" den Anfang in die Eingabe; abgeschickt schließt sich der Punkt', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlageNeu(on, new Map())
  on('model.complete', () => ({ value: { isAnswered: true, text: HAIKU_NEU } }) as never)
  const gefuellt: string[] = []
  on('prompt.fill', (_, e) => {
    gefuellt.push(e.text)
    return { isFilled: true } as never
  })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()

  const ui = await $.ui.mount(bandNeu('mobile') as never)
  const knopf = await ui.find({ type: 'Button', text: 'Eigene Antwort …' })
  await ui.press({ key: String((knopf as { key?: string }).key) })
  expect(gefuellt).toEqual(['Zum offenen Punkt #1 „Ausrollen“: '])
  await ui.unmount()

  await $.prompt.submit({ text: 'Zum offenen Punkt „Ausrollen“: Nein, erst nach dem Update.', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((r as { text?: string }).text)).toContain('Nichts offen.')
})

test('zwei Fragen einer Runde: die erste Antwort wartet, beide gehen als eine Nachricht', async ($, on) => {
  const { uhr, gesendet } = await zweiFragen($, on)
  const r1 = await $.command.run({ command: 'offen', args: '1 b' } as never)
  expect(String((r1 as { text?: string }).text)).toContain('wartet auf die übrigen Fragen')
  expect(gesendet).toEqual([])

  const ui = await $.ui.mount(bandNeu('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /1 Antwort wartet/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Jetzt senden' })).toBeDefined()
  await ui.unmount()

  // Die Nummern bleiben: "Ausrollen" ist weiter Nummer 2; Nummer 1 ist schon beantwortet.
  const r2 = await $.command.run({ command: 'offen', args: '1 a' } as never)
  expect(String((r2 as { text?: string }).text)).toContain('schon beantwortet')
  const r3 = await $.command.run({ command: 'offen', args: '2 a' } as never)
  expect(String((r3 as { text?: string }).text)).toContain('alle Fragen beantwortet, geht in 5 s an Claude')
  await uhr.advance(4_000)
  expect(gesendet).toEqual([])
  await uhr.advance(1_000)
  expect(gesendet).toEqual(['Zu den offenen Punkten:\n- #1 „Variante“: Nimm B.\n- #2 „Ausrollen“: Ja, gleich.'])
})

test('ohne weitere Wahl geht das Gesammelte nach 30 Sekunden los; "Schon erledigt" zählt als beantwortet', async ($, on) => {
  const { uhr, gesendet } = await zweiFragen($, on)
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await uhr.advance(29_000)
  expect(gesendet).toEqual([])
  await uhr.advance(1_000)
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Variante“: Nimm A.'])
})

test('eine Antwort ohne Text schließt die Runde; das Gesammelte geht nach 5 s', async ($, on) => {
  const { uhr, gesendet } = await zweiFragen($, on)
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await $.command.run({ command: 'offen', args: '2 b' } as never)
  await uhr.advance(5_000)
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Variante“: Nimm A.'])
})

test('schreibt der Nutzer selbst, steht das Gesammelte vor seiner Nachricht', async ($, on) => {
  const { gesendet } = await zweiFragen($, on)
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await $.prompt.submit({ text: 'Und mach danach die Tests.', origin: { kind: 'composer' } } as never)
  expect(gesendet).toEqual(['Zum offenen Punkt #1 „Variante“: Nimm A.\n\nUnd mach danach die Tests.'])
})

test('nach /clear wird, was noch nicht bei Claude war, wieder gefragt', async ($, on) => {
  on('session.end', () => ({ sessionId: 's1' }) as never)
  const { uhr, gesendet } = await zweiFragen($, on)
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await $.session.end({ reason: 'clear' } as never)
  await uhr.settle()
  await uhr.advance(30_000)
  expect(gesendet).toEqual([])
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((r as { text?: string }).text)).toContain('1. Variante')
})

test('Fragen aus zwei Auswertungen gehen zusammen; Haiku erfährt danach, was beantwortet wurde', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlageNeu(on, new Map())
  const frage = (titel: string, antwort: string) =>
    JSON.stringify({ neu: [{ titel, art: 'entscheidung', frage: `${titel}?`, optionen: [{ label: 'Ja', antwort }] }], erledigt: [] })
  const antworten = [frage('Erste', 'Ja, die erste.'), frage('Zweite', 'Ja, die zweite.'), JSON.stringify({ neu: [], erledigt: [] })]
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(String((e as { prompt?: unknown }).prompt))
    return { value: { isAnswered: true, text: antworten.shift() } } as never
  })
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  for (const turnId of ['t1', 't2']) {
    await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId } as never)
    await uhr.settle()
  }
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await uhr.settle()
  expect(gesendet).toEqual([])
  await $.command.run({ command: 'offen', args: '2 a' } as never)
  await uhr.advance(5_000)
  const nachricht = 'Zu den offenen Punkten:\n- #1 „Erste“: Ja, die erste.\n- #2 „Zweite“: Ja, die zweite.'
  expect(gesendet).toEqual([nachricht])

  await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't3' } as never)
  await uhr.settle()
  expect(prompts[2]).toContain('„Zweite“: Ja, die zweite.')
})

test('Ergänzen: Gesammeltes und spätere Antworten kommen in die Eingabe; Herausgenommenes wird wieder gefragt', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  const box = { text: 'Übrigens: ' }
  grundlageNeu(on, new Map(), box)
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify({
        neu: [
          { titel: 'Variante', art: 'entscheidung', frage: 'A oder B?', optionen: [{ label: 'A', antwort: 'Nimm A.' }] },
          { titel: 'Grund', art: 'entscheidung', frage: 'Warum?', optionen: [{ label: 'Erklären', antwort: 'Weil:' }] },
          { titel: 'Ausrollen', art: 'entscheidung', frage: 'Ausrollen?', optionen: [{ label: 'Ja', antwort: 'Ja, gleich.' }] },
        ],
        erledigt: [],
      }),
    },
  }) as never)
  on('prompt.fill', (_, e) => {
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    return { isFilled: true } as never
  })
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()

  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await $.command.run({ command: 'offen', args: '2 a' } as never)
  await $.command.run({ command: 'offen', args: '3 a' } as never)
  await uhr.advance(60_000)
  expect(gesendet).toEqual([])
  // Angefangener Text bleibt stehen, die Antworten kommen darunter.
  expect(box.text).toBe('Übrigens: \nZu den offenen Punkten:\n- #1 „Variante“: Nimm A.\n- #2 „Grund“: Weil: \nZum offenen Punkt #3 „Ausrollen“: Ja, gleich. ')

  // Der Nutzer ergänzt den Grund und nimmt das Ausrollen wieder heraus.
  await $.prompt.submit({ text: 'Zu den offenen Punkten:\n- „Variante“: Nimm A.\n- „Grund“: Weil: billiger.', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  const liste = String((r as { text?: string }).text)
  expect(liste).toContain('3. Ausrollen')
  expect(liste).not.toContain('Variante')
  const pane = await $.ui.mount({ plugin: 'offene-punkte', surface: 'terminal', component: 'Pane', requestId: 'offene-punkte', props: {} } as never)
  expect(await pane.find({ type: 'Text', text: /Grund: Erklären – „Weil: billiger.“/ })).toBeDefined()
  await pane.unmount()
})

test('alle beantwortet: die Antworten stehen in der Eingabe, das Band zählt 5 s herunter, dann gehen sie ab', async ($, on) => {
  const { uhr, box, gesendet, r } = await vorgelegt($, on)
  expect(r).toContain('Enter schickt sofort')
  expect(box.text).toBe(NACHRICHT)
  expect(gesendet).toEqual([])

  const ui = await $.ui.mount(bandNeu('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /Alle Fragen beantwortet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /in 5 s an Claude/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Jetzt senden' })).toBeDefined()
  await ui.unmount()

  await uhr.advance(2_000)
  const spaeter = await $.ui.mount(bandNeu('terminal') as never)
  expect(await spaeter.find({ type: 'Text', text: /in 3 s an Claude/ })).toBeDefined()
  await spaeter.unmount()

  await uhr.advance(3_000)
  expect(gesendet).toEqual([NACHRICHT])
  expect(box.text).toBe('')
  const liste = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((liste as { text?: string }).text)).toContain('Nichts offen.')
  const leer = await $.ui.mount(bandNeu('terminal') as never)
  expect(await leer.find({ type: 'Text', text: /Alle Fragen beantwortet/ })).toBeUndefined()
  await leer.unmount()
})

test('Enter schickt die vorgelegten Antworten sofort – und nach 5 s nicht noch einmal', async ($, on) => {
  const { uhr, box, gesendet } = await vorgelegt($, on)
  await $.prompt.submit({ text: box.text, origin: { kind: 'composer' } } as never)
  box.text = ''
  await uhr.advance(10_000)
  expect(gesendet).toEqual([NACHRICHT])
  const liste = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((liste as { text?: string }).text)).toContain('Nichts offen.')
})

test('Tippen in der Eingabe hält den Countdown an; geändert geht nichts von selbst', async ($, on) => {
  const { uhr, box, gesendet } = await vorgelegt($, on)
  await $.prompt.edit({ origin: { kind: 'composer' }, text: box.text, cursor: box.text.length, start: box.text.length, end: box.text.length, inputText: '!' } as never)
  // Die Eingabe bleibt hier unverändert: angehalten hat allein das Tippen.
  await uhr.advance(10_000)
  expect(gesendet).toEqual([])
  const ui = await $.ui.mount(bandNeu('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /Alle Fragen beantwortet/ })).toBeUndefined()
  await ui.unmount()
})

test('ist die Eingabe belegt, bleibt sie unberührt; die Antworten gehen nach 5 s als eigene Nachricht', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  const box = { text: 'Halb getippt' }
  grundlageNeu(on, new Map(), box)
  on('model.complete', () => ({ value: { isAnswered: true, text: ZWEI } }) as never)
  on('prompt.fill', (_, e) => {
    box.text = e.text
    return { isFilled: true } as never
  })
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.turn.complete({ answer: ANTWORT_NEU, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  await $.command.run({ command: 'offen', args: '1 b' } as never)
  await $.command.run({ command: 'offen', args: '2 a' } as never)
  await uhr.advance(4_000)
  expect(gesendet).toEqual([])
  await uhr.advance(1_000)
  expect(gesendet).toEqual([NACHRICHT])
  expect(box.text).toBe('Halb getippt')
})

describe('/offen <Nr> antwort <Text>', () => {
  const ANTWORT = 'Erst morgen, dann ja'

  // Die Antwort ist die letzte offene Frage, also läuft alleBeantwortet: Ist die Eingabezeile leer und lässt sich füllen
  // (der Normalfall im Terminal), legt es die Antwort dort ab (ausstehend.wo = „eingabe“) und zählt 5 s herunter. Danach ruft
  // offenKommando senden() auf – das sieht nur „sammlung“ und hält zudem den Countdown an: die Nachricht bleibt in der
  // Eingabe liegen, obwohl der Befehl „geht an Claude“ meldet. Nur in den ersten beiden Fällen geht sie sofort hinaus.
  for (const [fall, umgebung] of [
    ['Eingabezeile belegt', { box: { text: 'halb getippt' } }],
    ['Eingabezeile nicht beschreibbar', { fuellbar: false }],
    ['Eingabezeile leer und beschreibbar', {}],
  ] as const) {
    test(`geht sofort an Claude und schließt den Punkt (${fall})`, async ($, on) => {
      const uhr = mock.clock(on, { now: T })
      const dateien = new Map<string, string>()
      grundlageBetrieb(on, dateien, umgebung)
      const texte = gesendet(on)
      await call($, EINS)
      await uhr.settle()

      const r = await befehl($, `1 antwort ${ANTWORT}`)
      await uhr.settle()
      expect(r).toContain('geht an Claude')
      expect(texte).toEqual([`Zum offenen Punkt #1 „${FREIGABE.titel}“: ${ANTWORT}`])

      expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(false)
      expect(await befehl($, '')).toBe(`Nichts offen.\n\nDatei: /projekt/offene-punkte/offen.md · Verlauf: antworten-JJJJ-MM-TT.md`)
      expect(gespeichert(dateien)[0]).toMatchObject({ status: 'erledigt', ergebnis: `eigene Antwort – „${ANTWORT}“` })
      expect(String(dateien.get(OFFEN))).toContain(`- ✓ ${FREIGABE.titel}: eigene Antwort – „${ANTWORT}“`)
      expect(String(dateien.get(`/projekt/offene-punkte/antworten-${datum(T)}.md`))).toContain(`**Ergebnis:** eigene Antwort – „${ANTWORT}“`)
    })
  }

  test('ohne Text oder für einen unbekannten Punkt wird nichts gesendet', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    grundlageBetrieb(on, new Map(), { fuellbar: false })
    const texte = gesendet(on)
    await call($, EINS)
    await uhr.settle()
    expect(await befehl($, '1 antwort')).toContain('Verwendung')
    expect(await befehl($, '7 antwort Hallo')).toBe('Punkt 7 gibt es nicht – /offen zeigt die Nummern.')
    await uhr.settle()
    expect(texte).toEqual([])
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(true)
  })
})

describe('Getippte Antworten', () => {
  test('„Zum offenen Punkt „Titel“: Text“ schließt den Punkt mit der Nachricht', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    const texte = gesendet(on)
    await call($, EINS)
    await uhr.settle()
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(true)

    await eingabe($, `Zum offenen Punkt „${FREIGABE.titel}“: Nimm Variante B`, 'composer')
    await uhr.settle()
    expect(texte).toEqual([`Zum offenen Punkt „${FREIGABE.titel}“: Nimm Variante B`])
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(false)
    expect(gespeichert(dateien)[0]).toMatchObject({ status: 'erledigt', ergebnis: 'eigene Antwort – „Nimm Variante B“' })
    expect(String(dateien.get(OFFEN))).toContain('eigene Antwort – „Nimm Variante B“')
  })

  test('mehrere Antworten in einer Nachricht („Zu den offenen Punkten:“) und mit Nummer', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    gesendet(on)
    await call($, ZWEI_BETRIEB)
    await uhr.settle()

    await eingabe($, `Zu den offenen Punkten:\n- „${FREIGABE.titel}“: Ja\n- #2 „Irgendwie anders“: Nein`, 'bridge')
    await uhr.settle()
    const p = gespeichert(dateien)
    expect(p.map(x => x.status)).toEqual(['erledigt', 'erledigt'])
    expect(p.map(x => x.ergebnis)).toEqual(['eigene Antwort – „Ja“', 'eigene Antwort – „Nein“'])
  })

  test('kommt die Nachricht nicht bei Claude an (drop), bleibt der Punkt offen', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    on('prompt.submit', () => ({ drop: 'abgelehnt' }) as never)
    await call($, EINS)
    await uhr.settle()

    await eingabe($, `Zum offenen Punkt „${FREIGABE.titel}“: Nimm Variante B`, 'composer')
    await uhr.settle()
    expect(gespeichert(dateien)[0]?.status).toBe('offen')
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(true)
  })
})
