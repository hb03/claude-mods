// Reine Funktionen aus hooks/logik/punkte.ts: Punkteliste fuehren, Sitzungen, Ruhe, Grabsteine
import { describe, expect, test } from 'claude-code/testing'

import type { Ausstehend, Punkt } from '../types'
import {
  ANGEBOT_VERFALL, GESCHLOSSEN_HALTEN_MS, MAX_PUNKTE, VERALTET_NACH, WIEDER_NEU_NACH_MS, abgleichen, ablageLesen, ablageText, abschliessen,
  anfrage, antwortIn, ausfuehrBitte, begrenzen, beiClaudeFertig, bitteZu, brauchtErgaenzung, eingetippteAntworten, fragbar, fremd,
  geschlossenFuehren, hoechsteImVerlauf, insInterview, interviewNummer, kommando, lies, nichtsFragbar, notiz, nummerieren, offene,
  perMarkeSchliessen, ruhe, ruheVermerk, sammelText, schlussMarken, statuszeile, stempeln, tagText, uebernehmen, veraltetSchliessen,
  verlaufsEintraege, zuGeschlossen, zuruecknehmen, zusammenfuehren
} from '../hooks/logik'
import type { Auswertung } from '../hooks/logik'

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

const punktBeiclaude = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel: `Punkt ${nr}`, frage: `Frage ${nr}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

const JETZT_BEICLAUDE = 1_800_000_000_000

const punktBetrieb = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

const T = new Date(2026, 9, 14, 15, 0).getTime()

const punktFremde = (nr: number, titel: string, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel, frage: `${titel}?`, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: 1, ...extra,
})

const neuer = (titel: string, frage: string): Auswertung['neu'][number] =>
  ({ titel, frage, info: '', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '', optionen: [{ label: 'Ja', antwort: '' }] })

const leerLogik: Auswertung = { neu: [], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }

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

const punktMarken = (nr: number, extra: Partial<Punkt> = {}): Punkt => ({
  id: `p${nr}`, nr, titel: `Punkt ${nr}`, frage: `Frage ${nr}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

const JETZT_MARKEN = 1_800_000_000_000

const HIER = 'sitzung-a'

const JETZT_MEHRSITZUNG = 20 * TAG

const punktMehrsitzung = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: JETZT_MEHRSITZUNG - TAG, ...extra,
})

const punktSitzungen = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }], status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

// So 11.10.2026, 14:00 Ortszeit
const SONNTAG = new Date(2026, 9, 11, 14, 0).getTime()

const punktNeu = (id: string, extra: Partial<Punkt> = {}): Punkt => ({
  id, titel: id, frage: `${id}?`, info: '', art: 'entscheidung', anleitung: '',
  optionen: [{ label: 'Ja', antwort: 'Ja.' }, { label: 'Nein', antwort: '' }],
  status: 'offen', zurueckgestellt: 0, erstellt: 1, ...extra,
})

const JA: Ausstehend = { status: 'erledigt', ergebnis: 'Ja – „Ja.“', text: 'Ja.', wo: 'sammlung', reihe: 1 }

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

describe('Antwort „bei Claude“ (0.16.6)', () => {
  test('abschliessen mit Sendezeit: erledigt liegt bei Claude, verworfen nicht', () => {
    const l = [
      punktBeiclaude(1, { ausstehend: { status: 'erledigt', ergebnis: 'Ja', text: 'Ja.', wo: 'sammlung', reihe: 1 } }),
      punktBeiclaude(2, { ausstehend: { status: 'verworfen', ergebnis: 'nicht relevant', text: '', wo: 'sammlung', reihe: 2 } }),
    ]
    const r = abschliessen(l, new Set(['p1', 'p2']), new Map(), JETZT_BEICLAUDE)
    expect(r[0]).toMatchObject({ status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT_BEICLAUDE })
    expect(r[1]?.beiClaude).toBeUndefined()
    // ohne Sendezeit wie bisher
    expect(abschliessen(l, new Set(['p1']))[0]?.beiClaude).toBeUndefined()
  })

  test('beiClaudeFertig: der Turn mit der Antwort oder ein späterer beendet es, ein schon laufender nicht', () => {
    const l = [punktBeiclaude(1, { status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT_BEICLAUDE })]
    // Turn lief schon, als die Antwort abging, und trug sie nicht
    expect(beiClaudeFertig(l, JETZT_BEICLAUDE - 10, 'etwas anderes')[0]?.beiClaude).toBe(JETZT_BEICLAUDE)
    // Turn begann danach
    expect(beiClaudeFertig(l, JETZT_BEICLAUDE + 1)[0]?.beiClaude).toBeUndefined()
    // Turn trug die Antwort (gleiche Millisekunde)
    const r = beiClaudeFertig(l, JETZT_BEICLAUDE, 'Zum offenen Punkt #1 „Punkt 1“: Ja.')[0]
    expect(r?.beiClaude).toBeUndefined()
    expect(r).toMatchObject({ status: 'erledigt', ergebnis: 'Ja' })
  })

  test('„erledigt: #N“ auf einen beantworteten Punkt bestätigt ihn, ohne ihn neu zu schließen', () => {
    const l = [punktBeiclaude(1, { status: 'erledigt', ergebnis: 'Ja', beiClaude: JETZT_BEICLAUDE }), punktBeiclaude(2)]
    const r = perMarkeSchliessen(l, [1], JETZT_BEICLAUDE + 5)
    expect(r[0]?.beiClaude).toBeUndefined()
    expect(r[0]?.ergebnis).toBe('Ja · von Claude als umgesetzt gemeldet')
    expect(r[0]?.auto).toBeUndefined()
    expect(r[1]?.status).toBe('offen')
  })

  test('Nummer in der Nachricht an Claude; antwortIn trennt auch Zeilen mit Nummer', () => {
    expect(sammelText([{ titel: 'A', text: 'x', nr: 3 }])).toBe('Zum offenen Punkt #3 „A“: x')
    const t = sammelText([{ titel: 'A', text: 'x', nr: 3 }, { titel: 'B', text: 'y', nr: 4 }])
    expect(t).toBe('Zu den offenen Punkten:\n- #3 „A“: x\n- #4 „B“: y')
    expect(antwortIn(t, 'A')).toBe('x')
    expect(antwortIn(t, 'B')).toBe('y')
  })
})

describe('eingetippteAntworten', () => {
  const offen = () => [punktBetrieb(12, 'Freigabe Push'), punktBetrieb(5, 'Logo einbauen')]

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
    const liste = [punktBetrieb(12, 'Freigabe Push', { erstellt: 1 }), punktBetrieb(5, 'Logo einbauen', { erstellt: 9 })]
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
      punktBetrieb(1, 'Alpha', { status: 'erledigt' }),
      punktBetrieb(2, 'Beta', { ausstehend: { status: 'erledigt', ergebnis: 'x', text: 'x', wo: 'eingabe', reihe: 1 } }),
      punktBetrieb(3, 'Gamma'),
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

describe('Punkte ohne Sitzung', () => {
  test('„unbekannt“, leer oder ohne Sitzung ist nicht fremd; eine echte andere Sitzung schon', () => {
    for (const sitzung of [undefined, '', 'unbekannt']) expect(fremd(punktFremde(1, 'x', { sitzung }), 'A')).toBe(false)
    expect(fremd(punktFremde(1, 'x', { sitzung: 'B' }), 'A')).toBe(true)
    expect(fragbar([punktFremde(1, 'x', { sitzung: 'unbekannt' })], { sitzung: 'A', jetzt: T })).toHaveLength(1)
  })

  test('nach /clear gehen auch Punkte ohne Sitzung mit; die einer anderen Sitzung bleiben', () => {
    const l = uebernehmen([punktFremde(1, 'a', { sitzung: 'alt' }), punktFremde(2, 'b', { sitzung: 'unbekannt' }), punktFremde(3, 'c'), punktFremde(4, 'd', { sitzung: 'B' })], 'neu', 'alt')
    expect(l.map(p => p.sitzung)).toEqual(['neu', 'neu', 'neu', 'B'])
  })

  test('neue Punkte tragen die Sitzung, die sie anlegt', () => {
    let n = 0
    const neu = { titel: 'Neu', frage: 'Neu?', info: '', art: 'entscheidung' as const, anleitung: '', optionen: [] }
    const l = zusammenfuehren([], { neu: [neu], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }, T, () => `n${++n}`, 0, 'A')
    expect(l[0]?.sitzung).toBe('A')
    expect(zusammenfuehren([], { neu: [neu], aktualisiert: [], erledigt: [], erwaehnt: [], ueberblick: '' }, T, () => 'x')[0]?.sitzung).toBeUndefined()
  })
})

describe('nichtsFragbar', () => {
  const s = { sitzung: 'A', jetzt: T }
  test('nichts da: „Es ist nichts offen.“', () => {
    expect(nichtsFragbar([], s)).toBe('Es ist nichts offen.')
    expect(nichtsFragbar([punktFremde(1, 'x', { status: 'erledigt' })], s)).toBe('Es ist nichts offen.')
  })
  test('nennt fremde und zurückgelegte Punkte statt „nichts offen“', () => {
    const l = [punktFremde(1, 'a', { sitzung: 'B' }), punktFremde(2, 'b', { sitzung: 'C' }), punktFremde(3, 'c', { ruht: { bis: T + 1 } })]
    expect(nichtsFragbar(l, s, ', /offen klären alle übernimmt und klärt sie'))
      .toBe('In dieser Sitzung ist nichts offen – 2 Punkte gehören anderen Sitzungen, 1 Punkt ist zurückgelegt. /offen zeigt sie, /offen klären alle übernimmt und klärt sie.')
    expect(nichtsFragbar([punktFremde(1, 'a', { sitzung: 'B' })], s)).toBe('In dieser Sitzung ist nichts offen – 1 Punkt gehört einer anderen Sitzung. /offen zeigt sie.')
  })
})

describe('Liste führen', () => {
  test('neue anhängen, gleiche nicht doppelt, erledigte schließen', async () => {
    let n = 0
    const alt = [punktLogik('a', 'Cronjob anlegen'), punktLogik('b', 'Datenschutz ergänzen')]
    const neu = zusammenfuehren(alt, {
      ...leerLogik,
      neu: [neuer('Cronjob anlegen!', 'Nochmal?'), neuer('Sitemap einreichen', 'Einreichen?')],
      erledigt: ['b'],
    }, 5, () => `n${n++}`)
    expect(offene(neu).map(p => p.titel)).toEqual(['Cronjob anlegen', 'Sitemap einreichen'])
    expect(neu.find(p => p.id === 'b')?.status).toBe('erledigt')
  })

  test('zurückgestellte kommen zuletzt dran', async () => {
    const liste = [punktLogik('a', 'A', { zurueckgestellt: 1 }), punktLogik('b', 'B', { erstellt: 3 }), punktLogik('c', 'C', { erstellt: 2 })]
    expect(offene(liste).map(p => p.id)).toEqual(['c', 'b', 'a'])
  })

  test('bleibt bei höchstens MAX_PUNKTE', async () => {
    const viele = Array.from({ length: MAX_PUNKTE + 5 }, (_, i) => punktLogik(`x${i}`, `Punkt ${i}`))
    expect(zusammenfuehren(viele, leerLogik, 1, () => 'n').length).toBe(MAX_PUNKTE)
  })

  test('Antworten mit Doppelpunkt am Ende werden nur vorbereitet', async () => {
    expect(brauchtErgaenzung('Ich formuliere den Absatz um: ')).toBe(true)
    expect(brauchtErgaenzung('Ja, rolle es aus.')).toBe(false)
  })

  test('Statuszeile nennt die Zahl der offenen', async () => {
    expect(statuszeile([], false)).toBeUndefined()
    expect(statuszeile([punktLogik('a', 'A'), punktLogik('b', 'B', { status: 'erledigt' })], false)).toBe('◆ 1 offen · /offen')
  })

  test('die Anfrage nennt bekannte Punkte mit ID und kürzt lange Antworten von vorn', async () => {
    const text = anfrage('x'.repeat(20_000) + 'SCHLUSS', 'mach weiter', [punktLogik('p7', 'Cronjob')])
    expect(text).toMatch(/- p7 \(entscheidung\): Cronjob/)
    expect(text).toContain('SCHLUSS')
    expect(text.length).toBeLessThan(13_000)
  })
})

describe('Planungsinterview (0.16.8)', () => {
  const S = { sitzung: HIER, jetzt: JETZT_MARKEN }

  test('die Bitte nennt Nummer und Abschluss, interviewNummer liest sie zurück', () => {
    const b = bitteZu('interview', punktMarken(12, { titel: 'Upload umbauen' }))
    expect(b).toContain('erledigt: #12')
    expect(b).toContain('# #12 Upload umbauen')
    expect(interviewNummer(b)).toBe(12)
    expect(interviewNummer('Lass uns das erst im Planungsinterview durchgehen: frag mich die offenen Details einzeln ab.')).toBeUndefined()
  })

  test('im Interview ruht der Punkt, nur der eigene und nur offene', () => {
    const l = [punktMarken(12, { sitzung: HIER }), punktMarken(13, { sitzung: 'sitzung-b' }), punktMarken(14, { sitzung: HIER, status: 'erledigt' })]
    const r = insInterview(insInterview(insInterview(l, 12, HIER), 13, HIER), 14, HIER)
    expect(r[0]?.ruht).toEqual({ sitzung: HIER, interview: true })
    expect(r[1]?.ruht).toBeUndefined()
    expect(r[2]?.ruht).toBeUndefined()
    expect(fragbar(r, S).map(p => p.nr)).toEqual([])
    expect(ruheVermerk(r[0]!, S)).toBe('im Planungsinterview')
  })

  test('Claude ändert ihn („# #12“): er wird wieder gefragt; ein Schließen per Marke geht trotz Ruhe', () => {
    const l = insInterview([punktMarken(12, { sitzung: HIER })], 12, HIER)
    const geaendert = zusammenfuehren(l, { neu: [], aktualisiert: [{ id: 'p12', frage: 'Nur noch das Limit?' } as never], erledigt: [], erwaehnt: [], ueberblick: '' }, JETZT_MARKEN, () => 'n')
    expect(geaendert[0]?.ruht).toBeUndefined()
    expect(geaendert[0]?.frage).toBe('Nur noch das Limit?')
    expect(fragbar(geaendert, S).map(p => p.nr)).toEqual([12])
    expect(perMarkeSchliessen(l, schlussMarken('erledigt: #12'), JETZT_MARKEN, HIER)[0]?.status).toBe('erledigt')
  })

  test('übersteht die Datei', () => {
    const l = insInterview([punktMarken(12, { sitzung: HIER })], 12, HIER)
    expect(ablageLesen(ablageText({ punkte: l, ueberblick: '' }, JETZT_MARKEN))?.punkte[0]?.ruht).toEqual({ sitzung: HIER, interview: true })
  })
})

describe('Grabsteine: Geschlossenes geht nicht wieder auf', () => {
  test('aus der Liste gefallen, von einer anderen Sitzung offen zurückgeschrieben: bleibt draußen', () => {
    const geschlossen = { a: { status: 'erledigt' as const, zeit: JETZT_MEHRSITZUNG - 1000 } }
    // Hier kennt man a nicht mehr (begrenzt), die Datei hat es offen von einer Sitzung, die es nie erfuhr.
    const l = abgleichen([punktMehrsitzung('b', { nr: 2 })], [punktMehrsitzung('a', { nr: 1, sitzung: 'B' }), punktMehrsitzung('b', { nr: 2 })], 2, geschlossen)
    expect(l.map(p => p.id)).toEqual(['b'])
  })

  test('hier noch offen, anderswo später geschlossen: schließt sich; danach wieder geöffnet: bleibt offen', () => {
    const geschlossen = { a: { status: 'verworfen' as const, zeit: JETZT_MEHRSITZUNG - 1000, ergebnis: 'dort verworfen' } }
    expect(zuGeschlossen([punktMehrsitzung('a')], geschlossen)[0]).toMatchObject({ status: 'verworfen', ergebnis: 'dort verworfen', geaendert: JETZT_MEHRSITZUNG - 1000 })
    expect(zuGeschlossen([punktMehrsitzung('a', { geaendert: JETZT_MEHRSITZUNG })], geschlossen)[0]?.status).toBe('offen')
    // Ohne Ergebnis im Grabstein steht da, woher das Schließen kam.
    expect(zuGeschlossen([punktMehrsitzung('a')], { a: { status: 'erledigt', zeit: JETZT_MEHRSITZUNG } })[0]?.ergebnis).toBe('in einer anderen Sitzung geschlossen')
  })

  test('fortschreiben: neuester gewinnt, Wiederöffnen löscht, Altes fällt weg', () => {
    const g = geschlossenFuehren(
      [punktMehrsitzung('a', { status: 'erledigt', geaendert: JETZT_MEHRSITZUNG - 10, ergebnis: 'x'.repeat(500) }), punktMehrsitzung('b', { geaendert: JETZT_MEHRSITZUNG - 5 }), punktMehrsitzung('c')],
      JETZT_MEHRSITZUNG,
      { b: { status: 'erledigt', zeit: JETZT_MEHRSITZUNG - 50 }, c: { status: 'erledigt', zeit: JETZT_MEHRSITZUNG - 50 }, d: { status: 'erledigt', zeit: JETZT_MEHRSITZUNG - GESCHLOSSEN_HALTEN_MS - 1 } },
      { a: { status: 'verworfen', zeit: JETZT_MEHRSITZUNG - 100 } },
    )
    expect(Object.keys(g).sort()).toEqual(['a', 'c'])
    expect(g.a).toMatchObject({ status: 'erledigt', zeit: JETZT_MEHRSITZUNG - 10 })
    expect(g.a?.ergebnis?.length).toBe(160)
  })

  test('stehen in offen.md und kommen beim Lesen zurück', () => {
    const geschlossen = { a: { status: 'erledigt' as const, zeit: JETZT_MEHRSITZUNG - 1000 } }
    const a = ablageLesen(ablageText({ punkte: [punktMehrsitzung('b', { nr: 2 })], ueberblick: '', hoechsteNr: 2, geschlossen }, JETZT_MEHRSITZUNG))
    expect(a?.geschlossen).toEqual(geschlossen)
    // Ältere Dateien ohne Grabsteine: leer.
    expect(ablageLesen(ablageText({ punkte: [], ueberblick: '' }, JETZT_MEHRSITZUNG))?.geschlossen).toEqual({})
  })

  test('ab MAX_PUNKTE offenen bleibt nichts Erledigtes stehen (slice(-0) hielt alles)', () => {
    const offen = Array.from({ length: MAX_PUNKTE }, (_, i) => punktMehrsitzung(`o${i}`))
    expect(begrenzen([...offen, punktMehrsitzung('z', { status: 'erledigt' })]).length).toBe(MAX_PUNKTE)
    expect(begrenzen([...offen.slice(1), punktMehrsitzung('z', { status: 'erledigt' })]).map(p => p.id)).toContain('z')
  })

  test('geprüft gilt für alle Sitzungen', () => {
    const l = abgleichen([punktMehrsitzung('a', { nr: 1 })], [punktMehrsitzung('a', { nr: 1, geprueft: JETZT_MEHRSITZUNG })], 1)
    expect(l[0]?.geprueft).toBe(JETZT_MEHRSITZUNG)
  })
})

describe('Abgleich zwischen Sitzungen', () => {
  test('geschlossen gewinnt; nur dort stehende Punkte kommen mit ihrer Sitzung dazu', async () => {
    const eigene = [punktSitzungen('a', { nr: 1, sitzung: 'A' }), punktSitzungen('b', { nr: 2, sitzung: 'A' })]
    const datei = [
      punktSitzungen('a', { nr: 1, sitzung: 'B', status: 'erledigt', ergebnis: 'dort entschieden', geaendert: 5 }),
      punktSitzungen('b', { nr: 2, sitzung: 'A' }),
      punktSitzungen('c', { nr: 2, sitzung: 'B' }),
      punktSitzungen('d', { sitzung: 'B', status: 'verworfen' }),
    ]
    const l = abgleichen(eigene, datei)
    expect(l.find(p => p.id === 'a')).toMatchObject({ status: 'erledigt', ergebnis: 'dort entschieden', sitzung: 'A' })
    // Geschlossen behält seine Nummer; Nummer 2 ist hier offen vergeben: c bekommt die nächste.
    expect(l.find(p => p.id === 'a')?.nr).toBe(1)
    expect(l.find(p => p.id === 'c')).toMatchObject({ status: 'offen', sitzung: 'B', nr: 3 })
    expect(l.find(p => p.id === 'b')?.nr).toBe(2)
    expect(l.find(p => p.id === 'd')?.status).toBe('verworfen')
  })

  test('hier wieder geöffnet (nach dem Schließen dort) bleibt offen; ein Schließen hier bleibt zu', async () => {
    const datei = [punktSitzungen('a', { status: 'erledigt', geaendert: 5 }), punktSitzungen('b')]
    const l = abgleichen([punktSitzungen('a', { geaendert: 9 }), punktSitzungen('b', { status: 'verworfen', geaendert: 9 })], datei)
    expect(l.map(p => p.status)).toEqual(['offen', 'verworfen'])
    // Vor dem Schließen dort geöffnet: das Schließen gewinnt.
    expect(abgleichen([punktSitzungen('a', { geaendert: 3 })], datei).find(p => p.id === 'a')?.status).toBe('erledigt')
  })

  test('stempeln merkt Wechsel zwischen offen und geschlossen; übernehmen macht Punkte zu eigenen', async () => {
    const l = stempeln([punktSitzungen('a'), punktSitzungen('b')], [punktSitzungen('a', { status: 'erledigt' }), punktSitzungen('b', { titel: 'neu' })], 7)
    expect(l.map(p => p.geaendert)).toEqual([7, undefined])
    const u = uebernehmen([punktSitzungen('a', { sitzung: 'alt' }), punktSitzungen('b', { sitzung: 'B' }), punktSitzungen('c', { sitzung: 'alt', status: 'erledigt' })], 'neu', 'alt')
    expect(u.map(p => p.sitzung)).toEqual(['neu', 'B', 'alt'])
  })

  test('gefragt wird nur, was zu dieser Sitzung gehört und nicht ruht; die Statuszeile nennt den Rest', async () => {
    const s = { sitzung: 'A', jetzt: SONNTAG }
    const liste = [
      punktSitzungen('eigen', { sitzung: 'A' }),
      punktSitzungen('alt'),
      punktSitzungen('fremd', { sitzung: 'B' }),
      punktSitzungen('morgen', { ruht: { bis: SONNTAG + 1 } }),
      punktSitzungen('vorbei', { ruht: { bis: SONNTAG - 1 } }),
      punktSitzungen('sitzung', { ruht: { sitzung: 'A' } }),
      punktSitzungen('letzte', { ruht: { sitzung: 'X' } }),
    ]
    expect(fragbar(liste, s).map(p => p.id)).toEqual(['eigen', 'alt', 'vorbei', 'letzte'])
    expect(statuszeile(liste, false, s)).toBe(`◆ 4 offen (3 zurückgelegt – nächster ${tagText(SONNTAG + 1)}) · /offen`)
    expect(statuszeile([punktSitzungen('fremd', { sitzung: 'B' })], false, s)).toBe('◇ 1 zurückgelegt · /offen')
  })

  test('die Statuszeile nennt, wann der nächste zurückgelegte Punkt wieder dran ist', async () => {
    const s = { sitzung: 'A', jetzt: SONNTAG }
    const montag = ruhe('woche', s).bis ?? 0
    const morgen = ruhe('morgen', s).bis ?? 0
    expect(statuszeile([punktSitzungen('m', { ruht: { bis: montag } })], false, s)).toBe(`◇ 1 zurückgelegt bis ${tagText(montag)} · /offen`)
    expect(statuszeile([punktSitzungen('m', { ruht: { bis: montag } }), punktSitzungen('t', { ruht: { bis: morgen } }), punktSitzungen('x')], false, s))
      .toBe(`◆ 1 offen (2 zurückgelegt – nächster ${tagText(morgen)}) · /offen`)
    expect(statuszeile([punktSitzungen('a', { ruht: { sitzung: 'A' } }), punktSitzungen('b', { ruht: { sitzung: 'A' } })], false, s))
      .toBe('◇ 2 zurückgelegt bis zur nächsten Sitzung · /offen')
    expect(statuszeile([punktSitzungen('v', { ruht: { bis: SONNTAG - 1 } })], false, s)).toBe('◆ 1 offen · /offen')
  })

  test('Ruhezeiten: Mitternacht morgen, in drei Tagen, nächster Montag; nächste Sitzung', async () => {
    const s = { sitzung: 'A', jetzt: SONNTAG }
    expect(new Date(ruhe('morgen', s).bis!).toString()).toBe(new Date(2026, 9, 12).toString())
    expect(new Date(ruhe('drei', s).bis!).toString()).toBe(new Date(2026, 9, 14).toString())
    expect(new Date(ruhe('woche', s).bis!).toString()).toBe(new Date(2026, 9, 12).toString())
    const montag = { sitzung: 'A', jetzt: new Date(2026, 9, 12, 9).getTime() }
    expect(new Date(ruhe('woche', montag).bis!).toString()).toBe(new Date(2026, 9, 19).toString())
    expect(ruhe('sitzung', s)).toEqual({ sitzung: 'A' })
  })

  test('Sitzung, Ruhe und Zeitstempel überstehen die Datei', async () => {
    const text = ablageText({ punkte: [punktSitzungen('a', { sitzung: 'A', ruht: { bis: SONNTAG + 86_400_000 }, geaendert: 3 })], ueberblick: '' }, SONNTAG)
    expect(text).toContain('a (ruht bis Mo 12.10.)')
    expect(ablageLesen(text)?.punkte[0]).toMatchObject({ sitzung: 'A', ruht: { bis: SONNTAG + 86_400_000 }, geaendert: 3 })
  })
})

describe('Nummern, Termin und eigene Punkte', () => {
  test('/offen liest später mit Termin und neu mit Text (Groß- und Kleinschreibung bleibt)', async () => {
    expect(kommando('3 später morgen')).toEqual({ art: 'punkt', nummer: 3, tun: 'spaeter', bis: 'morgen' })
    expect(kommando('3 spaeter woche')).toEqual({ art: 'punkt', nummer: 3, tun: 'spaeter', bis: 'woche' })
    expect(kommando('3 später')).toEqual({ art: 'punkt', nummer: 3, tun: 'spaeter' })
    expect(kommando('3 a c')).toEqual({ art: 'punkt', nummer: 3, tun: 'optionen', optionen: [0, 2] })
    expect(kommando('3 c,a,c')).toEqual({ art: 'punkt', nummer: 3, tun: 'optionen', optionen: [0, 2] })
    expect(kommando('3 b')).toEqual({ art: 'punkt', nummer: 3, tun: 'option', option: 1 })
    expect(kommando('3 später gestern').art).toBe('fehler')
    expect(kommando('3 erledigt morgen').art).toBe('fehler')
    expect(kommando('neu Mail an Kai schreiben')).toEqual({ art: 'neu', text: 'Mail an Kai schreiben' })
    expect(kommando('Neu  zwei\nZeilen')).toEqual({ art: 'neu', text: 'zwei\nZeilen' })
    expect(kommando('neu').art).toBe('fehler')
  })

  test('eigener Punkt: Titel aus den ersten Wörtern, ohne Antworten; die Auswertung lässt ihn in Ruhe', async () => {
    const p = notiz('Schnellumschalter für alle laufenden Projekte, mit Zuständen.', 'n1', 5, 'A')
    expect([p.titel, p.frage, p.optionen, p.vonNutzer, p.sitzung]).toEqual(['Schnellumschalter für alle laufenden Projekte …', 'Schnellumschalter für alle laufenden Projekte, mit Zuständen.', [], true, 'A'])
    expect(notiz('Kurz.', 'n2', 5, '').titel).toBe('Kurz')
    const l = zusammenfuehren([{ ...p, nr: 1 }], { neu: [], aktualisiert: [{ id: 'n1', frage: 'anders?' }], erledigt: ['n1'], erwaehnt: [], ueberblick: '' }, 6, () => 'x')
    expect([l[0]?.status, l[0]?.frage, l[0]?.ohneBezug]).toEqual(['offen', p.frage, 0])
    const text = ablageText({ punkte: [{ ...p, nr: 1 }], ueberblick: '' }, 1)
    expect(text).not.toContain('Möglichkeiten')
    expect(ablageLesen(text)?.punkte[0]?.vonNutzer).toBe(true)
  })

  test('der Zähler übersteht die Datei; geschlossene behalten ihre Nummer; der Verlauf nennt sie', async () => {
    const text = ablageText({ punkte: [punktSitzungen('a', { nr: 3, status: 'erledigt' }), punktSitzungen('b', { nr: 4 })], ueberblick: '', hoechsteNr: 9 }, 1)
    const a = ablageLesen(text)!
    expect([a.hoechsteNr, a.punkte.map(p => p.nr)]).toEqual([9, [4, 3]])
    // Ältere Datei ohne Zähler: die höchste Nummer in der Liste
    expect(ablageLesen(text.replace(',"hoechsteNr":9', ''))?.hoechsteNr).toBe(4)

    const e = verlaufsEintraege([punktSitzungen('b', { nr: 4 })], [punktSitzungen('b', { nr: 4, status: 'erledigt', ergebnis: 'Ja' })], SONNTAG)
    expect(e[0]).toContain('## 14:00 · #4 b – entschieden')
    expect(hoechsteImVerlauf(`${e[0]}\n### 09:00 · #12 alt – verworfen\n## 10:00 · ohne Nummer – entschieden\n`)).toBe(12)
  })
})

describe('Doppelte Nummern (0.11.1)', () => {
  test('zwei Sitzungen zählen beide #1: die jüngere offene bekommt eine neue Nummer, geschlossene bleiben', async () => {
    // Sitzung A (Datei): #1 lange geschlossen, #41 offen. Sitzung B hat ohne Zählerstand eine eigene #1 vergeben.
    const datei = [punktSitzungen('alt', { nr: 1, titel: 'Alter Punkt', status: 'erledigt', erstellt: 10 }),
      punktSitzungen('a41', { nr: 41, titel: 'Offen in A', erstellt: 20 })]
    const b = [punktSitzungen('neu', { nr: 1, titel: 'Neu in B', erstellt: 30 })]
    const liste = abgleichen(b, datei, 41)
    const nr = (id: string) => liste.find(p => p.id === id)?.nr
    expect(nr('neu')).toBe(42)
    expect(nr('alt')).toBe(1)
    expect(nr('a41')).toBe(41)
    // Gegenprobe: ohne Kollision bleibt jede Nummer, wie sie ist
    const ohne = abgleichen([punktSitzungen('x', { nr: 42, erstellt: 30 })], datei, 41)
    expect(ohne.find(p => p.id === 'x')?.nr).toBe(42)
  })

  test('zwei offene mit gleicher Nummer: der ältere behält sie; auch beim Einlesen der Datei', async () => {
    const roh = ablageText({ punkte: [punktSitzungen('frueh', { nr: 1, erstellt: 5 }), punktSitzungen('spaet', { nr: 1, erstellt: 9 })], ueberblick: '', hoechsteNr: 7 }, 1)
    const gelesen = ablageLesen(roh)?.punkte ?? []
    expect(gelesen.find(p => p.id === 'frueh')?.nr).toBe(1)
    expect(gelesen.find(p => p.id === 'spaet')?.nr).toBe(8)
  })
})

describe('Bekannte Punkte', () => {
  test('aktualisiert schärft nach, erwähnt setzt den Zähler zurück, sonst zählt er hoch', async () => {
    const a = lies(JSON.stringify({ neu: [], aktualisiert: [{ id: 'a', anleitung: 'neu', stufe: 'blockiert', titel: 'ignoriert' }], erwaehnt: ['b'], erledigt: [] }))
    expect(a?.aktualisiert).toEqual([{ id: 'a', anleitung: 'neu', stufe: 'blockiert' }])
    const liste = zusammenfuehren([punktNeu('a', { ohneBezug: 4 }), punktNeu('b', { ohneBezug: 4 }), punktNeu('c', { ohneBezug: 4 })], a as Auswertung, 2, () => 'n')
    expect(liste.map(p => [p.id, p.titel, p.anleitung, p.stufe, p.ohneBezug])).toEqual([
      ['a', 'a', 'neu', 'blockiert', 0],
      ['b', 'b', '', undefined, 0],
      ['c', 'c', '', undefined, 5],
    ])
  })

  test('Reihenfolge: blockiert vor normal vor Angebot, Veraltetes zuletzt', async () => {
    const liste = [
      punktNeu('angebot', { stufe: 'angebot', erstellt: 1 }),
      punktNeu('alt', { stufe: 'blockiert', ohneBezug: VERALTET_NACH }),
      punktNeu('normal', { erstellt: 2 }),
      punktNeu('block', { stufe: 'blockiert', erstellt: 3 }),
    ]
    expect(offene(liste).map(p => p.id)).toEqual(['block', 'normal', 'angebot', 'alt'])
    expect(statuszeile(liste, false)).toBe('■ 4 offen (2 blockiert) · /offen')
  })
})

describe('Ausstehende Antworten', () => {
  test('feste Nummern: fortlaufend über der höchsten, vergebene bleiben, auch geschlossene', async () => {
    const l = nummerieren([punktNeu('a', { nr: 2 }), punktNeu('b'), punktNeu('c', { status: 'erledigt', nr: 1 }), punktNeu('d')])
    expect(l.map(p => [p.id, p.nr])).toEqual([['a', 2], ['b', 3], ['c', 1], ['d', 4]])
    // ab: höchste je vergebene, auch wenn der Punkt nicht mehr in der Liste steht
    expect(nummerieren([punktNeu('e')], 7)[0]?.nr).toBe(8)
  })

  test('ausstehend: nicht mehr gefragt, schließt sich erst beim Abschließen; in offen.md wieder offen', async () => {
    const l = [punktNeu('a', { nr: 1, ausstehend: JA }), punktNeu('b', { nr: 2 })]
    expect(offene(l).map(p => p.id)).toEqual(['b'])
    const zu = abschliessen(l, new Set(['a']))[0]!
    expect([zu.status, zu.ergebnis, zu.ausstehend]).toEqual(['erledigt', 'Ja – „Ja.“', undefined])
    expect(zuruecknehmen(l)[0]!.ausstehend).toBeUndefined()
    const text = ablageText({ punkte: l, ueberblick: '' }, 1)
    expect(text).toContain('### 1. a')
    const a = ablageLesen(text)?.punkte[0]
    expect([a?.status, a?.nr, a?.ausstehend]).toEqual(['offen', 1, undefined])
  })

  test('Haiku lässt beantwortete Punkte in Ruhe und legt sie nicht neu an', async () => {
    const a = lies(JSON.stringify({ neu: [{ titel: 'a', art: 'entscheidung', frage: '?', optionen: [{ label: 'x', antwort: 'y' }] }], erledigt: ['a'] }))!
    const l = zusammenfuehren([punktNeu('a', { ausstehend: JA })], a, 2, () => 'n')
    expect(l.map(p => [p.id, p.status, p.ausstehend?.text])).toEqual([['a', 'offen', 'Ja.']])
  })

  test('was in der Nachricht zu einem Punkt steht', async () => {
    const n = 'Zu den offenen Punkten:\n- „A“: Nimm A.\n- „B“: weil x\nzweite Zeile\nZum offenen Punkt „C“: '
    expect(antwortIn(n, 'A')).toBe('Nimm A.')
    expect(antwortIn(n, 'B')).toBe('weil x\nzweite Zeile')
    expect(antwortIn(n, 'C')).toBe('')
    expect(antwortIn(n, 'D')).toBeNull()
  })
})
