import { describe, expect, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import { ABGLEICH_NACH_MS, ablageLesen, ablageText, abgleichAnfrage, abgleichAnwenden, abgleichKandidaten, liesAbgleich } from '../hooks/logik'

const TAG = 24 * 3600_000
const JETZT = 10 * TAG

const punkt = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`,
  nr,
  titel: `Punkt ${nr}`,
  frage: `Frage ${nr}?`,
  info: '',
  art: 'aufgabe',
  anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }],
  status: 'offen',
  zurueckgestellt: 0,
  erstellt: JETZT - 2 * TAG,
  ...extra,
})

describe('Startabgleich: wer drankommt', () => {
  test('nur offene, unbeantwortete Punkte, die seit ABGLEICH_NACH_MS niemand geprueft hat', () => {
    const liste = [
      punkt(1),
      punkt(2, { erstellt: JETZT - ABGLEICH_NACH_MS / 2 }),
      punkt(3, { geprueft: JETZT - ABGLEICH_NACH_MS / 2 }),
      punkt(4, { status: 'erledigt' }),
      punkt(5, { vonNutzer: true }),
      punkt(6, { ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung' } }),
      punkt(7, { geprueft: JETZT - ABGLEICH_NACH_MS }),
    ]
    expect(abgleichKandidaten(liste, JETZT).map(p => p.nr)).toEqual([1, 7])
  })

  test('die Anfrage nennt Nummer, Frage und die Commits', () => {
    const a = abgleichAnfrage([punkt(3, { info: 'Weil.' })], { commits: '48dbe6c 12.10. Plan: Arbeitskopie gilt', ueberblick: '' })
    expect(a).toContain('#3 Punkt 3')
    expect(a).toContain('Frage: Frage 3?')
    expect(a).toContain('48dbe6c')
    expect(a).toContain('(keiner)')
  })
})

describe('Startabgleich: Antwort lesen', () => {
  test('liest erledigt und ueberholt, offen und Unvollstaendiges zaehlt nicht', () => {
    const e = liesAbgleich('```json\n{"ergebnisse":[{"nr":2,"stand":"erledigt","grund":"Commit abc"},{"nr":3,"stand":"offen","grund":"x"},{"nr":4,"stand":"ueberholt","grund":""},{"nr":5,"stand":"ueberholt","grund":"Plan geaendert"}]}\n```')
    expect(e).toEqual([
      { nr: 2, stand: 'erledigt', grund: 'Commit abc' },
      { nr: 5, stand: 'ueberholt', grund: 'Plan geaendert' },
    ])
  })

  test('kein JSON: null', () => {
    expect(liesAbgleich('weiss nicht')).toBe(null)
  })
})

describe('Startabgleich: anwenden', () => {
  test('schliesst Belegtes mit Grund, stempelt den Rest, laesst Ungepruefte in Ruhe', () => {
    const liste = [punkt(1), punkt(2), punkt(3)]
    const neu = abgleichAnwenden(liste, [1, 2], [{ nr: 1, stand: 'ueberholt', grund: 'Plan geaendert' }], JETZT)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.ergebnis).toBe('beim Start abgeglichen: überholt – Plan geaendert')
    expect(neu[0]?.auto?.zeit).toBe(JETZT)
    expect(neu[1]?.status).toBe('offen')
    expect(neu[1]?.geprueft).toBe(JETZT)
    expect(neu[2]).toEqual(liste[2])
  })

  test('der Pruefstempel uebersteht offen.md', () => {
    const neu = abgleichAnwenden([punkt(1)], [1], [], JETZT)
    const a = ablageLesen(ablageText({ punkte: neu, ueberblick: '', hoechsteNr: 1 }, JETZT))
    expect(a?.punkte[0]?.geprueft).toBe(JETZT)
    expect(abgleichKandidaten(a?.punkte ?? [], JETZT + ABGLEICH_NACH_MS / 2)).toEqual([])
  })
})
