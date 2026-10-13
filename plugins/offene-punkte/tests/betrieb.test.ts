import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  VERSION, ablageDaten, ablageLesen, ablageText, ausfuehrBitte, bitteZu, datum, eingetippteAntworten, entscheidungenAus, erledigtMarken,
  istMaschinenEingabe, klaerungsBitte, kommando, kostenZeile, perMarkeSchliessen, schlussMarken, verlaufKopf, verlaufsEintraege, zuletztFertig,
} from '../hooks/logik'

type Eng = Parameters<TestBody>[0]

// So 11.10.2026, 14:00 Ortszeit
const T = new Date(2026, 9, 11, 14, 0).getTime()

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

/** Eine Marke „erledigt: Titel“ (nr -1), optional als überholt und mit Grund. */
const marke = (titel: string, extra: { ueberholt?: boolean; grund?: string } = {}) => ({ nr: -1, ueberholt: false, grund: '', titel, ...extra })

// ---------------------------------------------------------------- A) reine Funktionen

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

describe('kommando: antwort, alle, klären', () => {
  test('„<Nr> antwort <Text>“ behält den Text, wie er geschrieben wurde', () => {
    expect(kommando('3 antwort Ja, aber erst morgen')).toEqual({ art: 'punkt', nummer: 3, tun: 'antwort', text: 'Ja, aber erst morgen' })
    expect(kommando('12 ANTWORT  Nimm Variante B ')).toEqual({ art: 'punkt', nummer: 12, tun: 'antwort', text: 'Nimm Variante B' })
    expect(kommando('3 antwort Zeile eins\nZeile zwei')).toEqual({ art: 'punkt', nummer: 3, tun: 'antwort', text: 'Zeile eins\nZeile zwei' })
  })

  test('„<Nr> antwort“ ohne Text ist ein Fehler mit Hinweis', () => {
    const k = kommando('3 antwort')
    expect(k.art).toBe('fehler')
    expect((k as { text: string }).text).toContain('antwort')
    expect(kommando('3 antwort   ').art).toBe('fehler')
  })

  test('„alle weg|erledigt [Grund]“', () => {
    expect(kommando('alle weg Aufgeräumt')).toEqual({ art: 'alle', tun: 'weg', grund: 'Aufgeräumt' })
    expect(kommando('alle erledigt')).toEqual({ art: 'alle', tun: 'erledigt', grund: '' })
    expect(kommando('alle verwerfen Alles alt')).toEqual({ art: 'alle', tun: 'weg', grund: 'Alles alt' })
    expect(kommando('Alle Fertig')).toEqual({ art: 'alle', tun: 'erledigt', grund: '' })
  })

  test('„klären“ und „klaeren“', () => {
    expect(kommando('klären')).toEqual({ art: 'klaeren' })
    expect(kommando('klaeren')).toEqual({ art: 'klaeren' })
    expect(kommando(' Klären ')).toEqual({ art: 'klaeren' })
  })
})

describe('eingetippteAntworten', () => {
  const offen = () => [punkt(12, 'Freigabe Push'), punkt(5, 'Logo einbauen')]

  test('„Zum offenen Punkt „Titel“: Text“', () => {
    expect(eingetippteAntworten('Zum offenen Punkt „Freigabe Push“: Ja, push.', offen())).toEqual([{ id: 'p12', text: 'Ja, push.' }])
    // Titel in anderer Schreibweise
    expect(eingetippteAntworten('Zum offenen Punkt „freigabe push!“: Nein', offen())).toEqual([{ id: 'p12', text: 'Nein' }])
  })

  test('mit Nummer: die Nummer findet den Punkt, auch wenn der Titel abweicht', () => {
    expect(eingetippteAntworten('Zum offenen Punkt #12 „Ganz anderer Titel“: Nimm B', offen())).toEqual([{ id: 'p12', text: 'Nimm B' }])
    expect(eingetippteAntworten('Zum offenen Punkt #12 „Freigabe Push“: Nimm B', offen())).toEqual([{ id: 'p12', text: 'Nimm B' }])
  })

  test('die Nummer gewinnt, wenn der Titel zu einem anderen Punkt passt', () => {
    // #5 ist „Logo einbauen“; „Freigabe Push“ (#12) steht in der Liste vorn, weil er älter ist
    const liste = [punkt(12, 'Freigabe Push', { erstellt: 1 }), punkt(5, 'Logo einbauen', { erstellt: 9 })]
    expect(eingetippteAntworten('Zum offenen Punkt #5 „Freigabe Push“: Text', liste)).toEqual([{ id: 'p5', text: 'Text' }])
  })

  test('Zeilen „- „Titel“: Text“ unter „Zu den offenen Punkten:“, in der Reihenfolge der Nachricht', () => {
    const nachricht = 'Zu den offenen Punkten:\n- „Logo einbauen“: Später.\n- „Freigabe Push“: Ja, push.\n  - #12 „Freigabe Push“ (aus B): doppelt'
    expect(eingetippteAntworten(nachricht, offen())).toEqual([
      { id: 'p5', text: 'Später.' },
      { id: 'p12', text: 'Ja, push.' },
    ])
  })

  test('nur offene, noch nicht beantwortete Punkte', () => {
    const liste = [
      punkt(1, 'Alpha', { status: 'erledigt' }),
      punkt(2, 'Beta', { ausstehend: { status: 'erledigt', ergebnis: 'x', text: 'x', wo: 'eingabe', reihe: 1 } }),
      punkt(3, 'Gamma'),
    ]
    expect(eingetippteAntworten('Zu den offenen Punkten:\n- „Alpha“: a\n- „Beta“: b\n- „Gamma“: c', liste)).toEqual([{ id: 'p3', text: 'c' }])
    expect(eingetippteAntworten('Zum offenen Punkt „Alpha“: a', liste)).toEqual([])
  })

  test('ohne „offenen Punkt“ in der Nachricht, ohne offene Punkte, ohne passenden Titel: leer', () => {
    expect(eingetippteAntworten('- „Freigabe Push“: Ja', offen())).toEqual([])
    expect(eingetippteAntworten('Zum Punkt „Freigabe Push“: Ja', offen())).toEqual([])
    expect(eingetippteAntworten('Zum offenen Punkt „Freigabe Push“: Ja', [])).toEqual([])
    expect(eingetippteAntworten('Zum offenen Punkt „Unbekannt“: Ja', offen())).toEqual([])
  })

  test('derselbe Punkt nur einmal – die erste Antwort zählt', () => {
    const nachricht = 'Zum offenen Punkt „Freigabe Push“: erste\nZum offenen Punkt #12 „Freigabe Push“: zweite'
    expect(eingetippteAntworten(nachricht, offen())).toEqual([{ id: 'p12', text: 'erste' }])
  })

  test('die Ausführen-Bitte (ausfuehrBitte) ist keine Antwort: der Punkt bleibt offen', () => {
    // register.tsx (waehlen, BEFEHL): „Der Punkt bleibt offen“ – die Bitte hat dasselbe Muster wie eine eigene Antwort.
    expect(eingetippteAntworten(ausfuehrBitte('Freigabe Push', 'make deploy'), offen())).toEqual([])
  })
})

describe('verlaufsEintraege: kurz bei automatisch Geschlossenem', () => {
  const lang = (extra: Partial<Punkt> = {}) => punkt(4, 'Seite neu laden', {
    info: 'Nach dem Umbau.', abwaegung: 'Cache leeren hilft', art: 'aufgabe',
    optionen: [{ label: 'Ja', antwort: 'Ja.' }, { label: 'Nein', antwort: '' }], ...extra,
  })
  const geschlossen = (p: Punkt, extra: Partial<Punkt>): Punkt => ({ ...p, status: 'erledigt', ...extra })

  test('mit auto: Überschrift „– automatisch geschlossen“, nur Frage und Ergebnis', () => {
    const vorher = lang()
    const nachher = geschlossen(vorher, { ergebnis: 'laut Gespräch erledigt – neu geladen', auto: { grund: 'neu geladen', zeit: T } })
    const e = verlaufsEintraege([vorher], [nachher], T)
    expect(e).toHaveLength(1)
    expect(e[0]).toBe(
      '## 14:00 · #4 Seite neu laden – automatisch geschlossen\n\n**Frage:** Seite neu laden?\n\n**Ergebnis:** laut Gespräch erledigt – neu geladen\n',
    )
    expect(e[0]).not.toContain('**Möglichkeiten:**')
    expect(e[0]).not.toContain('**Abwägung:**')
  })

  test('steht „überholt“ im Ergebnis, heißt es „– überholt“', () => {
    const vorher = lang()
    const nachher = geschlossen(vorher, { ergebnis: 'von Claude als überholt gemeldet – Plan geändert', auto: { grund: 'x', zeit: T } })
    const e = verlaufsEintraege([vorher], [nachher], T)[0] ?? ''
    expect(e).toContain('· #4 Seite neu laden – überholt\n')
    expect(e).toContain('**Ergebnis:** von Claude als überholt gemeldet – Plan geändert')
    expect(e).not.toContain('**Möglichkeiten:**')
  })

  test('Ergebnis mit „gesammelt “ am Anfang ist ebenfalls kurz – auch ohne auto', () => {
    const vorher = lang()
    const erledigt = verlaufsEintraege([vorher], [geschlossen(vorher, { ergebnis: 'gesammelt erledigt – Aufgeräumt' })], T)[0] ?? ''
    expect(erledigt).toContain('· #4 Seite neu laden – automatisch geschlossen\n')
    expect(erledigt).toContain('**Ergebnis:** gesammelt erledigt – Aufgeräumt')
    expect(erledigt).not.toContain('**Möglichkeiten:**')
    expect(erledigt).not.toContain('**Abwägung:**')

    const verworfen = verlaufsEintraege([vorher], [geschlossen(vorher, { status: 'verworfen', ergebnis: 'gesammelt verworfen – Aufgeräumt' })], T)[0] ?? ''
    expect(verworfen).toContain('· #4 Seite neu laden – verworfen\n')
    expect(verworfen).toContain('**Ergebnis:** gesammelt verworfen – Aufgeräumt')
    expect(verworfen).not.toContain('**Möglichkeiten:**')
  })

  test('vom Nutzer entschieden (ohne auto): der volle Eintrag mit Möglichkeiten und Abwägung', () => {
    const vorher = lang({ art: 'entscheidung' })
    const e = verlaufsEintraege([vorher], [geschlossen(vorher, { ergebnis: 'Ja – „Ja.“' })], T)[0] ?? ''
    expect(e).toContain('## 14:00 · #4 Seite neu laden – entschieden')
    expect(e).toContain('**Warum offen:** Nach dem Umbau.')
    expect(e).toContain('**Abwägung:** Cache leeren hilft')
    expect(e).toContain('**Möglichkeiten:**\n   a) Ja – „Ja.“\n   b) Nein')
    expect(e).toContain('**Ergebnis:** Ja – „Ja.“')
    // eine Aufgabe heißt „erledigt“, nicht „entschieden“
    const aufgabe = verlaufsEintraege([lang()], [geschlossen(lang(), { ergebnis: 'als erledigt markiert' })], T)[0] ?? ''
    expect(aufgabe).toContain('– erledigt\n')
    expect(aufgabe).toContain('**Möglichkeiten:**')
  })
})

describe('zuletztFertig', () => {
  const liste = [
    punkt(1, 'A', { status: 'erledigt', geaendert: 100 }),
    punkt(2, 'B', { status: 'verworfen', geaendert: 300 }),
    punkt(3, 'C'),
    punkt(4, 'D', { status: 'erledigt', erstellt: 200 }),
    punkt(5, 'E', { status: 'erledigt', geaendert: 50, erstellt: 999 }),
  ]

  test('geschlossene nach geaendert (sonst erstellt), neueste zuerst, ohne offene', () => {
    expect(zuletztFertig(liste).map(p => p.nr)).toEqual([2, 4, 1, 5])
  })

  test('höchstens n – ohne Angabe acht', () => {
    expect(zuletztFertig(liste, 2).map(p => p.nr)).toEqual([2, 4])
    const viele = Array.from({ length: 12 }, (_, i) => punkt(i + 1, `P${i}`, { status: 'erledigt', geaendert: i }))
    const acht = zuletztFertig(viele)
    expect(acht).toHaveLength(8)
    expect(acht[0]?.nr).toBe(12)
  })
})

describe('Ablage: Fassung, Stand und Rundlauf', () => {
  test('ablageDaten ist JSON mit version und stand', () => {
    const a = { punkte: [punkt(1, 'A'), punkt(2, 'B', { status: 'erledigt', ergebnis: 'Ja' })], ueberblick: '- **Ziel:** x', hoechsteNr: 5 }
    const d = JSON.parse(ablageDaten(a, T)) as Record<string, unknown>
    expect(d.version).toBe(VERSION)
    expect(d.stand).toBe(T)
    expect(d.hoechsteNr).toBe(5)
    expect(d.ueberblick).toBe('- **Ziel:** x')
    expect(d.punkte).toHaveLength(2)
    // offen.md trägt im Datenblock dieselben Felder
    expect(ablageText(a, T)).toContain(`"version":"${VERSION}","stand":${T}`)
  })

  test('ohne Zählerstand zählt die höchste Nummer in der Liste', () => {
    const d = JSON.parse(ablageDaten({ punkte: [punkt(3, 'A'), punkt(7, 'B')], ueberblick: '' }, T)) as { hoechsteNr: number }
    expect(d.hoechsteNr).toBe(7)
  })

  test('ablageLesen(ablageText(...)) liefert die Punkte unverändert zurück – version und stand stören nicht', () => {
    const punkte = [
      punkt(1, 'Freigabe Push', { info: 'Getestet', abwaegung: 'Ruhiger Tag', anleitung: '1. `git push`', stufe: 'blockiert', sitzung: 'A', ohneBezug: 2, geprueft: 5, ruht: { bis: T + 3_600_000 } }),
      punkt(2, 'Notiz', { optionen: [], vonNutzer: true, art: 'aufgabe' }),
      punkt(3, 'Seite neu laden', { status: 'erledigt', ergebnis: 'laut Gespräch erledigt', auto: { grund: 'laut Gespräch erledigt', zeit: T }, geaendert: T }),
      punkt(4, 'Logo', { status: 'verworfen', ergebnis: 'nicht relevant', geaendert: T - 5 }),
    ]
    const a = ablageLesen(ablageText({ punkte, ueberblick: '- **Ziel:** x', hoechsteNr: 9 }, T))
    expect(a?.punkte).toEqual(punkte)
    expect(a?.ueberblick).toBe('- **Ziel:** x')
    expect(a?.hoechsteNr).toBe(9)
  })

  test('mehrfach (Kästchen statt Entweder-oder) übersteht die Datei', () => {
    const p = punkt(1, 'Welche Erweiterungen', { mehrfach: true, optionen: [{ label: 'A', antwort: 'Nimm A.' }, { label: 'B', antwort: 'Nimm B.' }] })
    expect(ablageText({ punkte: [p], ueberblick: '' }, T)).toContain('(mehrere möglich)')
    expect(ablageLesen(ablageText({ punkte: [p], ueberblick: '' }, T))?.punkte[0]?.mehrfach).toBe(true)
  })
})

describe('istMaschinenEingabe', () => {
  test('Klärung und Cache-Hinweis sind Maschinen-Eingaben', () => {
    expect(istMaschinenEingabe('Automatische Klärung: Punkte #1 und #2 durchgehen')).toBe(true)
    expect(istMaschinenEingabe('Automatische Klaerung der offenen Punkte')).toBe(true)
    expect(istMaschinenEingabe('Vor Ablauf des Caches: bitte kurz antworten')).toBe(true)
    expect(istMaschinenEingabe('  automatische klärung der offenen punkte')).toBe(true)
  })

  test('normale Nachrichten nicht', () => {
    expect(istMaschinenEingabe('weiter')).toBe(false)
    expect(istMaschinenEingabe('')).toBe(false)
    expect(istMaschinenEingabe('Zum offenen Punkt „Freigabe Push“: Ja')).toBe(false)
    expect(istMaschinenEingabe('Bitte mach eine Automatische Klärung der Punkte')).toBe(false)
    expect(istMaschinenEingabe('Klärung der offenen Punkte')).toBe(false)
    expect(istMaschinenEingabe('Vor dem Ablauf des Caches')).toBe(false)
  })
})

describe('Bitten und Kostenzeile', () => {
  test('klaerungsBitte: beginnt mit „Automatische Klärung“, nennt Nummer und Titel, verlangt „erledigt: #N“', () => {
    const t = klaerungsBitte([punkt(3, 'Leitstand neu starten'), punkt(4, 'Logo einbauen')])
    expect(t).toStartWith('Automatische Klärung')
    expect(t).toContain('#3 Leitstand neu starten')
    expect(t).toContain('#4 Logo einbauen')
    expect(t).toContain('erledigt: #N')
    // Die Bitte muss selbst als Maschinen-Eingabe gelten, sonst würde ihre Antwort ausgewertet.
    expect(istMaschinenEingabe(t)).toBe(true)
  })

  test('bitteZu nennt den Titel; „Selbst klären“ verlangt die Marke mit Nummer, ohne Nummer mit Titel', () => {
    const mit = punkt(3, 'Leitstand neu starten')
    const ohne = { ...punkt(3, 'Leitstand neu starten'), nr: undefined }
    for (const art of ['erklaeren', 'interview', 'klaeren'] as const) {
      expect(bitteZu(art, mit)).toContain('„Leitstand neu starten“')
      expect(bitteZu(art, ohne)).toContain('„Leitstand neu starten“')
      expect(istMaschinenEingabe(bitteZu(art, mit))).toBe(false)
    }
    expect(bitteZu('interview', mit)).toContain('Planungsinterview')
    expect(bitteZu('klaeren', mit)).toContain('erledigt: #3')
    expect(bitteZu('klaeren', ohne)).toContain('erledigt: Leitstand neu starten')
    // die genannte Marke ohne Nummer wird von schlussMarken auch gelesen
    expect(schlussMarken('erledigt: Leitstand neu starten')[0]?.titel).toBe('Leitstand neu starten')
  })

  test('kostenZeile: eingabe = input + cache_creation, cache, ausgabe, art, sitzung, version', () => {
    const z = JSON.parse(kostenZeile('nachfassen', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }, 'sitzung-1', T)) as Record<string, unknown>
    expect(z).toEqual({ zeit: new Date(T).toISOString(), sitzung: 'sitzung-1', art: 'nachfassen', eingabe: 12, cache: 3, ausgabe: 5, version: VERSION })
  })
})

describe('entscheidungenAus', () => {
  const eintrag = (vorher: Punkt, nachher: Partial<Punkt>) => verlaufsEintraege([vorher], [{ ...vorher, status: 'erledigt', ...nachher }], T)

  test('liest auch Überschriften mit zweiwortigem Stand („– automatisch geschlossen“)', () => {
    const e = eintrag(punkt(4, 'Seite neu laden'), { ergebnis: 'laut Gespräch erledigt – neu geladen', auto: { grund: 'neu geladen', zeit: T } })
    const verlauf = `${verlaufKopf(T)}\n${e.join('\n')}`
    expect(verlauf).toContain('– automatisch geschlossen')
    expect(entscheidungenAus([verlauf])).toBe('- Seite neu laden: laut Gespräch erledigt – neu geladen')
  })

  test('Einwort-Stand, Titel mit Gedankenstrich und mehrere Einträge zusammen', () => {
    const lang = eintrag(punkt(1, 'Variante A – B', { art: 'entscheidung' }), { ergebnis: 'Ja – „Ja.“' })
    const kurz = eintrag(punkt(2, 'Mail einrichten'), { ergebnis: 'gesammelt verworfen – Aufgeräumt', status: 'verworfen' })
    const verlauf = `${verlaufKopf(T)}\n${[...lang, ...kurz].join('\n')}`
    expect(entscheidungenAus([verlauf])).toBe('- Variante A – B: Ja – „Ja.“\n- Mail einrichten: gesammelt verworfen – Aufgeräumt')
  })
})

// ---------------------------------------------------------------- B) Engine

const OFFEN = '/projekt/offene-punkte/offen.md'
const KOSTEN = '/projekt/offene-punkte/kosten.jsonl'

// Unter Windows reicht die Engine Pfade als C:\projekt\... an die fs-Hooks; die Schlüssel der Maps bleiben POSIX.
const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

type Umgebung = {
  /** Was in der Eingabezeile steht (prompt.read). */
  box?: { text: string }
  /** Nimmt die Eingabezeile Text von prompt.fill an? Aus: isFilled false (Dialog, headless). */
  fuellbar?: boolean
  /** Ob ein Pane gesetzt ist (ui.open). */
  pane?: { isPlaced: boolean }
}

function grundlage(on: On, dateien: Map<string, string>, umgebung: Umgebung = {}) {
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

const band = {
  plugin: 'offene-punkte', component: 'AbovePrompt' as const, surface: 'terminal' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19, contentRows: 0 } },
}

const call = ($: Eng, input: unknown) =>
  $.tool.call({ tool: 'mcp__offene-punkte__punkte', input } as never) as Promise<{ text?: string; isError?: boolean }>

const fertig = ($: Eng, answer: string) =>
  $.turn.complete({ answer, reason: 'answer', durationMs: 1000, isAborted: false, turnId: 't1' } as never)

const eingabe = ($: Eng, text: string, kind: string) => $.prompt.submit({ text, origin: { kind } } as never)

const befehl = async ($: Eng, args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

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

const gespeichert = (dateien: Map<string, string>) => ablageLesen(String(dateien.get(OFFEN)))?.punkte ?? []

/** Steht eine Frage mit diesem Text über der Eingabe? */
async function frageZeigt($: Eng, muster: RegExp) {
  const ui = await $.ui.mount(band as never)
  const gefunden = await ui.find({ type: 'Text', text: muster })
  await ui.unmount()
  return gefunden !== undefined
}

const FREIGABE = { titel: 'Freigabe Push', art: 'entscheidung', frage: 'Darf ich pushen?', optionen: [{ label: 'Ja, pushen', antwort: 'Ja, push.' }] }
const LOGO = { titel: 'Logo einbauen', art: 'entscheidung', frage: 'Soll das Logo rein?', optionen: [{ label: 'Ja', antwort: 'Ja, einbauen.' }] }
const EINS = { neu: [FREIGABE] }
const ZWEI = { neu: [FREIGABE, LOGO] }

describe('Eingaben von Maschinen', () => {
  const FRAGE = 'Alles gebaut. Soll ich pushen?'

  test('Peer-Nachricht: die Antwort darauf wird nicht ausgewertet; die nächste Eingabe des Nutzers wieder', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    grundlage(on, new Map())
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
      const uhr = mock.clock(on, { now: T })
      grundlage(on, new Map())
      const anfragen = haiku(on)
      gesendet(on)
      await eingabe($, 'Hallo vom Zeitplan', kind)
      await fertig($, FRAGE)
      await uhr.settle()
      expect(anfragen.length).toBe(0)
    })
  }

  test('„Automatische Klärung …“ aus der Eingabe: keine Auswertung, aber „erledigt: #1“ schließt; danach wertet eine normale Eingabe wieder aus', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    const anfragen = haiku(on)
    gesendet(on)

    await call($, ZWEI)
    // Die Werkzeugnutzung gehört zu dieser Antwort; sie soll unten nicht der Grund für „kein Haiku“ sein.
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
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    const anfragen = haiku(on)
    const texte = gesendet(on)
    await call($, ZWEI)
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

  // Das Werkzeug gibt es nur im Modus „werkzeug“ (Option eintrag; Standard ist der Block in der Antwort).
  for (const [isInteractive, erwartet] of [[false, 0], [true, 1]] as const) {
    test(`Modus werkzeug: session.start mit isInteractive: ${isInteractive} registriert das Werkzeug ${erwartet}-mal`, { options: { eintrag: 'werkzeug' } }, async ($, on) => {
      const uhr = mock.clock(on, { now: T })
      grundlage(on, new Map())
      const werkzeug = werkzeugZaehler(on)
      await $.session.start({ cwd: '/projekt', surface: isInteractive ? 'terminal' : null, isInteractive } as never)
      await uhr.settle()
      expect(werkzeug.n).toBe(erwartet)
    })
  }

  test('Standard (eintrag: block): auch mit Menschen kein Werkzeug im Katalog', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    grundlage(on, new Map())
    const werkzeug = werkzeugZaehler(on)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    expect(werkzeug.n).toBe(0)
  })

  test('bleibt still: kein Haiku, kein Hinweis im Kontext – nur die Marken schließen und die Datei wird geschrieben', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map([[OFFEN, ablageText({ punkte: [punkt(1, 'Freigabe Push')], ueberblick: '' }, 1)]])
    grundlage(on, dateien)
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
    const uhr = mock.clock(on, { now: T })
    grundlage(on, new Map())
    on('prompt.context', (_, e) => ({ blocks: e.blocks }) as never)
    await $.session.start({ cwd: '/projekt', surface: 'terminal', isInteractive: true } as never)
    await uhr.settle()
    expect(JSON.stringify(await $.prompt.context({ blocks: [] } as never))).toContain('offenePunkte')
  })
})

describe('/offen <Nr> antwort <Text>', () => {
  const ANTWORT = 'Erst morgen, dann ja'

  // Die Antwort ist die letzte offene Frage, also läuft alleBeantwortet: Ist die Eingabezeile leer und lässt sich füllen
  // (der Normalfall im Terminal), legt es die Antwort dort ab (ausstehend.wo = „eingabe“) und zählt 5 s herunter. Danach ruft
  // offenKommando senden() auf – das sieht nur „sammlung“ und hält zudem den Countdown an: die Nachricht bleibt in der
  // Eingabe liegen, obwohl der Befehl „geht an Claude“ meldet. Nur in den ersten beiden Fällen geht sie sofort hinaus.
  for (const [fall, umgebung] of [
    ['Eingabezeile belegt', { box: { text: 'halb getippt' } }],
    ['Eingabezeile nicht beschreibbar', { fuellbar: false }],
    ['Eingabezeile leer und beschreibbar', {}],
  ] as const) {
    test(`geht sofort an Claude und schließt den Punkt (${fall})`, async ($, on) => {
      const uhr = mock.clock(on, { now: T })
      const dateien = new Map<string, string>()
      grundlage(on, dateien, umgebung)
      const texte = gesendet(on)
      await call($, EINS)

      const r = await befehl($, `1 antwort ${ANTWORT}`)
      await uhr.settle()
      expect(r).toContain('geht an Claude')
      expect(texte).toEqual([`Zum offenen Punkt „${FREIGABE.titel}“: ${ANTWORT}`])

      expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(false)
      expect(await befehl($, '')).toBe(`Nichts offen.\n\nDatei: /projekt/offene-punkte/offen.md · Verlauf: antworten-JJJJ-MM-TT.md`)
      expect(gespeichert(dateien)[0]).toMatchObject({ status: 'erledigt', ergebnis: `eigene Antwort – „${ANTWORT}“` })
      expect(String(dateien.get(OFFEN))).toContain(`- ✓ ${FREIGABE.titel}: eigene Antwort – „${ANTWORT}“`)
      expect(String(dateien.get(`/projekt/offene-punkte/antworten-${datum(T)}.md`))).toContain(`**Ergebnis:** eigene Antwort – „${ANTWORT}“`)
    })
  }

  test('ohne Text oder für einen unbekannten Punkt wird nichts gesendet', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    grundlage(on, new Map(), { fuellbar: false })
    const texte = gesendet(on)
    await call($, EINS)
    expect(await befehl($, '1 antwort')).toContain('Verwendung')
    expect(await befehl($, '7 antwort Hallo')).toBe('Punkt 7 gibt es nicht – /offen zeigt die Nummern.')
    await uhr.settle()
    expect(texte).toEqual([])
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(true)
  })
})

describe('/offen alle weg|erledigt', () => {
  test('„alle weg Aufgeräumt“: alle verworfen, der Verlauf hat Kurzeinträge', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    await call($, ZWEI)

    expect(await befehl($, 'alle weg Aufgeräumt')).toBe('2 Punkte verworfen.')
    await uhr.settle()
    expect(await frageZeigt($, /Darf ich pushen\?|Soll das Logo rein\?/)).toBe(false)
    expect(gespeichert(dateien).map(p => p.status)).toEqual(['verworfen', 'verworfen'])

    const verlauf = String(dateien.get(`/projekt/offene-punkte/antworten-${datum(T)}.md`))
    expect(verlauf).toContain('· #1 Freigabe Push – verworfen')
    expect(verlauf).toContain('· #2 Logo einbauen – verworfen')
    expect(verlauf.split('gesammelt verworfen – Aufgeräumt')).toHaveLength(3)
    expect(verlauf).not.toContain('**Möglichkeiten:**')
    expect(verlauf).not.toContain('**Abwägung:**')

    expect(await befehl($, 'alle weg')).toBe('Es ist nichts offen.')
  })

  test('„alle erledigt“: Kurzeinträge „automatisch geschlossen“, ohne Möglichkeiten', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    await call($, ZWEI)

    expect(await befehl($, 'alle erledigt')).toBe('2 Punkte erledigt.')
    await uhr.settle()
    const verlauf = String(dateien.get(`/projekt/offene-punkte/antworten-${datum(T)}.md`))
    expect(verlauf).toContain('· #1 Freigabe Push – automatisch geschlossen')
    expect(verlauf).toContain('**Ergebnis:** gesammelt erledigt')
    expect(verlauf).not.toContain('**Möglichkeiten:**')
  })
})

describe('Getippte Antworten', () => {
  test('„Zum offenen Punkt „Titel“: Text“ schließt den Punkt mit der Nachricht', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    const texte = gesendet(on)
    await call($, EINS)
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(true)

    await eingabe($, `Zum offenen Punkt „${FREIGABE.titel}“: Nimm Variante B`, 'composer')
    await uhr.settle()
    expect(texte).toEqual([`Zum offenen Punkt „${FREIGABE.titel}“: Nimm Variante B`])
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(false)
    expect(gespeichert(dateien)[0]).toMatchObject({ status: 'erledigt', ergebnis: 'eigene Antwort – „Nimm Variante B“' })
    expect(String(dateien.get(OFFEN))).toContain('eigene Antwort – „Nimm Variante B“')
  })

  test('mehrere Antworten in einer Nachricht („Zu den offenen Punkten:“) und mit Nummer', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    gesendet(on)
    await call($, ZWEI)

    await eingabe($, `Zu den offenen Punkten:\n- „${FREIGABE.titel}“: Ja\n- #2 „Irgendwie anders“: Nein`, 'bridge')
    await uhr.settle()
    const p = gespeichert(dateien)
    expect(p.map(x => x.status)).toEqual(['erledigt', 'erledigt'])
    expect(p.map(x => x.ergebnis)).toEqual(['eigene Antwort – „Ja“', 'eigene Antwort – „Nein“'])
  })

  test('kommt die Nachricht nicht bei Claude an (drop), bleibt der Punkt offen', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    on('prompt.submit', () => ({ drop: 'abgelehnt' }) as never)
    await call($, EINS)

    await eingabe($, `Zum offenen Punkt „${FREIGABE.titel}“: Nimm Variante B`, 'composer')
    await uhr.settle()
    expect(gespeichert(dateien)[0]?.status).toBe('offen')
    expect(await frageZeigt($, /Darf ich pushen\?/)).toBe(true)
  })
})

describe('/offen mit Pane', () => {
  test('steht das Pane, kommt nur eine Kurzzeile; sonst die volle Liste', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const pane = { isPlaced: true }
    grundlage(on, new Map(), { pane })
    await call($, ZWEI)

    expect(await befehl($, '')).toBe('2 offen – alles im Pane „Offene Punkte“.')
    expect(await befehl($, '2 später morgen')).toContain('ruht bis')
    await uhr.settle()
    expect(await befehl($, '')).toBe('1 offen, 1 zurückgelegt – alles im Pane „Offene Punkte“.')

    pane.isPlaced = false
    const voll = await befehl($, '')
    expect(voll).toContain('1. Freigabe Push – Darf ich pushen?')
    expect(voll).toContain('Zurückgelegt (1):\n2. Logo einbauen')
    expect(voll).not.toContain('alles im Pane')
  })

  test('ohne Punkte: „Nichts offen“, mit Pane als Kurzzeile', async ($, on) => {
    mock.clock(on, { now: T })
    const pane = { isPlaced: true }
    grundlage(on, new Map(), { pane })
    expect(await befehl($, '')).toBe('Nichts offen – alles im Pane „Offene Punkte“.')
    pane.isPlaced = false
    expect(await befehl($, '')).toStartWith('Nichts offen.')
  })
})

describe('kosten.jsonl', () => {
  const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 2 }

  test('ein Haiku-Aufruf mit usage schreibt eine Zeile mit art „nachfassen“ und eingabe 12', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    const anfragen = haiku(on, USAGE)

    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(1)
    const kosten = String(dateien.get(KOSTEN))
    expect(kosten).toContain('"art":"nachfassen"')
    expect(kosten).toContain('"eingabe":12')
    const zeilen = kosten.trim().split('\n')
    expect(zeilen).toHaveLength(1)
    expect(JSON.parse(zeilen[0] ?? '')).toMatchObject({ art: 'nachfassen', eingabe: 12, cache: 0, ausgabe: 5, version: VERSION, zeit: new Date(T).toISOString() })
  })

  test('jeder weitere Aufruf hängt eine Zeile an', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    haiku(on, USAGE)
    for (const turnId of [1, 2]) {
      await fertig($, `Alles gebaut und getestet (${turnId}). Soll ich pushen?`)
      await uhr.settle()
    }
    expect(String(dateien.get(KOSTEN)).trim().split('\n')).toHaveLength(2)
  })

  test('mit Option auswertung „haiku“ heißt die Art „auswertung“', { options: { auswertung: 'haiku' } }, async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    haiku(on, USAGE)
    await fertig($, 'Die Seite ist fertig. Soll ich sie ausrollen?')
    await uhr.settle()
    expect(String(dateien.get(KOSTEN))).toContain('"art":"auswertung"')
  })

  test('ohne usage im Ergebnis entsteht keine Zeile', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const dateien = new Map<string, string>()
    grundlage(on, dateien)
    const anfragen = haiku(on)
    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(1)
    expect(dateien.has(KOSTEN)).toBe(false)
  })

  test('die Datei wächst nicht endlos: ab 200 kB bleibt der jüngere Teil', async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    const alt = Array.from({ length: 4000 }, (_, i) => `{"zeit":"2026-10-01T00:00:00.000Z","sitzung":"A","art":"nachfassen","eingabe":${i},"cache":0,"ausgabe":1}`).join('\n') + '\n'
    expect(alt.length).toBeGreaterThan(200_000)
    const dateien = new Map<string, string>([[KOSTEN, alt]])
    grundlage(on, dateien)
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
      const uhr = mock.clock(on, { now: T })
      grundlage(on, new Map())
      on('session.usage', () => fenster(prozent))
      const anfragen = haiku(on)
      await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
      await uhr.settle()
      expect(anfragen.length).toBe(erwartet)
    })
  }

  test('die Grenze ist einstellbar', { options: { haikuBisProzent: 40 } }, async ($, on) => {
    const uhr = mock.clock(on, { now: T })
    grundlage(on, new Map())
    on('session.usage', () => fenster(50))
    const anfragen = haiku(on)
    await fertig($, 'Alles gebaut und getestet. Soll ich pushen?')
    await uhr.settle()
    expect(anfragen.length).toBe(0)
  })
})
