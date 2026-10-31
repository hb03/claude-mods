import { describe, expect, test } from 'claude-code/testing'

import {
  MAX_VERLAUF_FORT, NEU_NACH_FORT, UEBERBLICK_FORT, UEBERBLICK_NEU, kommando, kontextZeile, kostenAuswerten, tokensGeschaetzt, ueberblickAnfrage,
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
