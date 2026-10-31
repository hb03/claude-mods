// Reine Funktionen aus hooks/logik/auftraege.ts: Auftraege an das Modell, Antworten lesen, Listen fuer Claude
import { describe, expect, test } from 'claude-code/testing'

import type { Punkt } from '../types'
import {
  HINWEIS_BLOCK, MAX_VERLAUF_FORT, NEU_NACH_FORT, UEBERBLICK_FORT, UEBERBLICK_NEU, anfrage, lies, listeFuerClaude, statuszeile,
  ueberblickAnfrage, ueberblickAus, zuletztGeschlossen
} from '../hooks/logik'
import type { Nachricht } from '../hooks/logik'

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

const verlauf: Nachricht[] = [
  { role: 'user', text: 'Bitte die Statuszeile reparieren.' },
  { role: 'assistant', text: 'Erledigt, Commit 1d78dce.' },
  { role: 'user', text: 'Jetzt die Plugins angleichen.' },
  { role: 'assistant', text: 'kontext-anzeige 0.6.1 ist gepusht.' },
]

describe('Lesen', () => {
  test('Art, Anleitung und Überblick; Unbekanntes wird Entscheidung', async () => {
    const a = lies(JSON.stringify({
      neu: [
        { titel: 'A', art: 'aufgabe', frage: 'A?', anleitung: 'tu x', optionen: [{ label: 'Ok', antwort: '' }] },
        { titel: 'B', art: 'quatsch', frage: 'B?', optionen: [{ label: 'Ok', antwort: '' }] },
      ],
      erledigt: [],
      ueberblick: '- **Ziel:** Test',
    }))
    expect(a?.neu.map(p => [p.art, p.anleitung])).toEqual([['aufgabe', 'tu x'], ['entscheidung', '']])
    expect(a?.ueberblick).toBe('- **Ziel:** Test')
    expect(lies('{"neu":[],"erledigt":[]}')?.ueberblick).toBe('')
  })

  test('Statuszeile zählt Aufgaben gesondert, ohne Aufgaben kein Zusatz', async () => {
    const p = (id: string, art: Punkt['art']): Punkt => ({ id, titel: id, frage: '?', info: '', art, anleitung: '', optionen: [], status: 'offen', zurueckgestellt: 0, erstellt: 1 })
    expect(statuszeile([p('a', 'aufgabe'), p('b', 'entscheidung')], false)).toBe('◆ 2 offen (1 zu tun) · /offen')
    expect(statuszeile([p('b', 'entscheidung')], false)).toBe('◆ 1 offen · /offen')
  })
})

describe('Antwort des Modells lesen', () => {
  test('liest JSON auch in einem Codeblock mit Text drumherum', async () => {
    const a = lies('Hier:\n```json\n{"neu":[{"titel":"Cronjob anlegen","frage":"Soll ich den Cronjob anlegen?","info":"Fehlt noch.","optionen":[{"label":"Ja","antwort":"Ja, leg ihn an."},{"label":"Mache ich","antwort":""}]}],"erledigt":["p1"]}\n```')
    expect(a?.neu.length).toBe(1)
    expect(a?.neu[0]?.optionen).toEqual([
      { label: 'Ja', antwort: 'Ja, leg ihn an.' },
      { label: 'Mache ich', antwort: '' },
    ])
    expect(a?.erledigt).toEqual(['p1'])
  })

  test('verwirft Punkte ohne Frage oder Optionen und begrenzt auf vier Optionen', async () => {
    const opt = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `O${i}`, antwort: '' }))
    const a = lies(JSON.stringify({
      neu: [
        { titel: 'Ohne Frage', frage: '', optionen: opt(2) },
        { titel: 'Ohne Optionen', frage: 'Was?', optionen: [] },
        { titel: 'Viele', frage: 'Welche?', optionen: opt(6) },
      ],
    }))
    expect(a?.neu.map(p => p.titel)).toEqual(['Viele'])
    expect(a?.neu[0]?.optionen.length).toBe(4)
  })

  test('Mehrfachauswahl: nur bei true und mehr als einer Option', async () => {
    const opt = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `O${i}`, antwort: `A${i}.` }))
    const a = lies(JSON.stringify({
      neu: [
        { titel: 'Mehrere', frage: 'Welche?', mehrfach: true, optionen: opt(3) },
        { titel: 'Eine', frage: 'Ja?', mehrfach: true, optionen: opt(1) },
        { titel: 'Text statt Wahrheitswert', frage: 'Was?', mehrfach: 'ja', optionen: opt(2) },
        { titel: 'Ohne', frage: 'Oder?', optionen: opt(2) },
      ],
    }))
    expect(a?.neu.map(p => p.mehrfach ?? false)).toEqual([true, false, false, false])
  })

  test('kein JSON ergibt null', async () => {
    expect(lies('Keine offenen Punkte.')).toBeNull()
    expect(lies('{kaputt')).toBeNull()
  })
})

describe('Warteschlange', () => {
  test('mehrere Antworten gehen in eine Anfrage, jede behält ihren Schluss', async () => {
    const t = anfrage(['a'.repeat(9000) + 'ENDE1', 'b'.repeat(9000) + 'ENDE2'], '', [])
    expect(t).toContain('ANTWORTEN DES ASSISTENTEN (2')
    expect(t).toContain('ENDE1')
    expect(t).toContain('ENDE2')
    expect(t.length).toBeLessThan(13_000)
  })
})

describe('Möglichkeiten', () => {
  test('was die festen Knöpfe schon abdecken, fällt weg; konkrete Übergaben bleiben', async () => {
    const a = lies(JSON.stringify({
      neu: [{
        titel: 'Log prüfen', art: 'aufgabe', frage: 'Log sauber?',
        optionen: [
          { label: 'Erledige ich selbst', antwort: '' }, { label: 'Prüfe ich später', antwort: '' }, { label: 'Später', antwort: '' },
          { label: 'Log ist sauber', antwort: 'Im Log steht nichts Neues.' }, { label: 'Übernimm: nur prüfen', antwort: 'Prüf du das Log, ändere nichts.' },
        ],
      }],
    }))
    expect(a?.neu[0]?.optionen.map(o => o.label)).toEqual(['Log ist sauber', 'Übernimm: nur prüfen'])
  })
})

describe('Überblick aus einer Modellantwort', () => {
  test('nur die Liste, ohne Einleitung und Codezaun', async () => {
    expect(ueberblickAus('Gern:\n```markdown\n- **Ziel:** A\n- **Gerade:** B\n```')).toBe('- **Ziel:** A\n- **Gerade:** B')
  })
  test('ohne Liste leer – dann bleibt der alte Überblick', async () => {
    expect(ueberblickAus('Dazu kann ich nichts sagen.')).toBe('')
    expect(ueberblickAus('- Ziel ohne Fettdruck')).toBe('')
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

describe('Überblick fortschreiben', () => {
  test('ohne alten Überblick oder ohne Marke: ganz neu aus dem Verlauf', () => {
    const a = ueberblickAnfrage(verlauf, '', 0)
    expect(a?.modus).toBe('neu')
    expect(a?.system).toBe(UEBERBLICK_NEU)
    expect(a?.prompt).toContain('Statuszeile reparieren')
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 0)?.modus).toBe('neu')
  })

  test('mit altem Überblick: nur die Nachrichten seit der Marke, dazu der alte Text', () => {
    const a = ueberblickAnfrage(verlauf, '- **Ziel:** Statuszeile', 2)
    expect(a?.modus).toBe('fort')
    expect(a?.system).toBe(UEBERBLICK_FORT)
    expect(a?.prompt).toContain('BISHERIGER ÜBERBLICK:\n- **Ziel:** Statuszeile')
    expect(a?.prompt).toContain('Plugins angleichen')
    expect(a?.prompt).not.toContain('Statuszeile reparieren')
  })

  test('nichts Neues: null; Verlauf geschrumpft (Compaction) oder zu oft fortgeschrieben: ganz neu', () => {
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 4)).toBeNull()
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 9)?.modus).toBe('neu')
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 2, NEU_NACH_FORT)?.modus).toBe('neu')
    expect(ueberblickAnfrage(verlauf, '- **Ziel:** x', 2, NEU_NACH_FORT - 1)?.modus).toBe('fort')
    expect(ueberblickAnfrage([], '', 0)).toBeNull()
  })

  test('neue Nachrichten sind auf MAX_VERLAUF_FORT begrenzt, der Schluss bleibt', () => {
    const lang: Nachricht[] = [verlauf[0]!, ...Array.from({ length: 30 }, (_, i) => ({ role: 'assistant' as const, text: `Schritt ${i} `.repeat(60) })), { role: 'user', text: 'ENDE' }]
    const a = ueberblickAnfrage(lang, '- **Ziel:** x', 1)
    const neue = a?.prompt.split('(älteste zuerst):\n\n')[1] ?? ''
    expect(neue.length).toBeLessThanOrEqual(MAX_VERLAUF_FORT + 1)
    expect(neue.endsWith('NUTZER: ENDE')).toBe(true)
  })
})

test('alle Hinweise sagen: Nummern nicht raten, sonst per Titel', () => {
  for (const h of [HINWEIS_BLOCK]) {
    expect(h).toContain('nie raten oder hochzählen')
    expect(h).toContain('„erledigt: Titel“')
  }
})
