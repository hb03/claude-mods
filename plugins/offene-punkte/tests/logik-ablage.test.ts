// Reine Funktionen aus hooks/logik/ablage.ts: offen.md, Verlauf, Sperre und Reste
import { describe, expect, test } from 'claude-code/testing'

import type { Punkt, Warnung } from '../types'
import {
  ABGLEICH_TAKT_MS, REST_ALT_MS, VERSION, abgleichFaellig, ablageDaten, ablageLesen, ablageText, alteReste, alteVerlaeufe,
  ausnahmeErgaenzen, befehlEntfernen, befehlSperren, befehlVerschieben, monatsKopf, ordnerName, tagAnhaengen, uebernehmen,
  verlaufsEintraege, zuZeigen, zuletztFertig
} from '../hooks/logik'

// So 11.10.2026, 14:00 Ortszeit
const T = new Date(2026, 9, 11, 14, 0).getTime()

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

const TAG = 24 * 3600_000

const JETZT = 20 * TAG

const punktMehrsitzung = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: JETZT - TAG, ...extra,
})

// So 11.10.2026, 14:00 Ortszeit
const SONNTAG = new Date(2026, 9, 11, 14, 0).getTime()

const punktNeu = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }, { label: 'Nein', antwort: '' }],
  status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
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

describe('Mehrere Sitzungen: wer was tut', () => {
  test('übernehmen lässt Punkte lebender Sitzungen bei ihnen', () => {
    const u = uebernehmen([punktMehrsitzung('a', { sitzung: 'B' }), punktMehrsitzung('b', { sitzung: 'C' }), punktMehrsitzung('c')], 'A', undefined, new Set(['B']))
    expect(u.map(p => p.sitzung)).toEqual(['B', 'A', 'A'])
  })

  test('der Abgleich ist je Takt einmal im Projekt fällig', () => {
    expect(abgleichFaellig('', JETZT)).toBe(true)
    expect(abgleichFaellig(`${JETZT - 10 * 60_000} B\n`, JETZT)).toBe(false)
    expect(abgleichFaellig(`${JETZT - ABGLEICH_TAKT_MS + 4 * 60_000} B\n`, JETZT)).toBe(true)
    // Uhr der anderen Sitzung voraus: lieber noch einmal abgleichen als nie.
    expect(abgleichFaellig(`${JETZT + 60_000} B\n`, JETZT)).toBe(true)
  })

  test('alte .tmp sind Reste, frische und andere Dateien nicht', () => {
    const e = (name: string, alter: number) => ({ name, kind: 'file', mtimeMs: JETZT - alter })
    expect(alteReste([e('offen.json.4f2a9c1b.tmp', REST_ALT_MS), e('offen.md.neu.tmp', REST_ALT_MS + 1), e('offen.md.abc.tmp', 1000), e('offen.md', TAG)], JETZT))
      .toEqual(['offen.json.4f2a9c1b.tmp', 'offen.md.neu.tmp'])
  })

  test('Befehle: Windows mit Backslashes über cmd, sonst die üblichen', () => {
    expect(befehlSperren('C:/p/offene-punkte/.sperre', true)).toEqual(['cmd', '/c', 'mkdir', 'C:\\p\\offene-punkte\\.sperre'])
    expect(befehlVerschieben('/p/a.tmp', '/p/a', false)).toEqual(['mv', '-f', '/p/a.tmp', '/p/a'])
    expect(befehlEntfernen(['C:/p/a', 'C:/p/b'], true)).toEqual(['cmd', '/c', 'del', '/q', 'C:\\p\\a', 'C:\\p\\b'])
  })
})

describe('Verlauf und Warnungen', () => {
  test('Tagesverläufe älter als 30 Tage nach Monat; ein Tag kommt nur einmal in die Monatsdatei', async () => {
    const m = alteVerlaeufe(['antworten-2026-08-30.md', 'antworten-2026-09-02.md', 'antworten-2026-08-01.md', 'antworten-2026-09-20.md', 'offen.md', 'antworten-2026-08.md'], SONNTAG)
    expect([...m]).toEqual([['2026-08', ['2026-08-01', '2026-08-30']], ['2026-09', ['2026-09-02']]])

    const tag = '# Antworten auf offene Punkte – 2026-08-01\n\nWas entschieden, erledigt oder verworfen wurde, mit den Gründen von damals.\n\n## 10:00 · X – entschieden\n\n**Frage:** ?\n'
    const einmal = tagAnhaengen(monatsKopf('2026-08'), '2026-08-01', tag)
    expect(einmal).toContain('\n## 2026-08-01\n\n### 10:00 · X – entschieden\n')
    expect(einmal).not.toContain('Gründen von damals.\n\n###')
    expect(tagAnhaengen(einmal!, '2026-08-01', tag)).toBeNull()
  })

  test('über der Eingabe nur Warnungen, ohne die ausgeblendeten', async () => {
    const w: Warnung[] = [
      { schluessel: 'kontext-kritisch', stufe: 'warn', text: 'Auto-Compact' },
      { schluessel: 'cache-kalt', stufe: 'info', text: 'kalt' },
      { schluessel: 'cache-bald', stufe: 'warn', text: 'bald' },
    ]
    expect(zuZeigen(w, ['cache-bald']).map(x => x.schluessel)).toEqual(['kontext-kritisch'])
  })
})

describe('Dateien', () => {
  test('offen.md: lesbar, und die Daten kommen unverändert zurück – auch mit --> im Text', async () => {
    const punkte = [punktNeu('a', { anleitung: 'pfeil --> hier', stufe: 'blockiert', abwaegung: 'schneller' }), punktNeu('b', { status: 'erledigt', ergebnis: 'Ja' })]
    const text = ablageText({ punkte, ueberblick: '- **Ziel:** x' }, 1_800_000_000_000)
    expect(text).toContain('### 1. a (blockiert)')
    expect(text).toContain('Abwägung: schneller')
    expect(text).toContain('✓ b: Ja')
    const zurueck = ablageLesen(text)
    expect(zurueck?.ueberblick).toBe('- **Ziel:** x')
    expect(zurueck?.punkte.map(p => [p.id, p.status, p.anleitung])).toEqual([['a', 'offen', 'pfeil --> hier'], ['b', 'erledigt', '']])
    expect(ablageLesen('# kaputt')).toBeNull()
  })

  test('Verlauf: geschlossene mit Abwägung und Ergebnis, wieder geöffnete vermerkt', async () => {
    const vorher = [punktNeu('a', { abwaegung: 'weil billig' }), punktNeu('b', { status: 'erledigt' })]
    const nachher = [{ ...vorher[0]!, status: 'erledigt' as const, ergebnis: 'Ja – „Ja.“' }, { ...vorher[1]!, status: 'offen' as const }]
    const e = verlaufsEintraege(vorher, nachher, 1_800_000_000_000)
    expect(e.length).toBe(2)
    expect(e[0]).toContain('a – entschieden')
    expect(e[0]).toContain('**Abwägung:** weil billig')
    expect(e[0]).toContain('**Ergebnis:** Ja – „Ja.“')
    expect(e[1]).toContain('b – wieder geöffnet')
  })

  test('Ausnahme nur einmal eintragen; Ordnername aus dem Pfad', async () => {
    const einmal = ausnahmeErgaenzen('# git\n*.log')
    expect(einmal).toBe('# git\n*.log\n# offene-punkte (Claude-Code-Mod)\n/offene-punkte/\n')
    expect(ausnahmeErgaenzen(einmal!)).toBeNull()
    expect(ordnerName('/home/nutzer/mein projekt')).toBe('home-nutzer-mein_projekt')
    expect(ordnerName('C:\\Users\\x\\app')).toBe('Users-x-app')
  })
})
