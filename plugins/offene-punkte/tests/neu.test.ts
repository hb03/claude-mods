import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Auswertung } from '../hooks/logik'
import {
  VERALTET_NACH, ablageLesen, ausfuehrBitte, ablageText, anfrage, auswerten, ausnahmeErgaenzen, befehle, kommando, lies, offene,
  ordnerName, statuszeile, verlaufsEintraege, zusammenfuehren,
} from '../hooks/logik'
import type { Punkt } from '../types'

const punkt = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }, { label: 'Nein', antwort: '' }],
  status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})
const leer: Auswertung = { neu: [], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }

describe('Kurze Antworten', () => {
  test('mit Frage oder Bitte werden sie ausgewertet, sonst nicht', async () => {
    expect(auswerten('Fertig. Soll ich pushen?', 400)).toBe(true)
    expect(auswerten('Gebaut. Bitte prüfe die Seite im Browser.', 400)).toBe(true)
    expect(auswerten('Erledigt.', 400)).toBe(false)
    expect(auswerten('Tests grün, committet.', 400)).toBe(false)
    expect(auswerten('x'.repeat(400), 400)).toBe(true)
  })
})

describe('Warteschlange', () => {
  test('mehrere Antworten gehen in eine Anfrage, jede behält ihren Schluss', async () => {
    const t = anfrage(['a'.repeat(9000) + 'ENDE1', 'b'.repeat(9000) + 'ENDE2'], '', [])
    expect(t).toContain('ANTWORTEN DES ASSISTENTEN (2')
    expect(t).toContain('ENDE1')
    expect(t).toContain('ENDE2')
    expect(t.length).toBeLessThan(13_000)
  })
})

describe('Bekannte Punkte', () => {
  test('aktualisiert schärft nach, erwähnt setzt den Zähler zurück, sonst zählt er hoch', async () => {
    const a = lies(JSON.stringify({ neu: [], aktualisiert: [{ id: 'a', anleitung: 'neu', stufe: 'blockiert', titel: 'ignoriert' }], erwaehnt: ['b'], erledigt: [] }))
    expect(a?.aktualisiert).toEqual([{ id: 'a', anleitung: 'neu', stufe: 'blockiert' }])
    const liste = zusammenfuehren([punkt('a', { ohneBezug: 4 }), punkt('b', { ohneBezug: 4 }), punkt('c', { ohneBezug: 4 })], a as Auswertung, 2, () => 'n')
    expect(liste.map(p => [p.id, p.titel, p.anleitung, p.stufe, p.ohneBezug])).toEqual([
      ['a', 'a', 'neu', 'blockiert', 0],
      ['b', 'b', '', undefined, 0],
      ['c', 'c', '', undefined, 5],
    ])
  })

  test('Reihenfolge: blockiert vor normal vor Angebot, Veraltetes zuletzt', async () => {
    const liste = [
      punkt('angebot', { stufe: 'angebot', erstellt: 1 }),
      punkt('alt', { stufe: 'blockiert', ohneBezug: VERALTET_NACH }),
      punkt('normal', { erstellt: 2 }),
      punkt('block', { stufe: 'blockiert', erstellt: 3 }),
    ]
    expect(offene(liste).map(p => p.id)).toEqual(['block', 'normal', 'angebot', 'alt'])
    expect(statuszeile(liste, false)).toBe('■ 4 offen (2 blockiert) · /offen')
  })
})

describe('Befehle aus der Anleitung', () => {
  test('Shell-Blöcke ja, JSON nein; Kommentare und $ fallen weg; mehrzeilig mit &&', async () => {
    const anleitung = '1. Erst:\n```bash\n# vorher\n$ cd /opt/app\nmake\n```\n2. Dann:\n```json\n{"a":1}\n```\n```\nsystemctl restart app\n```\n```\nkey = wert\n```'
    expect(befehle(anleitung)).toEqual(['cd /opt/app && make', 'systemctl restart app'])
  })

  test('Ausführen bittet Claude, den Befehl auszuführen; Backticks im Befehl bleiben heil', async () => {
    expect(ausfuehrBitte('Test', 'date && pwd')).toBe('Zum offenen Punkt „Test“: Bitte führe aus: `date && pwd`')
    expect(ausfuehrBitte('Test', 'echo `date`')).toBe('Zum offenen Punkt „Test“: Bitte führe aus: `` echo `date` ``')
  })

  test('Fortsetzungszeilen werden eine Zeile', async () => {
    expect(befehle('```sh\ncurl -s \\\n  https://x.de\n```')).toEqual(['curl -s https://x.de'])
  })
})

describe('/offen mit Argumenten', () => {
  test('liest Nummer und Tun', async () => {
    expect(kommando('')).toEqual({ art: 'liste' })
    expect(kommando('leeren')).toEqual({ art: 'leeren' })
    expect(kommando('2 erledigt')).toEqual({ art: 'punkt', nummer: 2, tun: 'erledigt' })
    expect(kommando('3 weg')).toEqual({ art: 'punkt', nummer: 3, tun: 'weg' })
    expect(kommando('1 Später')).toEqual({ art: 'punkt', nummer: 1, tun: 'spaeter' })
    expect(kommando('2 b')).toEqual({ art: 'punkt', nummer: 2, tun: 'option', option: 1 })
    expect(kommando('quatsch').art).toBe('fehler')
  })
})

describe('Dateien', () => {
  test('offen.md: lesbar, und die Daten kommen unverändert zurück – auch mit --> im Text', async () => {
    const punkte = [punkt('a', { anleitung: 'pfeil --> hier', stufe: 'blockiert', abwaegung: 'schneller' }), punkt('b', { status: 'erledigt', ergebnis: 'Ja' })]
    const text = ablageText({ punkte, ueberblick: '- **Ziel:** x' }, 1_800_000_000_000)
    expect(text).toContain('### 1. a (blockiert)')
    expect(text).toContain('Abwägung: schneller')
    expect(text).toContain('✓ b: Ja')
    const zurueck = ablageLesen(text)
    expect(zurueck?.ueberblick).toBe('- **Ziel:** x')
    expect(zurueck?.punkte.map(p => [p.id, p.status, p.anleitung])).toEqual([['a', 'offen', 'pfeil --> hier'], ['b', 'erledigt', '']])
    expect(ablageLesen('# kaputt')).toBeNull()
  })

  test('Verlauf: geschlossene mit Abwägung und Ergebnis, wieder geöffnete vermerkt', async () => {
    const vorher = [punkt('a', { abwaegung: 'weil billig' }), punkt('b', { status: 'erledigt' })]
    const nachher = [{ ...vorher[0]!, status: 'erledigt' as const, ergebnis: 'Ja – „Ja.“' }, { ...vorher[1]!, status: 'offen' as const }]
    const e = verlaufsEintraege(vorher, nachher, 1_800_000_000_000)
    expect(e.length).toBe(2)
    expect(e[0]).toContain('a – entschieden')
    expect(e[0]).toContain('**Abwägung:** weil billig')
    expect(e[0]).toContain('**Ergebnis:** Ja – „Ja.“')
    expect(e[1]).toContain('b – wieder geöffnet')
  })

  test('Ausnahme nur einmal eintragen; Ordnername aus dem Pfad', async () => {
    const einmal = ausnahmeErgaenzen('# git\n*.log')
    expect(einmal).toBe('# git\n*.log\n# offene-punkte (Claude-Code-Mod)\n/offene-punkte/\n')
    expect(ausnahmeErgaenzen(einmal!)).toBeNull()
    expect(ordnerName('/home/nutzer/mein projekt')).toBe('home-nutzer-mein_projekt')
    expect(ordnerName('C:\\Users\\x\\app')).toBe('Users-x-app')
  })
})

// ---------------------------------------------------------------- Ablauf mit Dateien

const ANTWORT = 'Die Seite ist fertig. Soll ich sie ausrollen? '.repeat(12)
const HAIKU = JSON.stringify({
  neu: [{
    titel: 'Ausrollen', art: 'entscheidung', stufe: 'blockiert', frage: 'Soll ich ausrollen?', info: 'Getestet, nicht live.',
    abwaegung: 'Tests sind grün; heute ist wenig Verkehr.', optionen: [{ label: 'Ja', antwort: 'Ja, rolle aus.' }],
  }],
  erledigt: [],
})

function grundlage(on: On, dateien: Map<string, string>) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.root', () => ({ value: '/projekt' }) as never)
  on('env.get', () => ({ value: '/home/x' }) as never)
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
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

const band = (surface: 'terminal' | 'desktop' | 'mobile') => ({
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
  await $.ui.select({ plugin: 'offene-punkte', key: String((sel as { key?: string }).key), value: '0' } as never)
  await ui.unmount()

  const verlauf = [...dateien.entries()].find(([k]) => /antworten-\d{4}-\d\d-\d\d\.md$/.test(k))?.[1] ?? ''
  expect(verlauf).toContain('Ausrollen – entschieden')
  expect(verlauf).toContain('Tests sind grün')
  expect(verlauf).toContain('**Ergebnis:** Ja – „Ja, rolle aus.“')
  expect(dateien.get('/projekt/offene-punkte/offen.md')).toContain('Nichts offen.')
})

test('eigene Antwort: Textfeld unter der Auswahl, Enter schickt ab und schließt den Punkt', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlage(on, new Map())
  on('model.complete', () => ({ value: { isAnswered: true, text: HAIKU } }) as never)
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface) as never)
    const sel = await ui.find({ type: 'Select' })
    expect((sel as { props?: { options?: { label?: string }[] } }).props?.options?.some(o => o.label === 'Eigene Antwort …')).toBe(true)
    await ui.unmount()
  }

  const ui = await $.ui.mount(band('terminal') as never)
  const sel = await ui.find({ type: 'Select' })
  await $.ui.select({ plugin: 'offene-punkte', key: String((sel as { key?: string }).key), value: '__eigene' } as never)
  const feld = await ui.find({ type: 'Input' })
  expect(feld).toBeDefined()
  await $.ui.input({ plugin: 'offene-punkte', key: String((feld as { key?: string }).key), text: 'Erst morgen früh.' } as never)
  await uhr.settle()
  expect(gesendet).toEqual(['Zum offenen Punkt „Ausrollen“: Erst morgen früh.'])
  await ui.unmount()
  const danach = await $.ui.mount(band('terminal') as never)
  expect(await danach.find({ type: 'Text', text: /Ausrollen/ })).toBeUndefined()
  await danach.unmount()
})

test('auf dem Handy legt "Eigene Antwort" den Anfang in die Eingabe; abgeschickt schließt sich der Punkt', async ($, on) => {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlage(on, new Map())
  on('model.complete', () => ({ value: { isAnswered: true, text: HAIKU } }) as never)
  const gefuellt: string[] = []
  on('prompt.fill', (_, e) => {
    gefuellt.push(e.text)
    return { isFilled: true } as never
  })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()

  const ui = await $.ui.mount(band('mobile') as never)
  const knopf = await ui.find({ type: 'Button', text: 'Eigene Antwort …' })
  await ui.press({ key: String((knopf as { key?: string }).key) })
  expect(gefuellt).toEqual(['Zum offenen Punkt „Ausrollen“: '])
  await ui.unmount()

  await $.prompt.submit({ text: 'Zum offenen Punkt „Ausrollen“: Nein, erst nach dem Update.', origin: { kind: 'composer' } } as never)
  await uhr.settle()
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((r as { text?: string }).text)).toContain('Nichts offen.')
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

// ---------------------------------------------------------------- Antworten sammeln

const ZWEI = JSON.stringify({
  neu: [
    { titel: 'Variante', art: 'entscheidung', frage: 'A oder B?', optionen: [{ label: 'A', antwort: 'Nimm A.' }, { label: 'B', antwort: 'Nimm B.' }] },
    { titel: 'Ausrollen', art: 'entscheidung', frage: 'Gleich ausrollen?', optionen: [{ label: 'Ja', antwort: 'Ja, gleich.' }, { label: 'Später', antwort: '' }] },
  ],
  erledigt: [],
})

async function zweiFragen($: Parameters<TestBody>[0], on: On) {
  const uhr = mock.clock(on, { now: 1_800_000_000_000 })
  grundlage(on, new Map())
  on('model.complete', () => ({ value: { isAnswered: true, text: ZWEI } }) as never)
  const gesendet: string[] = []
  on('prompt.submit', (_, e) => {
    gesendet.push(e.text)
    return { text: e.text } as never
  })
  await $.turn.complete({ answer: ANTWORT, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await uhr.settle()
  return { uhr, gesendet }
}

test('zwei Fragen einer Runde: die erste Antwort wartet, beide gehen als eine Nachricht', async ($, on) => {
  const { uhr, gesendet } = await zweiFragen($, on)
  const r1 = await $.command.run({ command: 'offen', args: '1 b' } as never)
  expect(String((r1 as { text?: string }).text)).toContain('wartet auf die übrigen Fragen')
  expect(gesendet).toEqual([])

  const ui = await $.ui.mount(band('terminal') as never)
  expect(await ui.find({ type: 'Text', text: /1 Antwort wartet/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Jetzt senden' })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await uhr.settle()
  expect(gesendet).toEqual(['Zu den offenen Punkten:\n- „Variante“: Nimm B.\n- „Ausrollen“: Ja, gleich.'])
})

test('ohne weitere Wahl geht das Gesammelte nach 30 Sekunden los; "Schon erledigt" zählt als beantwortet', async ($, on) => {
  const { uhr, gesendet } = await zweiFragen($, on)
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await uhr.advance(29_000)
  expect(gesendet).toEqual([])
  await uhr.advance(1_000)
  expect(gesendet).toEqual(['Zum offenen Punkt „Variante“: Nimm A.'])
})

test('eine Antwort ohne Text schließt die Runde und schickt das Gesammelte sofort', async ($, on) => {
  const { uhr, gesendet } = await zweiFragen($, on)
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await $.command.run({ command: 'offen', args: '1 b' } as never)
  await uhr.settle()
  expect(gesendet).toEqual(['Zum offenen Punkt „Variante“: Nimm A.'])
})

test('schreibt der Nutzer selbst, steht das Gesammelte vor seiner Nachricht', async ($, on) => {
  const { gesendet } = await zweiFragen($, on)
  await $.command.run({ command: 'offen', args: '1 a' } as never)
  await $.prompt.submit({ text: 'Und mach danach die Tests.', origin: { kind: 'composer' } } as never)
  expect(gesendet).toEqual(['Zum offenen Punkt „Variante“: Nimm A.\n\nUnd mach danach die Tests.'])
})
