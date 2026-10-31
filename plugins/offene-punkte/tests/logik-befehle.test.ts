// Reine Funktionen aus hooks/logik/befehle.ts: /offen-Befehle und Bitten an Claude
import { describe, expect, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import { VERSION, ausfuehrBitte, befehle, bitteZu, istMaschinenEingabe, klaerungsBitte, kommando, kostenZeile, schlussMarken } from '../hooks/logik'
import type { Eng } from './helfer'

// So 11.10.2026, 14:00 Ortszeit
const T = new Date(2026, 9, 11, 14, 0).getTime()

const punkt = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

const eingabe = ($: Eng, text: string, kind: string) => $.prompt.submit({ text, origin: { kind } } as never)

describe('kommando: antwort, alle, klären', () => {
  test('„<Nr> antwort <Text>“ behält den Text, wie er geschrieben wurde', () => {
    expect(kommando('3 antwort Ja, aber erst morgen')).toEqual({ art: 'punkt', nummer: 3, tun: 'antwort', text: 'Ja, aber erst morgen' })
    expect(kommando('12 ANTWORT  Nimm Variante B ')).toEqual({ art: 'punkt', nummer: 12, tun: 'antwort', text: 'Nimm Variante B' })
    expect(kommando('3 antwort Zeile eins\nZeile zwei')).toEqual({ art: 'punkt', nummer: 3, tun: 'antwort', text: 'Zeile eins\nZeile zwei' })
  })

  test('„<Nr> <Text>“ ohne das Wort antwort ist auch eine freie Antwort', () => {
    expect(kommando('2 bitte erst morgen machen')).toEqual({ art: 'punkt', nummer: 2, tun: 'antwort', text: 'bitte erst morgen machen' })
    expect(kommando('2 Ja')).toEqual({ art: 'punkt', nummer: 2, tun: 'antwort', text: 'Ja' })
    expect(kommando('2 b, aber ohne Neustart')).toEqual({ art: 'punkt', nummer: 2, tun: 'antwort', text: 'b, aber ohne Neustart' })
    // Befehle bleiben Befehle, ein Befehlswort mit Rest bleibt ein Fehler
    expect(kommando('2 erledigt')).toEqual({ art: 'punkt', nummer: 2, tun: 'erledigt' })
    expect(kommando('2 b')).toEqual({ art: 'punkt', nummer: 2, tun: 'option', option: 1 })
    expect(kommando('2 weg damit').art).toBe('fehler')
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
    expect(kommando('klären')).toEqual({ art: 'klaeren', alle: false })
    expect(kommando('klaeren')).toEqual({ art: 'klaeren', alle: false })
    expect(kommando(' Klären ')).toEqual({ art: 'klaeren', alle: false })
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

describe('kommando: klären alle', () => {
  test('„klären alle“, „alle klären“, „klaeren alle“', () => {
    for (const a of ['klären alle', 'alle klären', 'klaeren alle', ' Alle Klären ']) expect(kommando(a)).toEqual({ art: 'klaeren', alle: true })
    expect(kommando('klären')).toEqual({ art: 'klaeren', alle: false })
  })
})

describe('Befehle aus der Anleitung', () => {
  test('Shell-Blöcke ja, JSON nein; Kommentare und $ fallen weg; mehrzeilig mit &&', async () => {
    const anleitung = '1. Erst:\n```bash\n# vorher\n$ cd /opt/app\nmake\n```\n2. Dann:\n```json\n{"a":1}\n```\n```\nsystemctl restart app\n```\n```\nkey = wert\n```'
    expect(befehle(anleitung)).toEqual(['cd /opt/app && make', 'systemctl restart app'])
  })

  test('Ausführen bittet Claude, den Befehl auszuführen; Backticks im Befehl bleiben heil', async () => {
    expect(ausfuehrBitte('Test', 'date && pwd')).toBe('Zum offenen Punkt „Test“: Bitte führe aus: `date && pwd`')
    expect(ausfuehrBitte('Test', 'echo `date`')).toBe('Zum offenen Punkt „Test“: Bitte führe aus: `` echo `date` ``')
  })

  test('Fortsetzungszeilen werden eine Zeile', async () => {
    expect(befehle('```sh\ncurl -s \\\n  https://x.de\n```')).toEqual(['curl -s https://x.de'])
  })
})

describe('/offen mit Argumenten', () => {
  test('liest Nummer und Tun', async () => {
    expect(kommando('')).toEqual({ art: 'liste' })
    expect(kommando('leeren')).toEqual({ art: 'leeren' })
    expect(kommando('2 erledigt')).toEqual({ art: 'punkt', nummer: 2, tun: 'erledigt' })
    expect(kommando('3 weg')).toEqual({ art: 'punkt', nummer: 3, tun: 'weg' })
    expect(kommando('1 Später')).toEqual({ art: 'punkt', nummer: 1, tun: 'spaeter' })
    expect(kommando('2 b')).toEqual({ art: 'punkt', nummer: 2, tun: 'option', option: 1 })
    expect(kommando('quatsch').art).toBe('fehler')
  })
})
