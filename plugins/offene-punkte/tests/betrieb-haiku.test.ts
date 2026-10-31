import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import { VERSION, ablageText, altern, nachfassen } from '../hooks/logik'
import { KOSTEN, OFFEN, befehl, gespeichert, pfad } from './helfer'
import type { Eng } from './helfer'

const ANTWORT = 'Stufe 1 ist gebaut. Vor dem Freischalten brauche ich von dir: die Datenschutzerklärung und eine Freigabe zum Ausrollen. '.repeat(5)

/** Was jede Sitzung hat: Statuszeile und Protokollzeile. */
function oberflaeche(on: On) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
}

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

/** Der Verlauf, wie $.session.messages() ihn liefert, und Haiku, das daraus den Überblick schreibt. */
function verlaufUndHaiku(on: On, ueberblick: string) {
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'Bau den Knopf.', toolUses: [] },
    { role: 'assistant', text: 'Der Knopf ist gebaut, die Tests laufen.', toolUses: [] },
  ] }) as never)
  const anfragen: string[] = []
  on('model.complete', (_, e) => {
    anfragen.push(String((e as { prompt?: string }).prompt))
    return { value: { isAnswered: true, text: ueberblick } } as never
  })
  return anfragen
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

const T = Date.UTC(2026, 9, 31, 12, 0)

function grundlageKosten(on: On, dateien: Map<string, string>) {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: {} }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('session.root', () => ({ value: '/projekt' }) as never)
  on('session.id', () => ({ value: 'A' }) as never)
  on('env.get', () => ({ value: undefined }) as never)
  on('fs.exists', (_, e) => ({ value: dateien.has(pfad(e.path)) }) as never)
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
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"ergebnisse":[]}' } }) as never)
}

// So 11.10.2026, 14:00 Ortszeit
const T_BETRIEB = new Date(2026, 9, 11, 14, 0).getTime()

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

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

const eingabe = ($: Eng, text: string, kind: string) => $.prompt.submit({ text, origin: { kind } } as never)

/** Zählt die Haiku-Aufrufe (model.complete); mit usage im Ergebnis, wenn gegeben. */
function haiku(on: On, usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) {
  const anfragen: string[] = []
  on('model.complete', (_, e) => {
    anfragen.push(String(e.prompt))
    return { value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}', ...(usage !== undefined ? { usage } : {}) } } as never
  })
  return anfragen
}

/** Was die Eingaben des Mods an Claude schicken (prompt.submit am Boden). */
function gesendet(on: On) {
  const texte: string[] = []
  on('prompt.submit', (_, e) => {
    texte.push(e.text)
    return { text: e.text } as never
  })
  return texte
}

const FREIGABE = { titel: 'Freigabe Push', art: 'entscheidung', frage: 'Darf ich pushen?', optionen: [{ label: 'Ja, pushen', antwort: 'Ja, pushen' }] }

const LOGO = { titel: 'Logo einbauen', art: 'entscheidung', frage: 'Soll das Logo rein?', optionen: [{ label: 'Ja, einbauen', antwort: 'Ja, einbauen' }] }

const ZWEI = { neu: [FREIGABE, LOGO] }

test('kurze Antworten und abgebrochene Turns werden nicht ausgewertet', async ($, on) => {
  const uhr = mock.clock(on)
  oberflaeche(on)
  let aufrufe = 0
  on('model.complete', () => {
    aufrufe++
    return { value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}' } } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'Erledigt.', reason: 'answer', durationMs: 10, isAborted: false, turnId: 't1' } as never)
  await $.turn.complete({ answer: ANTWORT, reason: 'aborted', durationMs: 10, isAborted: true, turnId: 't2' } as never)
  await uhr.settle()
  expect(aufrufe).toBe(0)
})

test('/zusammenfassung schreibt den Überblick neu – aus dem Verlauf per Haiku, ein alter Stand bleibt nicht stehen', async ($, on) => {
  grundlage(on)
  const uhr = mock.clock(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: '## Worum es ging\nKnopf.' } }) as never)
  const anfragen = verlaufUndHaiku(on, 'Hier der Überblick:\n- **Ziel:** Knopf bauen\n- **Gerade:** Tests')
  await $.command.run({ command: 'zusammenfassung', args: '' } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(1)
  expect(anfragen[0]).toContain('NUTZER: Bau den Knopf.')
  expect(anfragen[0]).toContain('ASSISTENT: Der Knopf ist gebaut')
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  const text = String((r as { text?: string }).text)
  expect(text).toContain('**Gerade:** Tests')
  expect(text).not.toContain('Hier der Überblick')
})

test('/zusammenfassung ohne brauchbaren Überblick lässt den alten stehen', async ($, on) => {
  grundlage(on)
  const uhr = mock.clock(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: '## Worum es ging\nKnopf.' } }) as never)
  verlaufUndHaiku(on, 'Keine Liste.')
  await $.command.run({ command: 'zusammenfassung', args: '' } as never)
  await uhr.settle()
  const r = await $.command.run({ command: 'offen', args: '' } as never)
  expect(String((r as { text?: string }).text)).not.toContain('Keine Liste')
})

test('/offen überblick schreibt den Überblick aus dem Verlauf neu', async ($, on) => {
  grundlage(on)
  const uhr = mock.clock(on)
  const anfragen = verlaufUndHaiku(on, '- **Ziel:** Knopf bauen\n- **Erledigt:** Tests grün')
  const r = await $.command.run({ command: 'offen', args: 'überblick' } as never)
  await uhr.settle()
  expect(anfragen.length).toBe(1)
  expect(String((r as { text?: string }).text)).toContain('**Erledigt:** Tests grün')
})

describe('Nachfassen ohne Block', () => {
  test('nachfassen: Frage oder Bitte am Schluss ja, sonst nein', () => {
    expect(nachfassen('Gebaut und getestet. Soll ich pushen?')).toBe(true)
    expect(nachfassen('Gebaut. Bitte prüfe die Seite im Browser.')).toBe(true)
    expect(nachfassen('Gebaut und getestet, alles committet.')).toBe(false)
    expect(nachfassen('Ok?')).toBe(false)
  })

  test('altern: ein nicht erwähnter offener Punkt zählt hoch, ein genannter (Nummer oder Titel) nicht', () => {
    const punkt = (nr: number, titel: string) => ({
      id: `p${nr}`, nr, titel, art: 'entscheidung', stufe: 'normal', frage: 'F?', info: '', anleitung: '',
      optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1,
    }) as never
    const r = altern([punkt(1, 'Freigabe Push'), punkt(2, 'Logo einbauen')], 'Zu #1 nichts Neues.', 2)
    expect(r.map(p => p.ohneBezug)).toEqual([0, 1])
  })

  test('Frage am Ende ohne Block ruft Haiku einmal, mit Block oder ohne Frage keinmal', async ($, on) => {
    const uhr = mock.clock(on, { now: 1_800_000_000_000 })
    grundlage(on)
    let haiku = 0
    on('model.complete', () => {
      haiku++
      return { value: { isAnswered: true, text: '{"neu":[],"erledigt":[]}' } } as never
    })
    const fertig = (answer: string, turnId: string) =>
      $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId } as never)
    await fertig('Gebaut und getestet, alles committet.', 't1')
    await uhr.settle()
    expect(haiku).toBe(0)
    await fertig(`${BLOCK}\nSoll ich weitermachen?`, 't2')
    await uhr.settle()
    expect(haiku).toBe(0)
    await fertig('Gebaut. Soll ich pushen?', 't3')
    await uhr.settle()
    expect(haiku).toBe(1)
  })
})

test('/offen und /erledigt zählen eine Nutzung in kosten.jsonl; /offen kosten zeigt sie', async ($, on) => {
  const uhr = mock.clock(on, { now: T })
  const dateien = new Map<string, string>()
  grundlageKosten(on, dateien)
  await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
  await uhr.settle()
  await $.command.run({ command: 'offen', args: '' } as never)
  await $.command.run({ command: 'offen', args: '7 erledigt' } as never)
  await $.command.run({ command: 'erledigt', args: '8' } as never)
  await uhr.settle()
  const zeilen = String(dateien.get(KOSTEN) ?? '').trim().split('\n').map(l => JSON.parse(l) as { art: string; quelle?: string; was?: string })
  expect(zeilen.filter(l => l.art === 'nutzung').map(l => `${l.quelle}:${l.was}`)).toEqual(['befehl:liste', 'befehl:erledigt', 'befehl:erledigt'])
  const r = await $.command.run({ command: 'offen', args: 'kosten' } as never)
  expect(String((r as { text?: string }).text)).toContain('/offen-Befehle: erledigt 2, liste 1')
})

describe('Eingaben von Maschinen', () => {
  const FRAGE = 'Alles gebaut. Soll ich pushen?'

  test('Peer-Nachricht: die Antwort darauf wird nicht ausgewertet; die nächste Eingabe des Nutzers wieder', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    grundlageBetrieb(on, new Map())
    const anfragen = haiku(on)
    gesendet(on)

    await eingabe($, 'Peer sagt hallo', 'peer')
    await fertig($, FRAGE)
    await uhr.settle()
    expect(anfragen.length).toBe(0)

    // Gegenprobe: dieselbe Antwort nach einer Eingabe des Nutzers wird ausgewertet
    await eingabe($, 'Sieht gut aus', 'composer')
    await fertig($, FRAGE)
    await uhr.settle()
    expect(anfragen.length).toBe(1)
  })

  for (const kind of ['sdk', 'task-notification', 'scheduled-trigger', 'peer-send-message', 'projects-relay', 'channel']) {
    test(`Ursprung „${kind}“ gilt als Maschine`, async ($, on) => {
      const uhr = mock.clock(on, { now: T_BETRIEB })
      grundlageBetrieb(on, new Map())
      const anfragen = haiku(on)
      gesendet(on)
      await eingabe($, 'Hallo vom Zeitplan', kind)
      await fertig($, FRAGE)
      await uhr.settle()
      expect(anfragen.length).toBe(0)
    })
  }

  test('„Automatische Klärung …“ aus der Eingabe: keine Auswertung, aber „erledigt: #1“ schließt; danach wertet eine normale Eingabe wieder aus', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    const anfragen = haiku(on)
    gesendet(on)

    await call($, ZWEI)

    await uhr.settle()
    await fertig($, 'Eingetragen.')
    await uhr.settle()

    await eingabe($, 'Automatische Klärung der offenen Punkte: #1 Freigabe Push (Darf ich pushen?). Geh sie durch.', 'composer')
    await fertig($, 'Der Push ist durch.\nerledigt: #1 – gepusht\nSoll ich noch etwas tun?')
    await uhr.settle()
    expect(anfragen.length).toBe(0)
    const p = gespeichert(dateien)
    expect(p.find(x => x.nr === 1)).toMatchObject({ status: 'erledigt', ergebnis: 'von Claude als erledigt gemeldet – gepusht' })
    expect(p.find(x => x.nr === 2)?.status).toBe('offen')
    // Nach „Eingetragen.“ steht #2 bei 1 (nicht genannt); die Klärungs-Antwort lässt nichts weiter altern.
    expect(p.find(x => x.nr === 2)?.ohneBezug).toBe(1)
    const liste = await befehl($, '')
    expect(liste).toContain('Automatisch erledigt (1')
    expect(liste).toContain('🤖 1. Freigabe Push – von Claude als erledigt gemeldet – gepusht')

    await eingabe($, 'weiter', 'composer')
    await fertig($, 'Gebaut. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(1)
  })

  // klaerungsBitte (logik.ts): „Beginnt mit ‚Automatische Klärung‘, damit der Turn nicht ausgewertet wird“. Die Bitte geht aber
  // als $.prompt.submit des Mods selbst hinaus, und ein solcher Aufruf läuft nicht durch den eigenen prompt.submit-Hook:
  // dort steht istMaschinenEingabe, gesehen wird es nie.
  test('/offen klären: die Antwort auf die Klärungs-Bitte wird nicht ausgewertet, die Marke schließt', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    const anfragen = haiku(on)
    const texte = gesendet(on)
    await call($, ZWEI)
    await uhr.settle()
    await fertig($, 'Eingetragen.')
    await uhr.settle()

    expect(await befehl($, 'klären')).toBe('Klärung von 2 Punkten geht an Claude.')
    await uhr.settle()
    expect(texte).toHaveLength(1)
    expect(texte[0]).toStartWith('Automatische Klärung')

    await fertig($, 'Geprüft.\nerledigt: #1 – gepusht\nSoll ich noch etwas tun?')
    await uhr.settle()
    expect(anfragen.length).toBe(0)
    expect(gespeichert(dateien).find(x => x.nr === 1)?.status).toBe('erledigt')
  })
})

describe('Sitzung ohne Menschen (claude -p)', () => {
  /** Zählt die Aufrufe von $.tool.register. */
  const werkzeugZaehler = (on: On) => {
    const zaehler = { n: 0 }
    on('tool.register', () => {
      zaehler.n++
      return { value: { tool: 'mcp__offene-punkte__punkte' } } as never
    })
    return zaehler
  }

  test('auch mit Menschen wird kein Werkzeug registriert', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    grundlageBetrieb(on, new Map())
    const werkzeug = werkzeugZaehler(on)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    expect(werkzeug.n).toBe(0)
  })

  test('bleibt still: kein Haiku, kein Hinweis im Kontext – nur die Marken schließen und die Datei wird geschrieben', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map([[OFFEN, ablageText({ punkte: [punkt(1, 'Freigabe Push')], ueberblick: '' }, 1)]])
    grundlageBetrieb(on, dateien)
    on('prompt.context', (_, e) => ({ blocks: e.blocks }) as never)
    const anfragen = haiku(on)
    await $.session.start({ cwd: '/projekt', surface: null, isInteractive: false } as never)
    await uhr.settle()

    expect(JSON.stringify(await $.prompt.context({ blocks: [] } as never))).not.toContain('offenePunkte')
    await fertig($, 'Gepusht. Soll ich noch etwas tun?\nerledigt: #1')
    await uhr.settle()
    expect(anfragen.length).toBe(0)
    expect(gespeichert(dateien)[0]).toMatchObject({ status: 'erledigt' })
  })

  test('mit Menschen davor kommt der Hinweis in den Kontext', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    grundlageBetrieb(on, new Map())
    on('prompt.context', (_, e) => ({ blocks: e.blocks }) as never)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    expect(JSON.stringify(await $.prompt.context({ blocks: [] } as never))).toContain('offenePunkte')
  })
})

describe('kosten.jsonl', () => {
  const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 2 }

  test('ein Haiku-Aufruf mit usage schreibt eine Zeile mit art „nachfassen“ und eingabe 12', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    const anfragen = haiku(on, USAGE)

    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(1)
    const kosten = String(dateien.get(KOSTEN))
    expect(kosten).toContain('"art":"nachfassen"')
    expect(kosten).toContain('"eingabe":12')
    const zeilen = kosten.trim().split('\n')
    expect(zeilen).toHaveLength(1)
    expect(JSON.parse(zeilen[0] ?? '')).toMatchObject({ art: 'nachfassen', eingabe: 12, cache: 0, ausgabe: 5, version: VERSION, zeit: new Date(T_BETRIEB).toISOString() })
  })

  test('jeder weitere Aufruf hängt eine Zeile an', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    haiku(on, USAGE)
    for (const turnId of [1, 2]) {
      await fertig($, `Alles gebaut und getestet (${turnId}). Soll ich pushen?`)
      await uhr.settle()
    }
    expect(String(dateien.get(KOSTEN)).trim().split('\n')).toHaveLength(2)
  })

  test('ohne usage im Ergebnis entsteht keine Zeile', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const dateien = new Map<string, string>()
    grundlageBetrieb(on, dateien)
    const anfragen = haiku(on)
    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(1)
    expect(dateien.has(KOSTEN)).toBe(false)
  })

  test('die Datei wächst nicht endlos: ab 200 kB bleibt der jüngere Teil', async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    const alt = Array.from({ length: 4000 }, (_, i) => `{"zeit":"2026-10-01T00:00:00.000Z","sitzung":"A","art":"nachfassen","eingabe":${i},"cache":0,"ausgabe":1}`).join('\n') + '\n'
    expect(alt.length).toBeGreaterThan(200_000)
    const dateien = new Map<string, string>([[KOSTEN, alt]])
    grundlageBetrieb(on, dateien)
    haiku(on, USAGE)
    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    const kosten = String(dateien.get(KOSTEN))
    expect(kosten.length).toBeLessThan(160_000)
    expect(kosten.startsWith('{"zeit"')).toBe(true)
    expect(kosten.trim().split('\n').at(-1)).toContain('"eingabe":12')
  })
})

describe('Haiku-Budget (haikuBisProzent)', () => {
  const fenster = (percentUsed: number) => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed }, { kind: 'seven_day', percentUsed: 99 }] } }) as never

  for (const [prozent, erwartet] of [[90, 0], [50, 1]] as const) {
    test(`Standardgrenze 85: bei ${prozent} % des 5-Stunden-Fensters ${erwartet} Haiku-Aufruf(e)`, async ($, on) => {
      const uhr = mock.clock(on, { now: T_BETRIEB })
      grundlageBetrieb(on, new Map())
      on('session.usage', () => fenster(prozent))
      const anfragen = haiku(on)
      await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
      await uhr.settle()
      expect(anfragen.length).toBe(erwartet)
    })
  }

  test('die Grenze ist einstellbar', { options: { haikuBisProzent: 40 } }, async ($, on) => {
    const uhr = mock.clock(on, { now: T_BETRIEB })
    grundlageBetrieb(on, new Map())
    on('session.usage', () => fenster(50))
    const anfragen = haiku(on)
    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(0)
  })
})
