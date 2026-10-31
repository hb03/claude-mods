// Reine Funktionen aus hooks/logik/kosten.ts: Kosten- und Nutzungszeilen
import { describe, expect, test } from 'claude-code/testing'

import { kommando, kontextZeile, kostenAuswerten, nutzungZeile, tokensGeschaetzt } from '../hooks/logik'

const T = Date.UTC(2026, 9, 31, 12, 0)

const TAG = 24 * 3600_000

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
