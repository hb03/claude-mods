import { describe, expect, test } from 'claude-code/testing'
import type { Auswertung } from '../hooks/logik'

import type { Punkt } from '../types'
import { AUTO_ZEIGEN_MS, MAX_PUNKTE, ablageLesen, ablageText, anfrage, autoErledigt, brauchtErgaenzung, erledigtMarken, lies, offene, perMarkeSchliessen, statuszeile, zusammenfuehren } from '../hooks/logik'

const neuer = (titel: string, frage: string): Auswertung['neu'][number] =>
  ({ titel, frage, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '', optionen: [{ label: 'Ja', antwort: '' }] })
const leer: Auswertung = { neu: [], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }

const punkt = (id: string, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
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

describe('Liste führen', () => {
  test('neue anhängen, gleiche nicht doppelt, erledigte schließen', async () => {
    let n = 0
    const alt = [punkt('a', 'Cronjob anlegen'), punkt('b', 'Datenschutz ergänzen')]
    const neu = zusammenfuehren(alt, {
      ...leer,
      neu: [neuer('Cronjob anlegen!', 'Nochmal?'), neuer('Sitemap einreichen', 'Einreichen?')],
      erledigt: ['b'],
    }, 5, () => `n${n++}`)
    expect(offene(neu).map(p => p.titel)).toEqual(['Cronjob anlegen', 'Sitemap einreichen'])
    expect(neu.find(p => p.id === 'b')?.status).toBe('erledigt')
  })

  test('zurückgestellte kommen zuletzt dran', async () => {
    const liste = [punkt('a', 'A', { zurueckgestellt: 1 }), punkt('b', 'B', { erstellt: 3 }), punkt('c', 'C', { erstellt: 2 })]
    expect(offene(liste).map(p => p.id)).toEqual(['c', 'b', 'a'])
  })

  test('bleibt bei höchstens MAX_PUNKTE', async () => {
    const viele = Array.from({ length: MAX_PUNKTE + 5 }, (_, i) => punkt(`x${i}`, `Punkt ${i}`))
    expect(zusammenfuehren(viele, leer, 1, () => 'n').length).toBe(MAX_PUNKTE)
  })

  test('Antworten mit Doppelpunkt am Ende werden nur vorbereitet', async () => {
    expect(brauchtErgaenzung('Ich formuliere den Absatz um: ')).toBe(true)
    expect(brauchtErgaenzung('Ja, rolle es aus.')).toBe(false)
  })

  test('Statuszeile nennt die Zahl der offenen', async () => {
    expect(statuszeile([], false)).toBeUndefined()
    expect(statuszeile([punkt('a', 'A'), punkt('b', 'B', { status: 'erledigt' })], false)).toBe('◆ 1 offen · /offen')
  })

  test('die Anfrage nennt bekannte Punkte mit ID und kürzt lange Antworten von vorn', async () => {
    const text = anfrage('x'.repeat(20_000) + 'SCHLUSS', 'mach weiter', [punkt('p7', 'Cronjob')])
    expect(text).toMatch(/- p7 \(entscheidung\): Cronjob/)
    expect(text).toContain('SCHLUSS')
    expect(text.length).toBeLessThan(13_000)
  })
})

describe('Selbst als erledigt erkennen (0.11.0)', () => {
  test('erledigt kommt als ID oder mit Grund; der Grund steht am Punkt', async () => {
    const a = lies('{"neu":[],"erledigt":["p1",{"id":"p2","grund":"Nutzer macht weiter, kein Fehler"}],"erwaehnt":[]}')
    expect(a?.erledigt).toEqual(['p1', 'p2'])
    expect(a?.gruende).toEqual({ p2: 'Nutzer macht weiter, kein Fehler' })
    const liste = zusammenfuehren([punkt('p1', 'A'), punkt('p2', 'B'), punkt('p3', 'C')], a as Auswertung, 500, () => 'x')
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
    const liste = [punkt('a', 'A', { nr: 3 }), punkt('b', 'B', { nr: 4 }),
      punkt('c', 'C', { nr: 5, ausstehend: { status: 'erledigt', ergebnis: 'x', text: 'x', wo: 'sammlung', reihe: 1 } })]
    const neu = perMarkeSchliessen(liste, [3, 5, 9], 100)
    expect(neu[0]?.status).toBe('erledigt')
    expect(neu[0]?.auto?.grund).toBe('von Claude als erledigt gemeldet')
    expect(neu[1]?.status).toBe('offen')
    expect(neu[2]?.status).toBe('offen')
  })

  test('automatisch erledigte: 24 h sichtbar, überstehen die Datei, eigenes Zeichen', async () => {
    const zu = punkt('a', 'Seite neu laden', { nr: 1, status: 'erledigt', ergebnis: 'x', auto: { grund: 'stilles OK', zeit: 1000 } })
    const vonHand = punkt('b', 'B', { nr: 2, status: 'erledigt', ergebnis: 'als erledigt markiert' })
    expect(autoErledigt([zu, vonHand], 2000).map(p => p.id)).toEqual(['a'])
    expect(autoErledigt([zu], 1000 + AUTO_ZEIGEN_MS)).toEqual([])
    const datei = ablageText({ punkte: [zu, vonHand], ueberblick: '' }, 2000)
    expect(datei).toContain('- 🤖 Seite neu laden')
    expect(datei).toContain('- ✓ B')
    expect(ablageLesen(datei)?.punkte.find(p => p.id === 'a')?.auto).toEqual({ grund: 'stilles OK', zeit: 1000 })
  })
})
