// Reine Funktionen aus hooks/logik/abgleich.ts: Startabgleich und Entscheidungsliste
import { describe, expect, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  ABGLEICH_NACH_MS, abgleichAnfrage, abgleichAnwenden, abgleichKandidaten, ablageLesen, ablageText, anfrage, entscheidungenAus,
  liesAbgleich, verlaufKopf, verlaufsEintraege
} from '../hooks/logik'

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

const JETZT_AKTIV = 100 * TAG

const punktAktiv = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
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
  erstellt: JETZT_AKTIV - 2 * TAG,
  ...extra,
})

// So 11.10.2026, 14:00 Ortszeit
const T = new Date(2026, 9, 11, 14, 0).getTime()

const punktBetrieb = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
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

describe('entscheidungenAus', () => {
  const block = (zeit: string, nr: number, titel: string, wie: string, ergebnis?: string) =>
    `## ${zeit} · #${nr} ${titel} – ${wie}\n\n**Frage:** Frage?\n\n${ergebnis !== undefined ? `**Ergebnis:** ${ergebnis}\n` : ''}`

  test('liest Titel und Ergebnis als Kurzzeile', () => {
    const t = `# Antworten auf offene Punkte – 2026-10-12\n\nWas entschieden...\n\n${block('22:36', 1, 'Titel', 'entschieden', 'Ja')}`
    expect(entscheidungenAus([t])).toBe('- Titel: Ja')
  })

  test('Blöcke ohne Ergebnis fallen weg', () => {
    const t = `${block('12:00', 3, 'X', 'wieder geöffnet')}\n${block('12:05', 4, 'Y', 'erledigt', 'Fertig')}`
    expect(entscheidungenAus([t])).toBe('- Y: Fertig')
  })

  test('Kürzung behält das Neueste mit führendem …', () => {
    const t1 = block('10:00', 1, 'Alt', 'entschieden', 'A'.repeat(30))
    const t2 = block('11:00', 2, 'Neu', 'entschieden', 'B'.repeat(30))
    const aus = entscheidungenAus([t1, t2], 40)
    expect(aus.startsWith('…')).toBe(true)
    expect(aus).toContain('BBBB')
    expect(aus).not.toContain('Alt')
  })
})

describe('Anfragen mit Belegen', () => {
  test('abgleichAnfrage enthält SEITHER ENTSCHIEDEN mit dem Text', () => {
    const a = abgleichAnfrage([punktAktiv(3)], { commits: '', ueberblick: '', entschieden: '- Titel: Ja' })
    expect(a).toContain('SEITHER ENTSCHIEDEN')
    expect(a).toContain('- Titel: Ja')
  })

  test('anfrage mit geschlossenen Punkten enthält KÜRZLICH GESCHLOSSEN und den Titel', () => {
    const a = anfrage('Antwort', 'Hallo', [], '', [punktAktiv(1, { titel: 'Schon zu', status: 'erledigt', ergebnis: 'Ja' })])
    expect(a).toContain('KÜRZLICH GESCHLOSSEN')
    expect(a).toContain('Schon zu')
  })
})

describe('entscheidungenAus', () => {
  const eintrag = (vorher: Punkt, nachher: Partial<Punkt>) => verlaufsEintraege([vorher], [{ ...vorher, status: 'erledigt', ...nachher }], T)

  test('liest auch Überschriften mit zweiwortigem Stand („– automatisch geschlossen“)', () => {
    const e = eintrag(punktBetrieb(4, 'Seite neu laden'), { ergebnis: 'laut Gespräch erledigt – neu geladen', auto: { grund: 'neu geladen', zeit: T } })
    const verlauf = `${verlaufKopf(T)}\n${e.join('\n')}`
    expect(verlauf).toContain('– automatisch geschlossen')
    expect(entscheidungenAus([verlauf])).toBe('- Seite neu laden: laut Gespräch erledigt – neu geladen')
  })

  test('Einwort-Stand, Titel mit Gedankenstrich und mehrere Einträge zusammen', () => {
    const lang = eintrag(punktBetrieb(1, 'Variante A – B', { art: 'entscheidung' }), { ergebnis: 'Ja – „Ja.“' })
    const kurz = eintrag(punktBetrieb(2, 'Mail einrichten'), { ergebnis: 'gesammelt verworfen – Aufgeräumt', status: 'verworfen' })
    const verlauf = `${verlaufKopf(T)}\n${[...lang, ...kurz].join('\n')}`
    expect(entscheidungenAus([verlauf])).toBe('- Variante A – B: Ja – „Ja.“\n- Mail einrichten: gesammelt verworfen – Aufgeräumt')
  })
})
