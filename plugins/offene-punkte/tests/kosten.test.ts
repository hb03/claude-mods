import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  MAX_VERLAUF_FORT, NEU_NACH_FORT, UEBERBLICK_FORT, UEBERBLICK_NEU, kommando, kontextZeile, kostenAuswerten, nutzungZeile, tokensGeschaetzt, ueberblickAnfrage,
} from '../hooks/logik'
import type { Nachricht } from '../hooks/logik'

const T = Date.UTC(2026, 9, 31, 12, 0)
const TAG = 24 * 3600_000

const verlauf: Nachricht[] = [
  { role: 'user', text: 'Bitte die Statuszeile reparieren.' },
  { role: 'assistant', text: 'Erledigt, Commit 1d78dce.' },
  { role: 'user', text: 'Jetzt die Plugins angleichen.' },
  { role: 'assistant', text: 'kontext-anzeige 0.6.1 ist gepusht.' },
]

describe('Überblick fortschreiben', () => {
  test('ohne alten Überblick oder ohne Marke: ganz neu aus dem Verlauf', () => {
    const a = ueberblickAnfrage(verlauf, '', 0)
    expect(a?.modus).toBe('neu')
    expect(a?.system).toBe(UEBERBLICK_NEU)
    expect(a?.prompt).toContain('Statuszeile reparieren')
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 0)?.modus).toBe('neu')
  })

  test('mit altem Überblick: nur die Nachrichten seit der Marke, dazu der alte Text', () => {
    const a = ueberblickAnfrage(verlauf, '- **Ziel:** Statuszeile', 2)
    expect(a?.modus).toBe('fort')
    expect(a?.system).toBe(UEBERBLICK_FORT)
    expect(a?.prompt).toContain('BISHERIGER ÜBERBLICK:\n- **Ziel:** Statuszeile')
    expect(a?.prompt).toContain('Plugins angleichen')
    expect(a?.prompt).not.toContain('Statuszeile reparieren')
  })

  test('nichts Neues: null; Verlauf geschrumpft (Compaction) oder zu oft fortgeschrieben: ganz neu', () => {
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 4)).toBeNull()
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 9)?.modus).toBe('neu')
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 2, NEU_NACH_FORT)?.modus).toBe('neu')
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 2, NEU_NACH_FORT - 1)?.modus).toBe('fort')
    expect(ueberblickAnfrage([], '', 0)).toBeNull()
  })

  test('neue Nachrichten sind auf MAX_VERLAUF_FORT begrenzt, der Schluss bleibt', () => {
    const lang: Nachricht[] = [verlauf[0]!, ...Array.from({ length: 30 }, (_, i) => ({ role: 'assistant' as const, text: `Schritt ${i} `.repeat(60) })), { role: 'user', text: 'ENDE' }]
    const a = ueberblickAnfrage(lang, '- **Ziel:** x', 1)
    const neue = a?.prompt.split('(älteste zuerst):\n\n')[1] ?? ''
    expect(neue.length).toBeLessThanOrEqual(MAX_VERLAUF_FORT + 1)
    expect(neue.endsWith('NUTZER: ENDE')).toBe(true)
  })
})

describe('Kosten', () => {
  test('Kontextzeile schätzt je Teil und in Summe, leere Teile fehlen', () => {
    const z = JSON.parse(kontextZeile({ uebergabe: '', liste: 'x'.repeat(350), hinweise: 'y'.repeat(35) }, 'S', T)) as Record<string, unknown>
    expect(z).toMatchObject({ art: 'kontext', modell: 'haupt', geschaetzt: true, eingabe: 110, ausgabe: 0, sitzung: 'S', teile: { liste: 100, hinweise: 10 } })
    expect(tokensGeschaetzt('')).toBe(0)
  })

  test('/offen kosten [Tage] wird gelesen', () => {
    expect(kommando('kosten')).toEqual({ art: 'kosten', tage: 0 })
    expect(kommando('Kosten 7')).toEqual({ art: 'kosten', tage: 7 })
  })

  test('Auswertung: je Art mit Preis, Summe, Kontext getrennt; Zeitraum und kaputte Zeilen', () => {
    const zeile = (tagVor: number, art: string, eingabe: number, ausgabe: number, extra = '') =>
      `{"zeit":"${new Date(T - tagVor * TAG).toISOString()}","sitzung":"s${tagVor}","art":"${art}","eingabe":${eingabe},"cache":0,"ausgabe":${ausgabe}${extra}}`
    const text = [
      zeile(20, 'ueberblick', 8000, 1200),
      zeile(2, 'ueberblick', 3000, 400),
      zeile(1, 'nachfassen', 3000, 600),
      zeile(1, 'kontext', 700, 0, ',"modell":"haupt","geschaetzt":true'),
      'kaputt {',
    ].join('\n')
    const alles = kostenAuswerten(text, T)
    expect(alles).toContain('3 Sitzungen')
    expect(alles).toContain('ueberblick         2       11k        0     1.6k   0.02')
    expect(alles).toContain('Summe              3       14k        0     2.2k   0.03')
    expect(alles).toContain('1 Nachrichten mit Zusatz, 700 Tokens')
    const woche = kostenAuswerten(text, T, 7)
    expect(woche).toContain('letzte 7 Tage')
    expect(woche).toContain('ueberblick         1')
    expect(kostenAuswerten('', T)).toContain('Noch keine Kosten')
    expect(kostenAuswerten(zeile(20, 'abgleich', 1, 1), T, 7)).toContain('Keine Kosten in den letzten 7 Tagen')
  })
})

describe('Nutzung zählen (0.18.0)', () => {
  test('nutzungZeile: art nutzung, Quelle und Was, keine Tokens; Was ist begrenzt', () => {
    const z = JSON.parse(nutzungZeile('befehl', 'erledigt', 'S', T)) as Record<string, unknown>
    expect(z).toMatchObject({ art: 'nutzung', quelle: 'befehl', was: 'erledigt', eingabe: 0, ausgabe: 0, sitzung: 'S' })
    expect((JSON.parse(nutzungZeile('wahl', 'x'.repeat(80), 'S', T)) as { was: string }).was.length).toBe(40)
  })

  test('kostenAuswerten: Nutzung je Quelle gezählt, nicht in der Haiku-Tabelle', () => {
    const text = [
      nutzungZeile('befehl', 'liste', 's1', T - TAG), nutzungZeile('befehl', 'liste', 's1', T - TAG), nutzungZeile('befehl', 'erledigt', 's2', T),
      nutzungZeile('wahl', 'option', 's1', T), nutzungZeile('eingang', 'antwort', 's3', T), nutzungZeile('block', 'neu', 's1', T), nutzungZeile('marke', 'erledigt', 's1', T),
      `{"zeit":"${new Date(T).toISOString()}","sitzung":"s1","art":"nachfassen","eingabe":3000,"cache":0,"ausgabe":600}`,
    ].join('\n')
    const aus = kostenAuswerten(text, T)
    expect(aus).toContain('Nutzung (ab 0.18.0): 7 Vorgänge.')
    expect(aus).toContain('/offen-Befehle: liste 2, erledigt 1')
    expect(aus).toContain('Wahl über der Eingabe: option 1')
    expect(aus).toContain('eingang.txt (claude-web): antwort 1')
    expect(aus).toContain('Blöcke von Claude: neu 1')
    expect(aus).toContain('Marken von Claude: erledigt 1')
    expect(aus).toContain('Summe              1')
    expect(kostenAuswerten(nutzungZeile('befehl', 'liste', 's1', T), T)).not.toContain('Haiku (gemessen)')
  })
})

// ---------------------------------------------------------------- Im Betrieb

const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const KOSTEN = '/projekt/offene-punkte/kosten.jsonl'

function grundlage(on: On, dateien: Map<string, string>) {
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

test('/offen und /erledigt zählen eine Nutzung in kosten.jsonl; /offen kosten zeigt sie', async ($, on) => {
  const uhr = mock.clock(on, { now: T })
  const dateien = new Map<string, string>()
  grundlage(on, dateien)
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
