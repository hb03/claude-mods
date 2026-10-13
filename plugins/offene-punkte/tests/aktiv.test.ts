import { describe, expect, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  ANGEBOT_VERFALL, VERALTET_NACH, WIEDER_NEU_NACH_MS, abgleichAnfrage, anfrage, entscheidungenAus, erledigtMarken,
  listeFuerClaude, perMarkeSchliessen, schlussMarken, veraltetSchliessen, zuletztGeschlossen, zusammenfuehren,
} from '../hooks/logik'

const TAG = 24 * 3600_000
const JETZT = 100 * TAG

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

const leer = { neu: [], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }

describe('Marken in Claudes Antwort', () => {
  test('erledigt mit mehreren Nummern ist nicht ueberholt', () => {
    expect(schlussMarken('Fertig.\nerledigt: #3, #5')).toEqual([
      { nr: 3, ueberholt: false, grund: '' },
      { nr: 5, ueberholt: false, grund: '' },
    ])
  })

  test('überholt mit Grund', () => {
    expect(schlussMarken('überholt: #4 – Plan geändert')).toEqual([{ nr: 4, ueberholt: true, grund: 'Plan geändert' }])
  })

  test('hinfällig zählt als überholt', () => {
    const m = schlussMarken('hinfällig: #7')
    expect(m).toHaveLength(1)
    expect(m[0]?.nr).toBe(7)
    expect(m[0]?.ueberholt).toBe(true)
  })

  test('freier Satz ist keine Marke', () => {
    expect(schlussMarken('Punkt 3 ist erledigt')).toEqual([])
  })

  test('erledigtMarken liefert alle Nummern, auch überholte', () => {
    expect(erledigtMarken('erledigt: #3, #5\nüberholt: #4 – Plan geändert')).toEqual([3, 5, 4])
  })
})

describe('perMarkeSchliessen', () => {
  test('einfache Nummern: von Claude als erledigt gemeldet', () => {
    const neu = perMarkeSchliessen([punkt(1), punkt(2)], [1], JETZT)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.ergebnis).toBe('von Claude als erledigt gemeldet')
    expect(neu[0]?.auto?.zeit).toBe(JETZT)
    expect(neu[0]?.geaendert).toBe(JETZT)
    expect(neu[1]).toEqual(punkt(2))
  })

  test('Marke überholt: Ergebnis nennt überholt und den Grund', () => {
    const neu = perMarkeSchliessen([punkt(4)], [{ nr: 4, ueberholt: true, grund: 'Plan geändert' }], JETZT)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.ergebnis).toContain('überholt')
    expect(neu[0]?.ergebnis).toContain('Plan geändert')
  })

  test('ausstehende und schon geschlossene Punkte bleiben unberührt', () => {
    const aus = punkt(1, { ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung' } })
    const zu = punkt(2, { status: 'erledigt', ergebnis: 'alt' })
    const liste = [aus, zu]
    expect(perMarkeSchliessen(liste, [1, 2], JETZT)).toEqual(liste)
  })
})

describe('veraltetSchliessen', () => {
  test('schließt Punkte ohne Bezug ab VERALTET_NACH', () => {
    const neu = veraltetSchliessen([punkt(1, { ohneBezug: VERALTET_NACH }), punkt(2, { ohneBezug: VERALTET_NACH - 1 })], JETZT)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.auto?.zeit).toBe(JETZT)
    expect(neu[0]?.geaendert).toBe(JETZT)
    expect(neu[1]?.status).toBe('offen')
  })

  test('ein Angebot schließt schon ab ANGEBOT_VERFALL', () => {
    const neu = veraltetSchliessen([
      punkt(1, { stufe: 'angebot', ohneBezug: ANGEBOT_VERFALL }),
      punkt(2, { stufe: 'angebot', ohneBezug: ANGEBOT_VERFALL - 1 }),
      punkt(3, { stufe: 'normal', ohneBezug: ANGEBOT_VERFALL }),
    ], JETZT)
    expect(neu.map(p => p.status)).toEqual(['erledigt', 'offen', 'offen'])
    expect(neu[0]?.auto).toBeDefined()
  })

  test('vom Nutzer, ruhend, zurückgestellt, ausstehend bleibt offen', () => {
    const n = VERALTET_NACH + 5
    const liste = [
      punkt(1, { ohneBezug: n, vonNutzer: true }),
      punkt(2, { ohneBezug: n, ruht: { sitzung: 's1' } }),
      punkt(3, { ohneBezug: n, zurueckgestellt: 1 }),
      punkt(4, { ohneBezug: n, ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung' } }),
    ]
    expect(veraltetSchliessen(liste, JETZT)).toEqual(liste)
  })
})

describe('zusammenfuehren: nicht neu anlegen, veraltet schließen', () => {
  const neuer = (titel: string) => ({ titel, art: 'aufgabe' as const, stufe: 'normal' as const, frage: 'Frage?', info: '', abwaegung: '', anleitung: '', optionen: [{ label: 'Ja', antwort: 'Ja.' }] })
  const id = () => 'neu1'

  test('Titel eines vor kurzem geschlossenen Punkts wird nicht neu angelegt', () => {
    const zu = punkt(1, { titel: 'Alter Punkt', status: 'erledigt', geaendert: JETZT - WIEDER_NEU_NACH_MS + TAG })
    const liste = zusammenfuehren([zu], { ...leer, neu: [neuer('Alter Punkt')] }, JETZT, id)
    expect(liste).toHaveLength(1)
  })

  test('Titel eines länger geschlossenen Punkts kommt neu dazu', () => {
    const zu = punkt(1, { titel: 'Alter Punkt', status: 'erledigt', geaendert: JETZT - WIEDER_NEU_NACH_MS - TAG })
    const liste = zusammenfuehren([zu], { ...leer, neu: [neuer('Alter Punkt')] }, JETZT, id)
    expect(liste).toHaveLength(2)
    expect(liste.filter(p => p.status === 'offen')).toHaveLength(1)
  })

  test('ein Punkt, der durch den Schritt VERALTET_NACH erreicht, wird geschlossen', () => {
    const liste = zusammenfuehren([punkt(1, { ohneBezug: VERALTET_NACH - 1 }), punkt(2, { ohneBezug: 0 })], leer, JETZT, id)
    const p1 = liste.find(p => p.id === 'p1')
    const p2 = liste.find(p => p.id === 'p2')
    expect(p1?.status).toBe('erledigt')
    expect(p1?.auto?.zeit).toBe(JETZT)
    expect(p2?.status).toBe('offen')
    expect(p2?.ohneBezug).toBe(1)
  })
})

describe('listeFuerClaude', () => {
  const s = { sitzung: 'a', jetzt: JETZT }

  test('leer, wenn nichts offen ist', () => {
    expect(listeFuerClaude([], s)).toBe('')
    expect(listeFuerClaude([punkt(1, { status: 'erledigt' })], s)).toBe('')
  })

  test('nennt Nummer und Titel, nicht fremde oder geschlossene Punkte', () => {
    const t = listeFuerClaude([
      punkt(1, { sitzung: 'a' }),
      punkt(2, { sitzung: 'b' }),
      punkt(3, { status: 'erledigt' }),
      punkt(4),
    ], s)
    expect(t).toContain('#1 Punkt 1')
    expect(t).toContain('#4 Punkt 4')
    expect(t).not.toContain('#2 ')
    expect(t).not.toContain('#3 ')
    expect(t).toContain('überholt: #')
  })
})

describe('zuletztGeschlossen', () => {
  test('neueste zuerst, begrenzt, ohne offene', () => {
    const liste = [
      punkt(1, { status: 'erledigt', geaendert: JETZT - 3 * TAG }),
      punkt(2, { status: 'erledigt', geaendert: JETZT - TAG }),
      punkt(3),
      punkt(4, { status: 'verworfen', geaendert: JETZT - 2 * TAG }),
    ]
    expect(zuletztGeschlossen(liste).map(p => p.nr)).toEqual([2, 4, 1])
    expect(zuletztGeschlossen(liste, 2).map(p => p.nr)).toEqual([2, 4])
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
    const a = abgleichAnfrage([punkt(3)], { commits: '', ueberblick: '', entschieden: '- Titel: Ja' })
    expect(a).toContain('SEITHER ENTSCHIEDEN')
    expect(a).toContain('- Titel: Ja')
  })

  test('anfrage mit geschlossenen Punkten enthält KÜRZLICH GESCHLOSSEN und den Titel', () => {
    const a = anfrage('Antwort', 'Hallo', [], '', [punkt(1, { titel: 'Schon zu', status: 'erledigt', ergebnis: 'Ja' })])
    expect(a).toContain('KÜRZLICH GESCHLOSSEN')
    expect(a).toContain('Schon zu')
  })
})
