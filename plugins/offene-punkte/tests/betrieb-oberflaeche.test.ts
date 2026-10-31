import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Warnung } from '../types'
import { befehl, pfad } from './helfer'
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

const ANTWORT_AUFGABEN = 'Die Statuszeile ist fertig. Auf dem PC musst du noch den Eintrag in C:/Users/Nutzer/.claude/settings.json ändern. '.repeat(5)

// Der Block in Claudes Antwort (ohne inneren Zaun, der ihn beenden würde).
const AUFGABE = `${ANTWORT_AUFGABEN}

\`\`\`offen
# Statuszeile auf dem PC | aufgabe
Hast du den Eintrag auf dem PC geändert?
a) Erledigt
b) Erledige ich selbst
info: Ich komme nicht an den PC.
anleitung: 1. In C:/Users/Nutzer/.claude/settings.json den Eintrag ersetzen:
"statusLine": { "refreshInterval": 30 }
\`\`\`
`

const ENTSCHEIDUNG = `${ANTWORT_AUFGABEN}

\`\`\`offen
# Ausrollen | entscheidung
Ausrollen?
a) Ja
b) Nein
\`\`\`
`

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

const bandAufgaben = {
  plugin: 'offene-punkte',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

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

const fertig = ($: Eng, answer: string) =>
  $.turn.complete({ answer, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)

/** Claudes Antwort mit ```offen-Block aus { neu: [...] }; der Block wird erst nach uhr.settle() ausgewertet. */
const blockAntwort = (input: { neu: { titel: string; art: string; frage: string; optionen: { label: string }[] }[] }) =>
  'Eingetragen.\n\n```offen\n' + input.neu.map(p =>
    `# ${p.titel} | ${p.art}\n${p.frage}\n` + p.optionen.map((o, i) => `${'abcd'[i]}) ${o.label}`).join('\n')).join('\n') + '\n```'

const call = ($: Eng, input: Parameters<typeof blockAntwort>[0]) => fertig($, blockAntwort(input))

const FREIGABE = { titel: 'Freigabe Push', art: 'entscheidung', frage: 'Darf ich pushen?', optionen: [{ label: 'Ja, pushen', antwort: 'Ja, pushen' }] }

const LOGO = { titel: 'Logo einbauen', art: 'entscheidung', frage: 'Soll das Logo rein?', optionen: [{ label: 'Ja, einbauen', antwort: 'Ja, einbauen' }] }

const ZWEI = { neu: [FREIGABE, LOGO] }

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

test('auf dem Handy stehen die Antworten als Knöpfe', async ($, on) => {
  const uhr = mock.clock(on)
  oberflaeche(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: HAIKU } }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  const ui = await $.ui.mount(band('mobile') as never)
  expect(await ui.find({ type: 'Button', text: 'Ja, ausrollen' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Später' })).toBeDefined()
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  await ui.unmount()
})

test('Aufgabe aus dem Block zeigt ihre Anleitung über der Eingabe', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlage(on)
  await $.turn.complete({ answer: AUFGABE, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()

  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...bandAufgaben, surface } as never)
    expect(await ui.find({ type: 'Text', text: /◆ Zu tun/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /settings\.json/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /refreshInterval/ })).toBeDefined()
    await ui.unmount()
  }

  const offen = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((offen as { text?: string }).text)).toContain('Zu tun: Statuszeile auf dem PC')
  expect(String((offen as { text?: string }).text)).toContain('refreshInterval')
})

test('Entscheidung ohne Anleitung zeigt keinen Markdown-Block', async ($, on) => {
  const uhr = mock.clock(on)
  grundlage(on)
  await $.turn.complete({ answer: ENTSCHEIDUNG, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  const ui = await $.ui.mount({ ...bandAufgaben, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /◆ Offen/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

describe('/offen mit Pane', () => {
  test('steht das Pane, kommt nur eine Kurzzeile; sonst die volle Liste', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const pane = { isPlaced: true }
    grundlageBetrieb(on, new Map(), { pane })
    await call($, ZWEI)
    await uhr.settle()

    expect(await befehl($, '')).toBe('2 offen – alles im Pane „Offene Punkte“.')
    expect(await befehl($, '2 später morgen')).toContain('ruht bis')
    await uhr.settle()
    expect(await befehl($, '')).toBe('1 offen, 1 zurückgelegt – alles im Pane „Offene Punkte“.')

    pane.isPlaced = false
    const voll = await befehl($, '')
    expect(voll).toContain('1. Freigabe Push – Darf ich pushen?')
    expect(voll).toContain('Zurückgelegt (1):\n2. Logo einbauen')
    expect(voll).not.toContain('alles im Pane')
  })

  test('ohne Punkte: „Nichts offen“, mit Pane als Kurzzeile', async ($, on) => {
    mock.clock(on, { now: T })
    const pane = { isPlaced: true }
    grundlageBetrieb(on, new Map(), { pane })
    expect(await befehl($, '')).toBe('Nichts offen – alles im Pane „Offene Punkte“.')
    pane.isPlaced = false
    expect(await befehl($, '')).toStartWith('Nichts offen.')
  })
})

test('Warnungen von kontext-anzeige stehen über der Eingabe, mit /compact und Ausblenden', async ($, on) => {
  const uhr = mock.clock(on, { now: SONNTAG })
  grundlageSitzungen(on, new Map())
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

  const ui = await $.ui.mount(bandSitzungen('terminal') as never)
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
