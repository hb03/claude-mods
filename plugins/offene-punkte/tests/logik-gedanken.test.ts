// Reine Funktionen aus hooks/logik/gedanken.ts: gedanken.md
import { describe, expect, test } from 'claude-code/testing'

import {
  gedankeBitte, gedankeZustand, gedankenLesen, gedankenMarken, gedankenPruefBitte, gedankenText, kommando, naechsteGedankenNr, zeitText
} from '../hooks/logik'

const DATEI = `# Gedanken

Was mir einfällt.

### G1 · 13.10.2026 22:10 · offen
Den Leitstand nachts drosseln.

### G2 · 13.10.2026 22:15 · gesendet
Logo-Overlay
auch auf geraet3.

### G3 · 12.10.2026 09:00 · erledigt 13.10. · Commit abc1234
Alte Idee.
`

describe('gedanken.md', () => {
  test('lesen: Kopf bleibt, Einträge mit Nummer, Zeit, Vermerk und mehrzeiligem Text', () => {
    const d = gedankenLesen(DATEI)
    expect(d.kopf).toBe('# Gedanken\n\nWas mir einfällt.\n')
    expect(d.gedanken.map(g => [g.nr, g.zeit, g.vermerk])).toEqual([
      [1, '13.10.2026 22:10', 'offen'],
      [2, '13.10.2026 22:15', 'gesendet'],
      [3, '12.10.2026 09:00', 'erledigt 13.10. · Commit abc1234'],
    ])
    expect(d.gedanken[1]?.text).toBe('Logo-Overlay\nauch auf geraet3.')
    expect(d.gedanken.map(gedankeZustand)).toEqual(['offen', 'in Arbeit', 'verarbeitet'])
    expect(naechsteGedankenNr(d)).toBe(4)
  })

  test('schreiben und wieder lesen ergibt dasselbe; leere Datei bekommt den Standardkopf', () => {
    const d = gedankenLesen(DATEI)
    expect(gedankenLesen(gedankenText(d))).toEqual(d)
    const leer = gedankenLesen('')
    expect(leer).toEqual({ kopf: '', gedanken: [] })
    expect(gedankenText({ kopf: '', gedanken: [{ nr: 1, zeit: '14.10.2026 09:00', vermerk: 'offen', text: 'Hallo' }] }))
      .toBe('# Gedanken\n\nEinfälle, die noch nicht dran sind; wird von offene-punkte und claude-web geschrieben.\n\n### G1 · 14.10.2026 09:00 · offen\nHallo\n')
  })

  test('claude-web-Dateien: Abschnitte „## …“ gehören zu keinem Gedanken; alte Vermerke zählen als verarbeitet', () => {
    const d = gedankenLesen([
      '# Gedanken', '', '## Offen', '', '### G1 · 13.10.2026 22:10 · offen', 'A', '', '## In Arbeit', '',
      '### G2 · 13.10.2026 22:11 · als offener Punkt #4', 'B', '', '## Verarbeitet', '', '### G3 · 13.10.2026 22:12 · in den Chat gegeben', 'C', '',
    ].join('\n'))
    expect(d.kopf).toBe('# Gedanken\n')
    expect(d.gedanken.map(g => g.text)).toEqual(['A', 'B', 'C'])
    expect(d.gedanken.map(gedankeZustand)).toEqual(['offen', 'verarbeitet', 'verarbeitet'])
    expect(gedankeZustand({ nr: 9, zeit: '', vermerk: 'als Punkt #12', text: '' })).toBe('verarbeitet')
    expect(gedankenText(d)).not.toContain('## Offen')
  })

  test('Marken von Claude: erledigt mit Commit, verworfen mit Grund; G ohne Buchstabe geht auch', () => {
    const jetzt = new Date(2026, 9, 14, 9, 5).getTime()
    expect(zeitText(jetzt)).toBe('14.10.2026 09:05')
    expect(gedankenMarken('Fertig.\ngedanke erledigt: G2 – Commit abc1234\ngedanke verworfen: 5 – zu teuer', jetzt)).toEqual([
      { nr: 2, vermerk: 'erledigt 14.10. · Commit abc1234' },
      { nr: 5, vermerk: 'verworfen 14.10. · zu teuer' },
    ])
    expect(gedankenMarken('Der Gedanke ist erledigt.', jetzt)).toEqual([])
  })

  test('Bitten nennen Nummer, Text und die Marke; die Prüfung ist eine Automatische Klärung', () => {
    const g = { nr: 2, zeit: '13.10.2026 22:15', vermerk: 'offen', text: 'Logo-Overlay auch auf geraet3.' }
    expect(gedankeBitte(g, 'senden')).toContain('Gedanke G2 (13.10.2026 22:15): Logo-Overlay auch auf geraet3.')
    expect(gedankeBitte(g, 'senden')).toContain('gedanke erledigt: G2')
    expect(gedankeBitte(g, 'interview')).toContain('Planungsinterview')
    expect(gedankenPruefBitte([g])).toMatch(/^Automatische Klärung der Gedanken/)
    expect(gedankenPruefBitte([g])).toContain('G2 (offen)')
  })

  test('/offen-Befehle für Gedanken', () => {
    expect(kommando('gedanke Den Leitstand nachts drosseln')).toEqual({ art: 'gedanke-neu', text: 'Den Leitstand nachts drosseln' })
    expect(kommando('gedanke 3 Dinge prüfen')).toEqual({ art: 'gedanke-neu', text: '3 Dinge prüfen' })
    expect(kommando('gedanke')).toMatchObject({ art: 'fehler' })
    expect(kommando('gedanken')).toEqual({ art: 'gedanken' })
    expect(kommando('gedanken prüfen')).toEqual({ art: 'gedanken-pruefen' })
    expect(kommando('gedanke 2 senden')).toEqual({ art: 'gedanke', nummer: 2, tun: 'senden', text: '' })
    expect(kommando('gedanke G2 Interview')).toEqual({ art: 'gedanke', nummer: 2, tun: 'interview', text: '' })
    expect(kommando('gedanke 2 erledigt von Hand')).toEqual({ art: 'gedanke', nummer: 2, tun: 'erledigt', text: 'von Hand' })
  })
})
