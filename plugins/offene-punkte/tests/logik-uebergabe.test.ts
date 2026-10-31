// Reine Funktionen aus hooks/logik/uebergabe.ts: Uebergabe und Archiv
import { describe, expect, test } from 'claude-code/testing'

import { indexZeile, kommando, uebergabeDateien, uebergabeIndex, uebergabeName, uebergabeText } from '../hooks/logik'

// Mi 14.10.2026, 21:40 Ortszeit
const T = new Date(2026, 9, 14, 21, 40).getTime()

const INHALT = '## Ziel\nÜbergabe einbauen.\n\n## Nächster Schritt\n- Tests laufen lassen\n\n## Dateien und Befehle\n`claude plugin test .`'

describe('Übergabe: Befehl und Archiv', () => {
  test('/offen übergabe, übergabe nur, übergaben, übergabe 2 – auch ohne Umlaut', () => {
    expect(kommando('übergabe')).toEqual({ art: 'uebergabe', clear: true })
    expect(kommando('Uebergabe nur')).toEqual({ art: 'uebergabe', clear: false })
    expect(kommando('übergaben')).toEqual({ art: 'uebergaben' })
    expect(kommando('übergabe 2')).toEqual({ art: 'uebergabe-zeigen', nummer: 2 })
    expect(kommando('übergabe bitte').art).toBe('fehler')
  })

  test('Namen nach Minute, in derselben Minute mit Zähler; sortiert neueste zuerst, Fremdes bleibt draußen', () => {
    expect(uebergabeName(T, [])).toBe('2026-10-14-2140.md')
    expect(uebergabeName(T, ['2026-10-14-2140.md', '2026-10-14-2140-2.md'])).toBe('2026-10-14-2140-3.md')
    expect(uebergabeDateien(['index.md', 'wartet.txt', '2026-10-13-0900.md', '2026-10-14-2140.md', '2026-10-14-2140-2.md', 'notiz.md']))
      .toEqual(['2026-10-14-2140-2.md', '2026-10-14-2140.md', '2026-10-13-0900.md'])
  })

  test('der Index nimmt Ziel und nächsten Schritt, neueste oben, dieselbe Datei nur einmal', () => {
    const eins = uebergabeIndex('', '2026-10-13-0900.md', '## Ziel\nAlt.', T - 86_400_000)
    const zwei = uebergabeIndex(eins, '2026-10-14-2140.md', INHALT, T)
    const zeilen = zwei.split('\n').filter(z => z.startsWith('- '))
    expect(zeilen.length).toBe(2)
    expect(zeilen[0]).toContain('[2026-10-14-2140.md]')
    expect(zeilen[0]).toContain('Ziel: Übergabe einbauen.')
    expect(zeilen[0]).toContain('Weiter: Tests laufen lassen')
    expect(indexZeile(zwei, '2026-10-13-0900.md')).toContain('Ziel: Alt.')
    expect(uebergabeIndex(zwei, '2026-10-14-2140.md', INHALT, T).split('\n').filter(z => z.startsWith('- ')).length).toBe(2)
    expect(uebergabeText(INHALT, T, 'abcdef123456')).toMatch(/^# Übergabe · 14\.10\.2026 21:40\n\nSitzung abcdef12 /)
  })
})
