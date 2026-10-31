// Reine Funktionen aus hooks/logik/marken.ts: Marken (erledigt/ueberholt) lesen und anwenden
import { describe, expect, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  AUTO_ZEIGEN_MS, ablageLesen, ablageText, autoErledigt, erledigtMarken, lies, markenHinweis, markenOhneTreffer, perMarkeSchliessen,
  schlussMarken, zusammenfuehren
} from '../hooks/logik'
import type { Auswertung } from '../hooks/logik'

// So 11.10.2026, 14:00 Ortszeit
const T = new Date(2026, 9, 11, 14, 0).getTime()

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

/** Eine Marke „erledigt: Titel“ (nr -1), optional als überholt und mit Grund. */
const marke = (titel: string, extra: { ueberholt?: boolean; grund?: string } = {}) => ({ nr: -1, ueberholt: false, grund: '', titel, ...extra })

const TAG = 24 * 3600_000

const JETZT = 100 * TAG

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
  erstellt: JETZT - 2 * TAG,
  ...extra,
})

const punktMarken = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel: `Punkt ${nr}`, frage: `Frage ${nr}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

const JETZT_MARKEN = 1_800_000_000_000

const HIER = 'sitzung-a'

const punktLogik = (id: string, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id,
  titel,
  frage: `${titel}?`,
  info: '',
  art: 'entscheidung',
  anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }],
  status: 'offen',
  zurueckgestellt: 0,
  erstellt: 1,
  ...extra,
})

describe('schlussMarken: Titel statt Nummer', () => {
  test('„erledigt: Titel“ am Zeilenanfang ist eine Marke ohne Nummer', () => {
    expect(schlussMarken('Neu gestartet.\nerledigt: Leitstand neu starten')).toEqual([
      { nr: -1, ueberholt: false, grund: '', titel: 'Leitstand neu starten' },
    ])
  })

  test('„überholt: Titel – Grund“ trennt Titel und Grund', () => {
    expect(schlussMarken('überholt: Logo einbauen – Plan geändert')).toEqual([
      { nr: -1, ueberholt: true, grund: 'Plan geändert', titel: 'Logo einbauen' },
    ])
  })

  test('Fettdruck, Anführungszeichen und Bindestrich als Trenner werden verstanden', () => {
    expect(schlussMarken('**hinfällig:** „Logo einbauen“ - Plan geändert')).toEqual([
      { nr: -1, ueberholt: true, grund: 'Plan geändert', titel: 'Logo einbauen' },
    ])
    expect(schlussMarken('  Erledigt: Leitstand neu starten')[0]?.titel).toBe('Leitstand neu starten')
  })

  test('Nummern und Titel stehen nebeneinander; „erledigt: #2“ bleibt Nummer, erledigtMarken nimmt nur Nummern', () => {
    const antwort = 'Fertig.\nerledigt: #2\nerledigt: Leitstand neu starten\nüberholt: #4 – Plan geändert'
    expect(schlussMarken(antwort)).toEqual([
      { nr: 2, ueberholt: false, grund: '' },
      { nr: 4, ueberholt: true, grund: 'Plan geändert' },
      { nr: -1, ueberholt: false, grund: '', titel: 'Leitstand neu starten' },
    ])
    expect(erledigtMarken(antwort)).toEqual([2, 4])
    expect(erledigtMarken('erledigt: Leitstand neu starten')).toEqual([])
  })

  test('mitten im Satz ist es keine Marke, und nichts stürzt ab', () => {
    expect(() => schlussMarken('Das ist erledigt: alles gut')).not.toThrow()
    expect(schlussMarken('Das ist erledigt: alles gut')).toEqual([])
    expect(schlussMarken('erledigt: alles gut')).toEqual([{ nr: -1, ueberholt: false, grund: '', titel: 'alles gut' }])
    expect(erledigtMarken('Das ist erledigt: alles gut')).toEqual([])
  })

  test('Randfälle: leer, zu lang, doppelt genannt', () => {
    expect(schlussMarken('erledigt:')).toEqual([])
    expect(schlussMarken('erledigt: „“')).toEqual([])
    expect(schlussMarken(`erledigt: ${'x'.repeat(81)}`)).toEqual([])
    // derselbe Titel in anderer Schreibweise zählt einmal
    expect(schlussMarken('erledigt: Logo einbauen\nErledigt: logo einbauen!')).toHaveLength(1)
  })
})

describe('perMarkeSchliessen: Marke mit Titel', () => {
  const liste = () => [punkt(1, 'Leitstand neu starten'), punkt(2, 'Freigabe Push'), punkt(3, 'Logo einbauen')]

  test('gleicher Titel (Groß/Klein und Satzzeichen egal) schließt genau diesen Punkt', () => {
    const l = liste()
    const r = perMarkeSchliessen(l, [marke('leitstand NEU starten!')], T)
    expect(r[0]).toMatchObject({ status: 'erledigt', auto: { zeit: T }, geaendert: T })
    expect(r[0]?.ergebnis).toStartWith('von Claude als erledigt gemeldet')
    expect(r[0]?.auto?.grund).toBe(r[0]?.ergebnis)
    // die anderen bleiben, wie sie sind
    expect(r[1]).toEqual(l[1])
    expect(r[2]).toEqual(l[2])
  })

  test('enthält der Titel des Punkts den der Marke (mindestens 8 Zeichen), schließt sie ebenfalls – auch umgekehrt', () => {
    const r = perMarkeSchliessen([punkt(1, 'Leitstand neu starten und prüfen'), punkt(2, 'Freigabe Push')], [marke('Leitstand neu starten')], T)
    expect(r.map(p => p.status)).toEqual(['erledigt', 'offen'])
    expect(r[0]?.ergebnis).toStartWith('von Claude als erledigt gemeldet')
    const umgekehrt = perMarkeSchliessen([punkt(1, 'Freigabe Push')], [marke('Freigabe Push für Version 2')], T)
    expect(umgekehrt[0]?.status).toBe('erledigt')
  })

  test('kurze Titel passen nur bei Gleichheit; die Grenze liegt bei 8 Zeichen', () => {
    // „Logo“ (4) steckt zwar in „Logo einbauen“, zählt aber nicht als Teil
    expect(perMarkeSchliessen([punkt(1, 'Logo einbauen'), punkt(2, 'Logo')], [marke('Logo')], T).map(p => p.status)).toEqual(['offen', 'erledigt'])
    // „Freigabe“ hat 8 Zeichen: genug; „Release“ hat 7: zu kurz
    expect(perMarkeSchliessen([punkt(1, 'Freigabe Push')], [marke('Freigabe')], T)[0]?.status).toBe('erledigt')
    expect(perMarkeSchliessen([punkt(1, 'Release planen')], [marke('Release')], T)[0]?.status).toBe('offen')
  })

  test('überholt mit Grund; Nummern und Titel zusammen; geschlossene und beantwortete Punkte bleiben unberührt', () => {
    const r = perMarkeSchliessen(liste(), [marke('Logo einbauen', { ueberholt: true, grund: 'Plan geändert' }), 2], T)
    expect(r[2]?.ergebnis).toBe('von Claude als überholt gemeldet – Plan geändert')
    expect(r[1]?.ergebnis).toBe('von Claude als erledigt gemeldet')
    expect(r[0]?.status).toBe('offen')

    const zu = punkt(1, 'Leitstand neu starten', { status: 'erledigt', ergebnis: 'alt' })
    const wartet = punkt(2, 'Freigabe Push', { ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung', reihe: 1 } })
    const gleich = [zu, wartet]
    expect(perMarkeSchliessen(gleich, [marke('Leitstand neu starten'), marke('Freigabe Push')], T)).toEqual(gleich)
  })
})

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
    const neu = perMarkeSchliessen([punktAktiv(1), punktAktiv(2)], [1], JETZT)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.ergebnis).toBe('von Claude als erledigt gemeldet')
    expect(neu[0]?.auto?.zeit).toBe(JETZT)
    expect(neu[0]?.geaendert).toBe(JETZT)
    expect(neu[1]).toEqual(punktAktiv(2))
  })

  test('Marke überholt: Ergebnis nennt überholt und den Grund', () => {
    const neu = perMarkeSchliessen([punktAktiv(4)], [{ nr: 4, ueberholt: true, grund: 'Plan geändert' }], JETZT)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.ergebnis).toContain('überholt')
    expect(neu[0]?.ergebnis).toContain('Plan geändert')
  })

  test('ausstehende und schon geschlossene Punkte bleiben unberührt', () => {
    const aus = punktAktiv(1, { ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung' } })
    const zu = punktAktiv(2, { status: 'erledigt', ergebnis: 'alt' })
    const liste = [aus, zu]
    expect(perMarkeSchliessen(liste, [1, 2], JETZT)).toEqual(liste)
  })
})

describe('Marken, locker geschrieben (G4)', () => {
  test('ohne Doppelpunkt, mit „Punkt“, Nummer voran', () => {
    expect(schlussMarken('erledigt #3').map(m => m.nr)).toEqual([3])
    expect(schlussMarken('erledigt: Punkt 4').map(m => m.nr)).toEqual([4])
    expect(schlussMarken('Damit ist #5 erledigt.').map(m => m.nr)).toEqual([5])
    expect(schlussMarken('#6 überholt').map(m => [m.nr, m.ueberholt])).toEqual([[6, true]])
    expect(schlussMarken('erledigt Punkt 7 und #8 erledigt').map(m => m.nr).sort()).toEqual([7, 8])
  })

  test('Prosa und Zahlen ohne Bezug sind keine Marken; die Doppelpunkt-Form behält den Grund', () => {
    expect(schlussMarken('Punkt 3 ist erledigt')).toEqual([])
    expect(schlussMarken('erledigt 3 Dinge')).toEqual([])
    expect(schlussMarken('erledigt: #3, #5 – alles drin')).toEqual([
      { nr: 3, ueberholt: false, grund: 'alles drin' },
      { nr: 5, ueberholt: false, grund: 'alles drin' },
    ])
  })
})

describe('Marken nur für eigene Punkte (0.16.7)', () => {
  test('eine Nummer aus einer anderen Sitzung schließt nichts', () => {
    const l = [punktMarken(1, { sitzung: 'sitzung-b' }), punktMarken(2, { sitzung: HIER }), punktMarken(3)]
    const r = perMarkeSchliessen(l, [1, 2, 3], JETZT_MARKEN, HIER)
    expect(r.map(p => p.status)).toEqual(['offen', 'erledigt', 'erledigt'])
  })

  test('ohne Sitzung wie bisher (Tests, claude -p)', () => {
    expect(perMarkeSchliessen([punktMarken(1, { sitzung: 'sitzung-b' })], [1], JETZT_MARKEN)[0]?.status).toBe('erledigt')
  })

  test('auch per Titel kein fremder Punkt', () => {
    const l = [punktMarken(1, { titel: 'Leitstand neu starten', sitzung: 'sitzung-b' })]
    expect(perMarkeSchliessen(l, schlussMarken('erledigt: Leitstand neu starten'), JETZT_MARKEN, HIER)[0]?.status).toBe('offen')
  })
})

describe('markenOhneTreffer: geratene Nummern fallen auf', () => {
  const l = [
    punktMarken(95, { titel: '0.16.6 pushen', sitzung: HIER }),
    punktMarken(96, { sitzung: HIER }),
    punktMarken(7, { sitzung: 'sitzung-b' }),
    punktMarken(8, { sitzung: HIER, status: 'erledigt', ergebnis: 'alt', geaendert: JETZT_MARKEN - 10_000 }),
  ]

  test('getroffene Marken melden nichts', () => {
    expect(markenOhneTreffer(l, schlussMarken('erledigt: #95, #96'), HIER, JETZT_MARKEN)).toEqual([])
  })

  test('nicht vorhanden, fremd, schon zu und unbekannter Titel', () => {
    const marken = schlussMarken('erledigt: #1, #7, #8\nerledigt: Gibt es gar nicht')
    expect(markenOhneTreffer(l, marken, HIER, JETZT_MARKEN)).toEqual([
      '#1 gibt es nicht',
      '#7 gehört einer anderen Sitzung',
      '#8 „Punkt 8“ war schon geschlossen',
      '„Gibt es gar nicht“ passt zu keinem offenen Punkt',
    ])
  })

  test('der Nutzer war schneller: seit der letzten Nachricht geschlossen oder Antwort unterwegs zählt als Treffer', () => {
    const frisch = [
      punktMarken(8, { sitzung: HIER, status: 'erledigt', ergebnis: 'Ja', geaendert: JETZT_MARKEN + 5 }),
      punktMarken(9, { sitzung: HIER, ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung' } }),
    ]
    expect(markenOhneTreffer(frisch, schlussMarken('erledigt: #8, #9'), HIER, JETZT_MARKEN)).toEqual([])
  })

  test('beantwortet und bei Claude ist ein Treffer', () => {
    const bei = [punktMarken(4, { sitzung: HIER, status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT_MARKEN - 10_000 })]
    expect(markenOhneTreffer(bei, schlussMarken('erledigt: #4'), HIER, JETZT_MARKEN)).toEqual([])
  })

  test('der Hinweis an Claude nennt die eigenen offenen Nummern, keine fremden', () => {
    const h = markenHinweis(['#1 gibt es nicht'], l, HIER)
    expect(h).toContain('#1 gibt es nicht')
    expect(h).toContain('#95 „0.16.6 pushen“')
    expect(h).toContain('#96')
    expect(h).not.toContain('#7')
    expect(h).toContain('nie raten')
    expect(markenHinweis([], l, HIER)).toBe('')
  })
})

describe('Selbst als erledigt erkennen (0.11.0)', () => {
  test('erledigt kommt als ID oder mit Grund; der Grund steht am Punkt', async () => {
    const a = lies('{"neu":[],"erledigt":["p1",{"id":"p2","grund":"Nutzer macht weiter, kein Fehler"}],"erwaehnt":[]}')
    expect(a?.erledigt).toEqual(['p1', 'p2'])
    expect(a?.gruende).toEqual({ p2: 'Nutzer macht weiter, kein Fehler' })
    const liste = zusammenfuehren([punktLogik('p1', 'A'), punktLogik('p2', 'B'), punktLogik('p3', 'C')], a as Auswertung, 500, () => 'x')
    const [p1, p2, p3] = ['p1', 'p2', 'p3'].map(id => liste.find(p => p.id === id))
    expect(p1?.auto).toEqual({ grund: 'laut Gespräch erledigt', zeit: 500 })
    expect(p2?.ergebnis).toBe('laut Gespräch erledigt – Nutzer macht weiter, kein Fehler')
    expect(p2?.auto?.grund).toBe('Nutzer macht weiter, kein Fehler')
    // Gegenprobe: nicht genannt bleibt offen und ohne Zeichen
    expect(p3?.status).toBe('offen')
    expect(p3?.auto).toBeUndefined()
  })

  test('„erledigt: #N“ in Claudes Antwort: Nummern, auch mehrere; sonst keine', async () => {
    expect(erledigtMarken('Fertig.\nerledigt: #3, #5 und #7')).toEqual([3, 5, 7])
    expect(erledigtMarken('Erledigt: #12')).toEqual([12])
    // Gegenproben: ohne Doppelpunkt und Raute kein Treffer
    expect(erledigtMarken('Punkt 3 ist erledigt, #4 noch nicht')).toEqual([])
    expect(erledigtMarken('Das ist erledigt: alles gut')).toEqual([])
  })

  test('per Marke schließt nur offene Punkte mit dieser Nummer, nicht beantwortete', async () => {
    const liste = [punktLogik('a', 'A', { nr: 3 }), punktLogik('b', 'B', { nr: 4 }),
      punktLogik('c', 'C', { nr: 5, ausstehend: { status: 'erledigt', ergebnis: 'x', text: 'x', wo: 'sammlung', reihe: 1 } })]
    const neu = perMarkeSchliessen(liste, [3, 5, 9], 100)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.auto?.grund).toBe('von Claude als erledigt gemeldet')
    expect(neu[1]?.status).toBe('offen')
    expect(neu[2]?.status).toBe('offen')
  })

  test('automatisch erledigte: 24 h sichtbar, überstehen die Datei, eigenes Zeichen', async () => {
    const zu = punktLogik('a', 'Seite neu laden', { nr: 1, status: 'erledigt', ergebnis: 'x', auto: { grund: 'stilles OK', zeit: 1000 } })
    const vonHand = punktLogik('b', 'B', { nr: 2, status: 'erledigt', ergebnis: 'als erledigt markiert' })
    expect(autoErledigt([zu, vonHand], 2000).map(p => p.id)).toEqual(['a'])
    expect(autoErledigt([zu], 1000 + AUTO_ZEIGEN_MS)).toEqual([])
    const datei = ablageText({ punkte: [zu, vonHand], ueberblick: '' }, 2000)
    expect(datei).toContain('- 🤖 Seite neu laden')
    expect(datei).toContain('- ✓ B')
    expect(ablageLesen(datei)?.punkte.find(p => p.id === 'a')?.auto).toEqual({ grund: 'stilles OK', zeit: 1000 })
  })
})
