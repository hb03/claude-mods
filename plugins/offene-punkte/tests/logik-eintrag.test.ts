// Reine Funktionen aus hooks/logik/eintrag.ts: Block in Claudes Antwort lesen
import { describe, expect, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import { HINWEIS_BLOCK, abgelehnteAenderungen, aenderungenZuIds, antwortIn, befehle, blockLesen, sammelText, zusammenfuehren } from '../hooks/logik'

const BLOCK = `Alles gebaut.

\`\`\`offen
# Geräte-Token eintragen | aufgabe | blockiert
Hast du das Token im Abholer eingetragen?
a) eingetragen, Test starten
b) Fehler:
info: Ohne Token kann ich die Grenze nicht prüfen.
anleitung: 1. Token auf https://sprache.31d.de/geraete anlegen
2. In die Datei eintragen:
$ nano pc/abholer.lokal.json
# #12 Upload-Grenze | entscheidung
Welche Grenze: 55 MB oder aufteilen?
a) 55 MB (empfohlen)
b) Absätze aufteilen
\`\`\`
`

const punkt = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel: `Punkt ${nr}`, frage: `Frage ${nr}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

const JETZT = 1_800_000_000_000

const leer = { neu: [], erledigt: [], erwaehnt: [], ueberblick: '' }

describe('Block in der Antwort', () => {
  test('liest neue Punkte und Änderungen per Nummer; Labels sind zugleich die Antwort', () => {
    const r = blockLesen(BLOCK)
    expect(r.neu.map(p => p.titel)).toEqual(['Geräte-Token eintragen'])
    const p = r.neu[0]!
    expect([p.art, p.stufe, p.frage, p.info]).toEqual(['aufgabe', 'blockiert', 'Hast du das Token im Abholer eingetragen?', 'Ohne Token kann ich die Grenze nicht prüfen.'])
    expect(p.optionen).toEqual([
      { label: 'eingetragen, Test starten', antwort: 'eingetragen, Test starten' },
      { label: 'Fehler:', antwort: 'Fehler:' },
    ])
    expect(p.anleitung).toContain('1. Token auf https://sprache.31d.de/geraete anlegen')
    expect(p.anleitung).toContain('$ nano pc/abholer.lokal.json')
    expect(befehle(p.anleitung)).toEqual(['nano pc/abholer.lokal.json'])
    expect(r.aenderungen).toEqual([{
      nr: 12,
      titel: 'Upload-Grenze',
      // seit 0.16.6: die Art im Kopf geht mit (ohne Angabe bleibt sie, wie sie ist)
      art: 'entscheidung',
      frage: 'Welche Grenze: 55 MB oder aufteilen?',
      optionen: [{ label: '55 MB (empfohlen)', antwort: '55 MB (empfohlen)' }, { label: 'Absätze aufteilen', antwort: 'Absätze aufteilen' }],
    }])
  })

  test('ohne Zaun nichts; ohne Kopfzeile nichts; ohne Möglichkeit fällt der Punkt weg', () => {
    expect(blockLesen('Fertig. erledigt: #3')).toEqual({ neu: [], aenderungen: [] })
    expect(blockLesen('```offen\nnur Text\n```')).toEqual({ neu: [], aenderungen: [] })
    expect(blockLesen('```offen\n# Ohne Wahl\nFrage?\n```').neu).toEqual([])
  })

  test('Vorgaben: art und stufe auch als Zeile, feste Knöpfe fallen weg, mehrzeilige Frage', () => {
    const r = blockLesen('```offene-punkte\n# Freigabe\nSoll ich\nausrollen?\nart: entscheidung\nstufe: angebot\na) Ja, ausrollen\nb) Später\n```')
    expect(r.neu[0]?.frage).toBe('Soll ich ausrollen?')
    expect([r.neu[0]?.art, r.neu[0]?.stufe]).toEqual(['entscheidung', 'angebot'])
    expect(r.neu[0]?.optionen.map(o => o.label)).toEqual(['Ja, ausrollen'])
  })

  test('der Hinweis erklärt den Block und die Marken', () => {
    expect(HINWEIS_BLOCK).toContain('```offen')
    expect(HINWEIS_BLOCK).toContain('erledigt: #<Nr>')
    // geht in jede Sitzung: knapp halten (0.16.6: +„bei dir“-Satz, 0.16.7: +Nummern nicht raten)
    expect(HINWEIS_BLOCK.length).toBeLessThan(2_000)
  })

  test('Antwort mit Label: die Frage steht dabei, antwortIn findet den Text trotzdem', () => {
    const t = sammelText([{ titel: 'Upload-Grenze', text: '55 MB (empfohlen)', frage: 'Welche Grenze?' }])
    expect(t).toBe('Zum offenen Punkt „Upload-Grenze“ (Welche Grenze?): 55 MB (empfohlen)')
    expect(antwortIn(t, 'Upload-Grenze')).toBe('55 MB (empfohlen)')
    expect(sammelText([{ titel: 'A', text: 'x' }])).toBe('Zum offenen Punkt „A“: x')
    expect(sammelText([{ titel: 'A', text: 'x', frage: 'A?' }, { titel: 'B', text: 'y' }])).toBe('Zu den offenen Punkten:\n- „A“ (A?): x\n- „B“: y')
  })
})

describe('Änderung an einem geschlossenen Punkt (0.16.6)', () => {
  test('ein erledigter (auch beantworteter) Punkt öffnet sich mit der Änderung wieder', () => {
    const l = [punkt(68, { status: 'erledigt', ergebnis: 'Doppelung bereinigen', beiClaude: JETZT, auto: { grund: 'x', zeit: 1 } })]
    const aktualisiert = aenderungenZuIds(l, [{ nr: 68, frage: 'Erneut im Leitstand klären?', art: 'aufgabe' } as never])
    expect(aktualisiert).toHaveLength(1)
    const r = zusammenfuehren(l, { ...leer, aktualisiert }, JETZT + 1, () => 'neu')[0]!
    expect(r).toMatchObject({ status: 'offen', frage: 'Erneut im Leitstand klären?', nr: 68, geaendert: JETZT + 1 })
    expect(r.ergebnis).toBeUndefined()
    expect(r.beiClaude).toBeUndefined()
    expect(r.auto).toBeUndefined()
  })

  test('verworfen bleibt zu und wird als abgelehnt gemeldet; offen geht vor geschlossen bei gleicher Nummer', () => {
    const l = [punkt(5, { status: 'verworfen' }), punkt(6, { id: 'alt', status: 'erledigt', geaendert: 1 }), punkt(6, { id: 'neu' })]
    const a = [{ nr: 5, frage: 'X?' }, { nr: 6, frage: 'Y?' }, { nr: 9, frage: 'Z?' }] as never[]
    expect(aenderungenZuIds(l, a).map(x => x.id)).toEqual(['neu'])
    expect(abgelehnteAenderungen(l, a).map(x => x.nr)).toEqual([5, 9])
  })

  test('vom Nutzer selbst angelegte Punkte öffnet eine Änderung nicht', () => {
    const l = [punkt(2, { status: 'erledigt', vonNutzer: true })]
    const r = zusammenfuehren(l, { ...leer, aktualisiert: aenderungenZuIds(l, [{ nr: 2, frage: 'Neu?' } as never]) }, JETZT, () => 'n')[0]
    expect(r?.status).toBe('erledigt')
  })
})
