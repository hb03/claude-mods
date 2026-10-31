// Die Liste der Punkte: anlegen, schließen, altern, Sitzungen, Ruhe, Abgleich zwischen Sitzungen
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { WOCHENTAG } from './befehle'
import { ANGEBOT_VERFALL, MAX_PUNKTE, VERALTET_NACH } from './grund'
import { zweistellig } from './ablage'
import type { Auswertung } from './auftraege'

/** Ergebnis eines Punkts, den die Auswertung geschlossen hat (davor ggf. „ – Grund“). */
export const ERKANNT = 'laut Gespräch erledigt'

/** So lange zeigen /offen und claude-web automatisch geschlossene Punkte mit „wieder öffnen“. */
export const AUTO_ZEIGEN_MS = 24 * 3600 * 1000

/**
 * Was lange keine Rolle mehr spielt, schließt sich selbst statt „noch aktuell?“ zu fragen:
 * nach VERALTET_NACH Auswertungen ohne Bezug, ein Angebot schon nach ANGEBOT_VERFALL.
 * Zurückgelegtes, Zurückgestelltes und selbst Notiertes bleibt - darüber hat der Nutzer entschieden.
 */
export function veraltetSchliessen(liste: readonly Punkt[], jetzt: number): Punkt[] {
  return liste.map(p => {
    if (p.status !== 'offen' || p.ausstehend !== undefined || p.vonNutzer === true || p.ruht !== undefined || p.zurueckgestellt > 0) return p
    const n = p.ohneBezug ?? 0
    const angebot = p.stufe === 'angebot' && n >= ANGEBOT_VERFALL
    if (!angebot && n < VERALTET_NACH) return p
    const grund = angebot ? `Angebot nicht aufgegriffen (${n} Antworten lang)` : `veraltet – ${n} Antworten lang nicht mehr erwähnt`
    return { ...p, status: 'erledigt' as const, ergebnis: grund, auto: { grund, zeit: jetzt }, geaendert: jetzt }
  })
}

/** Automatisch geschlossene Punkte, die noch angezeigt werden (neueste zuerst). */
export const autoErledigt = (liste: readonly Punkt[], jetzt: number): Punkt[] =>
  liste.filter(p => p.status === 'erledigt' && p.auto !== undefined && jetzt - p.auto.zeit < AUTO_ZEIGEN_MS)
    .sort((a, b) => (b.auto?.zeit ?? 0) - (a.auto?.zeit ?? 0))

/** Für den Vergleich gleicher Punkte: klein, ohne Satzzeichen. */
export const schluessel = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Führt eine Auswertung in die Liste: erledigte schließen, bekannte nachschärfen,
 * neue anhängen (ein Punkt mit gleichem Titel wie ein offener kommt nicht doppelt).
 * Offene Punkte ohne Bezug in dieser Antwort zählen einen Schritt Richtung veraltet.
 */
export function zusammenfuehren(punkte: readonly Punkt[], a: Auswertung, jetzt: number, neueId: () => string, ab = 0, sitzung = ''): Punkt[] {
  const erledigt = new Set(a.erledigt)
  const aenderungen = new Map(a.aktualisiert.map(x => [x.id, x]))
  const bezug = new Set([...a.erwaehnt, ...aenderungen.keys()])

  const liste = punkte.map(p => {
    // Claude ändert einen erledigten (auch gerade beantworteten) Punkt: er ist wieder offen.
    if (p.status === 'erledigt' && p.vonNutzer !== true && aenderungen.has(p.id)) {
      const { id: _id, ...felder } = aenderungen.get(p.id)!
      const { ergebnis: _e, auto: _a, beiClaude: _b, ruht: _r, ...rest } = p
      return { ...rest, ...felder, status: 'offen' as const, ohneBezug: 0, zurueckgestellt: 0, geaendert: jetzt }
    }
    // Schon beantwortet (nur noch nicht bei Claude): gilt als geschlossen.
    // Vom Nutzer selbst angelegt: bleibt, wie er ist, bis er ihn beantwortet.
    if (p.status !== 'offen' || p.ausstehend !== undefined || p.vonNutzer === true) return p
    if (erledigt.has(p.id)) {
      const grund = a.gruende?.[p.id] ?? ''
      return { ...p, status: 'erledigt' as const, ergebnis: ERKANNT + (grund !== '' ? ` – ${grund}` : ''),
               auto: { grund: grund || ERKANNT, zeit: jetzt }, geaendert: jetzt }
    }
    const { id: _id, ...felder } = aenderungen.get(p.id) ?? { id: '' }
    // Claude ändert einen Punkt aus dem Planungsinterview: das Interview ist durch, der Rest wird wieder gefragt.
    if (p.ruht?.interview === true && aenderungen.has(p.id)) {
      const { ruht: _r, ...rest } = p
      return { ...rest, ...felder, ohneBezug: 0 }
    }
    return { ...p, ...felder, ohneBezug: bezug.has(p.id) ? 0 : (p.ohneBezug ?? 0) + 1 }
  })
  // Nicht neu anlegen, was offen ist oder vor kurzem geschlossen wurde („das ist doch ein alter Punkt“).
  const vorhanden = new Set(liste
    .filter(p => p.status === 'offen' || jetzt - (p.geaendert ?? p.erstellt) < WIEDER_NEU_NACH_MS)
    .map(p => schluessel(p.titel)))

  for (const n of a.neu) {
    const s = schluessel(n.titel)
    if (vorhanden.has(s)) continue
    vorhanden.add(s)
    // Mit Sitzung: ohne sie hielt der Abgleich einer anderen Sitzung den Punkt für „unbekannt“ (fremd für alle).
    liste.push({ id: neueId(), ...n, status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: jetzt, ...(sitzung !== '' ? { sitzung } : {}) })
  }

  return nummerieren(begrenzen(veraltetSchliessen(liste, jetzt)), ab)
}

/** So lange nach dem Schließen legt die Auswertung einen Punkt mit gleichem Titel nicht neu an. */
export const WIEDER_NEU_NACH_MS = 3 * 24 * 3600_000

/** Die höchste Nummer in der Liste, offen oder geschlossen (0: keine). */
export const hoechsteNr = (liste: readonly Punkt[]): number => Math.max(0, ...liste.map(p => p.nr ?? 0))

/**
 * Gibt offenen Punkten ohne Nummer die nächste: fortlaufend je Projekt, über der höchsten
 * in der Liste und über ab (höchste je vergebene). Eine Nummer kommt nie zweimal vor und
 * bleibt am Punkt, auch geschlossen - "#12" meint im Verlauf immer denselben Punkt.
 */
export function nummerieren(liste: readonly Punkt[], ab = 0): Punkt[] {
  let n = Math.max(ab, hoechsteNr(liste))
  return liste.map(p => (p.status === 'offen' && p.nr === undefined ? { ...p, nr: ++n } : p))
}

/** Die beantworteten, noch nicht gesendeten Punkte (wo: nur diese), in der Reihenfolge der Antworten. */
export function ausstehende(punkte: readonly Punkt[], wo?: 'sammlung' | 'eingabe'): Punkt[] {
  return punkte
    .filter(p => p.status === 'offen' && p.ausstehend !== undefined && (wo === undefined || p.ausstehend.wo === wo))
    .sort((a, b) => (a.ausstehend?.reihe ?? 0) - (b.ausstehend?.reihe ?? 0))
}

/**
 * Die Antworten sind bei Claude: die Punkte schließen sich (ergebnisse: abweichendes Ergebnis je id).
 * Mit gesendet (wann die Nachricht abging) liegt eine Antwort danach „bei Claude“, bis er sie
 * umgesetzt meldet, den Punkt wieder öffnet oder der Turn darauf endet (beiClaudeFertig).
 */
export function abschliessen(liste: readonly Punkt[], ids: ReadonlySet<string>, ergebnisse: ReadonlyMap<string, string> = new Map(), gesendet?: number): Punkt[] {
  return liste.map(p => {
    if (!ids.has(p.id) || p.ausstehend === undefined) return p
    const { ausstehend: a, ...rest } = p
    return { ...rest, status: a.status, ergebnis: ergebnisse.get(p.id) ?? a.ergebnis,
             ...(gesendet !== undefined && a.status === 'erledigt' ? { beiClaude: gesendet } : {}) }
  })
}

/**
 * Ein Turn ist fertig: trug er die Antwort (turnText) oder begann er erst nach dem Senden
 * (turnStart), bleibt der Punkt ohne Marke und ohne Änderung von Claude beantwortet - nur
 * „bei Claude“ fällt weg. Ein Turn, der schon lief, als die Antwort abging, zählt nicht.
 */
export function beiClaudeFertig(liste: readonly Punkt[], turnStart: number, turnText = ''): Punkt[] {
  const fertig = (p: Punkt) => p.beiClaude !== undefined && (p.beiClaude < turnStart || (turnText !== '' && antwortIn(turnText, p.titel) !== null))
  if (!liste.some(fertig)) return liste as Punkt[]
  return liste.map(p => {
    if (!fertig(p)) return p
    const { beiClaude: _b, ...rest } = p
    return rest
  })
}

/** Die Antworten kamen nicht an: die Punkte werden wieder gefragt (ids fehlt: alle). */
export function zuruecknehmen(liste: readonly Punkt[], ids?: ReadonlySet<string>): Punkt[] {
  return liste.map(p => {
    if (p.ausstehend === undefined || (ids !== undefined && !ids.has(p.id))) return p
    const { ausstehend: _a, ...rest } = p
    return rest
  })
}

/**
 * Was der Nutzer in der abgeschickten Nachricht zu einem Punkt geschrieben hat: der Text
 * nach „Titel“: bis zur nächsten Antwort. null: der Punkt steht nicht (mehr) darin.
 */
export function antwortIn(nachricht: string, titel: string): string | null {
  // „Titel“: oder „Titel“ (Frage): - die Frage steht bei Block-Punkten dabei.
  const anfang = nachricht.indexOf(`„${titel}“`)
  if (anfang < 0) return null
  const marke = /^„[^“]*“(?:[ \t]*\([^)\n]*\))?:/.exec(nachricht.slice(anfang))
  if (marke === null) return null
  const rest = nachricht.slice(anfang + marke[0].length)
  const ende = rest.search(/\n(- (?:#\d+ )?„|Zum offenen Punkt (?:#\d+ )?„)/)
  return (ende < 0 ? rest : rest.slice(0, ende)).trim()
}

/**
 * Antworten, die der Nutzer selbst in seine Nachricht geschrieben hat - oder claude-web per tmux:
 * „Zum offenen Punkt #12 „Titel“: Text“, „Zum offenen Punkt „Titel“: Text“ oder Zeilen
 * „- „Titel“: Text“ unter „Zu den offenen Punkten:“. Nur offene, noch nicht beantwortete Punkte;
 * sie schließen sich, sobald die Nachricht bei Claude ist, ohne zweiten Befehl.
 */
export function eingetippteAntworten(nachricht: string, punkte: readonly Punkt[]): { id: string; text: string }[] {
  const offen = offene(punkte)
  if (offen.length === 0 || !/offenen Punkt/i.test(nachricht)) return []
  const aus: { id: string; text: string }[] = []
  const muster = /(?:Zum offenen Punkt|^[ \t]*-)[ \t]*(?:#(\d+)[ \t]*)?„([^“\n]+)“(?:[ \t]*\([^)\n]*\))?:[ \t]*([^\n]*)/gm
  for (const m of nachricht.matchAll(muster)) {
    const text = (m[3] ?? '').trim()
    // Die Bitte des Knopfs „Ausführen“ ist keine Antwort: der Punkt bleibt offen, bis Claude ausgeführt hat.
    if (/^Bitte führe aus:/.test(text)) continue
    const nr = m[1] !== undefined ? Number(m[1]) : undefined
    const s = schluessel(m[2] ?? '')
    // Die Nummer gewinnt; der Titel zaehlt nur ohne Nummer oder wenn die Nummer nicht offen ist.
    const p = (nr !== undefined ? offen.find(x => x.nr === nr) : undefined) ?? offen.find(x => schluessel(x.titel) === s)
    if (p === undefined || aus.some(a => a.id === p.id)) continue
    aus.push({ id: p.id, text })
  }
  return aus
}

/** Offene vorne behalten, Erledigtes als Erstes weglassen, wenn es zu viele werden. */
export function begrenzen(liste: readonly Punkt[]): Punkt[] {
  const offen = liste.filter(p => p.status === 'offen')
  const rest = liste.filter(p => p.status !== 'offen')

  // slice(-0) wäre die ganze Liste: ab MAX_PUNKTE offenen bleibt kein Erledigtes stehen.
  const platz = Math.max(0, MAX_PUNKTE - offen.length)
  return [...offen.slice(-MAX_PUNKTE), ...(platz > 0 ? rest.slice(-platz) : [])]
}

export const istVeraltet = (p: Punkt): boolean => (p.ohneBezug ?? 0) >= VERALTET_NACH

const RANG: Record<Stufe, number> = { blockiert: 0, normal: 1, angebot: 2 }

/**
 * Die Punkte, die noch offen sind, in der Reihenfolge, in der gefragt wird:
 * Veraltetes zuletzt, dann Zurückgestelltes, sonst blockierend vor normal vor
 * Angeboten, Älteres zuerst.
 */
export function offene(punkte: readonly Punkt[]): Punkt[] {
  return punkte
    .filter(p => p.status === 'offen' && p.ausstehend === undefined)
    .sort((a, b) =>
      Number(istVeraltet(a)) - Number(istVeraltet(b)) ||
      a.zurueckgestellt - b.zurueckgestellt ||
      RANG[a.stufe ?? 'normal'] - RANG[b.stufe ?? 'normal'] ||
      a.erstellt - b.erstellt)
}

/** Eine Antwort, die auf ":" endet, braucht noch Text des Nutzers - nur vorbereiten. */
export const brauchtErgaenzung = (antwort: string): boolean => /:\s*$/.test(antwort)

/**
 * Eine Antwort, die einen offenen Punkt nicht
 * erwähnt (weder „#Nr“ noch Titel), zählt ihn einen Schritt Richtung veraltet.
 */
export function altern(liste: readonly Punkt[], antwort: string, jetzt: number): Punkt[] {
  const t = schluessel(antwort)
  const gealtert = liste.map(p => {
    if (p.status !== 'offen' || p.ausstehend !== undefined || p.vonNutzer === true) return p
    const erwaehnt = (p.nr !== undefined && new RegExp(`#${p.nr}(?!\\d)`).test(antwort)) || t.includes(schluessel(p.titel))
    return { ...p, ohneBezug: erwaehnt ? 0 : (p.ohneBezug ?? 0) + 1 }
  })
  return veraltetSchliessen(gealtert, jetzt)
}

/** Ein Punkt, den der Nutzer selbst notiert (/offen neu): Titel aus den ersten Wörtern, ohne feste Antworten. */
export function notiz(text: string, id: string, jetzt: number, sitzung: string): Punkt {
  const frage = text.replace(/\s+/g, ' ').trim().slice(0, 2000)
  const woerter = frage.split(' ')
  let titel = woerter.slice(0, 5).join(' ').replace(/[.,;:!?]+$/, '')
  if (titel.length > 60) titel = titel.slice(0, 59).trimEnd() + '…'
  else if (woerter.length > 5) titel += ' …'
  return {
    id, titel, frage, info: 'Vom Nutzer notiert.', art: 'entscheidung', stufe: 'normal', abwaegung: '', anleitung: '',
    optionen: [], status: 'offen', zurueckgestellt: 0, ohneBezug: 0, erstellt: jetzt, vonNutzer: true,
    ...(sitzung !== '' ? { sitzung } : {}),
  }
}

const RAHMEN: Record<Stufe, string> = { blockiert: 'blockiert', normal: '', angebot: 'Angebot' }

/** Zusatz zum Titel: blockiert, Angebot, veraltet, zurückgestellt, ruhend, aus anderer Sitzung. */
export function vermerk(p: Punkt, s?: Sicht): string {
  const teile = [
    RAHMEN[p.stufe ?? 'normal'], istVeraltet(p) ? 'noch aktuell?' : '', p.zurueckgestellt > 0 ? 'zurückgestellt' : '',
    s !== undefined ? ruheVermerk(p, s) : '', s !== undefined && fremd(p, s.sitzung) ? 'aus anderer Sitzung' : '',
  ].filter(t => t !== '')
  return teile.length > 0 ? ` (${teile.join(', ')})` : ''
}

/** Zeile für die Statusleiste; mit Sicht zählen nur die Punkte, die gefragt werden, der Rest als "weitere". */
export function statuszeile(punkte: readonly Punkt[], prueft: boolean, s?: Sicht): string | undefined {
  const liste = s !== undefined ? fragbar(punkte, s) : offene(punkte)
  const n = liste.length
  const weitere = offene(punkte).length - n
  // "1 zurückgelegt bis Mo 12.10." oder "6 zurückgelegt – nächster Mo 12.10."
  const ende = s !== undefined ? ruheEnde(punkte, s) : ''
  const zurueck = `${weitere} zurückgelegt${ende === '' ? '' : weitere === 1 || !/\d/.test(ende) ? ` bis ${ende}` : ` – nächster ${ende}`}`
  if (n === 0) {
    if (weitere > 0) return `◇ ${zurueck}${prueft ? ' …' : ''} · /offen`
    return prueft ? '◇ prüft auf offene Punkte …' : undefined
  }
  const blockiert = liste.filter(p => p.stufe === 'blockiert').length
  const aufgaben = liste.filter(p => p.art === 'aufgabe').length
  const zusatz = [blockiert > 0 ? `${blockiert} blockiert` : '', aufgaben > 0 ? `${aufgaben} zu tun` : ''].filter(t => t !== '')

  if (weitere > 0) zusatz.push(zurueck)

  return `${blockiert > 0 ? '■' : '◆'} ${n} offen${zusatz.length > 0 ? ` (${zusatz.join(', ')})` : ''}${prueft ? ' …' : ''} · /offen`
}

/** Wer schaut und wann: entscheidet, welche Punkte gefragt werden. */
export type Sicht = { sitzung: string; jetzt: number }

/** Ohne bekannte Sitzung (vor 0.16.9 ohne Stempel angelegt, im Abgleich „unbekannt“): gehört jeder Sitzung. */
export const herrenlos = (p: Punkt): boolean => p.sitzung === undefined || p.sitzung === '' || p.sitzung === 'unbekannt'

/** Ein Punkt, den eine andere Sitzung im selben Projekt führt. */
export const fremd = (p: Punkt, sitzung: string): boolean =>
  !herrenlos(p) && sitzung !== '' && p.sitzung !== sitzung

/**
 * Wenn nichts zu fragen ist: nicht „nichts offen“, solange /offen noch Punkte zeigt - sagen, wem
 * sie gehören (andere Sitzungen) oder dass sie ruhen. tipp hängt den passenden Befehl an.
 */
export function nichtsFragbar(punkte: readonly Punkt[], s: Sicht, tipp = ''): string {
  const alle = offene(punkte)
  const fremde = alle.filter(p => fremd(p, s.sitzung)).length
  const ruhend = alle.filter(p => !fremd(p, s.sitzung) && ruht(p, s)).length
  if (fremde + ruhend === 0) return 'Es ist nichts offen.'
  const teile = [
    fremde > 0 ? `${fremde} ${fremde === 1 ? 'Punkt gehört einer anderen Sitzung' : 'Punkte gehören anderen Sitzungen'}` : '',
    ruhend > 0 ? `${ruhend} ${ruhend === 1 ? 'Punkt ist' : 'Punkte sind'} zurückgelegt` : '',
  ].filter(t => t !== '')
  return `In dieser Sitzung ist nichts offen – ${teile.join(', ')}. /offen zeigt sie${tipp}.`
}

/** Zurückgelegt und noch nicht wieder dran. */
export const ruht = (p: Punkt, s: Sicht): boolean =>
  p.ruht !== undefined && ((p.ruht.bis !== undefined && s.jetzt < p.ruht.bis) || (p.ruht.sitzung !== undefined && p.ruht.sitzung === s.sitzung))

/** Was über der Eingabe gefragt wird: offen, aus dieser Sitzung, nicht zurückgelegt. */
export const fragbar = (punkte: readonly Punkt[], s: Sicht): Punkt[] =>
  offene(punkte).filter(p => !fremd(p, s.sitzung) && !ruht(p, s))

export type Ruhezeit = 'sitzung' | 'morgen' | 'drei' | 'woche'

/** Bis wann ein Punkt ruht: nächste Sitzung, oder Mitternacht morgen, in drei Tagen, nächsten Montag. */
export function ruhe(zeit: Ruhezeit, s: Sicht): Ruhe {
  if (zeit === 'sitzung') return { sitzung: s.sitzung }
  const d = new Date(s.jetzt)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + (zeit === 'morgen' ? 1 : zeit === 'drei' ? 3 : (8 - d.getDay()) % 7 || 7))
  return { bis: d.getTime() }
}

export const tagText = (ms: number): string => {
  const d = new Date(ms)
  return `${WOCHENTAG[d.getDay()]} ${zweistellig(d.getDate())}.${zweistellig(d.getMonth() + 1)}.`
}

/** Für die Statuszeile: wann der nächste ruhende Punkt wieder gefragt wird ("Mo 12.10.",
 *  "zur nächsten Sitzung"), leer, wenn nichts ruht. */
export function ruheEnde(punkte: readonly Punkt[], s: Sicht): string {
  const ruhend = offene(punkte).filter(p => ruht(p, s))
  if (ruhend.length === 0) return ''
  const termine = ruhend.flatMap(p => (p.ruht?.bis !== undefined && p.ruht.bis > s.jetzt ? [p.ruht.bis] : []))
  return termine.length > 0 ? tagText(Math.min(...termine)) : 'zur nächsten Sitzung'
}

/** "ruht bis …" – ohne bekannte Sitzung (in der Datei) auch der Vermerk für die nächste Sitzung. */
export function ruheVermerk(p: Punkt, s: Sicht): string {
  if (p.ruht === undefined) return ''
  if (p.ruht.interview === true) return s.sitzung === '' || p.ruht.sitzung === s.sitzung ? 'im Planungsinterview' : ''
  if (p.ruht.bis !== undefined) return p.ruht.bis > s.jetzt ? `ruht bis ${tagText(p.ruht.bis)}` : ''
  return s.sitzung === '' || p.ruht.sitzung === s.sitzung ? 'ruht bis zur nächsten Sitzung' : ''
}

/**
 * Stempelt, wann ein Punkt geschlossen oder wieder geöffnet wurde - damit beim Abgleich
 * ein bewusstes Wiederöffnen gegen ein älteres Schließen gewinnt.
 */
export function stempeln(vorher: readonly Punkt[], nachher: readonly Punkt[], jetzt: number): Punkt[] {
  const alt = new Map(vorher.map(p => [p.id, p.status]))
  return nachher.map(p => {
    const war = alt.get(p.id)
    return war !== undefined && (war === 'offen') !== (p.status === 'offen') ? { ...p, geaendert: jetzt } : p
  })
}

export type Geschlossen = Record<string, Grabstein>

/** So lange bleibt ein Grabstein stehen; länger läuft keine Sitzung, die den Punkt noch offen kennt. */
export const GESCHLOSSEN_HALTEN_MS = 14 * 24 * 3600_000

/** Der Grabstein, wenn der offene Punkt danach geschlossen wurde (nicht, wenn er danach wieder geöffnet wurde). */
const begraben = (p: Punkt, geschlossen: Geschlossen): Grabstein | undefined => {
  const g = geschlossen[p.id]
  return g !== undefined && g.zeit > (p.geaendert ?? 0) ? g : undefined
}

/** Offene Punkte, die laut Grabstein später geschlossen wurden, schließen. */
export function zuGeschlossen(liste: readonly Punkt[], geschlossen: Geschlossen): Punkt[] {
  return liste.map(p => {
    const g = p.status === 'offen' ? begraben(p, geschlossen) : undefined
    if (g === undefined) return p
    const { ausstehend: _a, ruht: _r, ...rest } = p
    return { ...rest, status: g.status, geaendert: g.zeit, ergebnis: g.ergebnis ?? 'in einer anderen Sitzung geschlossen' }
  })
}

/**
 * Die Grabsteine fortschreiben: die neueren aus allen Quellen, dazu jeder geschlossene Punkt der Liste;
 * ein Punkt, der danach wieder geöffnet wurde, verliert seinen. Was älter als GESCHLOSSEN_HALTEN_MS ist, fällt weg.
 */
export function geschlossenFuehren(punkte: readonly Punkt[], jetzt: number, ...quellen: readonly (Geschlossen | undefined)[]): Geschlossen {
  const aus: Geschlossen = {}
  const nehmen = (id: string, g: Grabstein) => {
    if (jetzt - g.zeit < GESCHLOSSEN_HALTEN_MS && (aus[id]?.zeit ?? -1) < g.zeit) aus[id] = g
  }
  for (const q of quellen) for (const [id, g] of Object.entries(q ?? {})) nehmen(id, g)
  for (const p of punkte) {
    if (p.status === 'offen') {
      if ((p.geaendert ?? 0) >= (aus[p.id]?.zeit ?? Infinity)) delete aus[p.id]
      continue
    }
    nehmen(p.id, { status: p.status, zeit: p.geaendert ?? p.erstellt, ...(p.ergebnis !== undefined ? { ergebnis: p.ergebnis.slice(0, 160) } : {}) })
  }
  return aus
}

export function geschlossenLesen(x: unknown): Geschlossen {
  const aus: Geschlossen = {}
  if (typeof x !== 'object' || x === null) return aus
  for (const [id, g] of Object.entries(x as Record<string, unknown>)) {
    if (typeof g !== 'object' || g === null) continue
    const r = g as Record<string, unknown>
    if ((r.status !== 'erledigt' && r.status !== 'verworfen') || typeof r.zeit !== 'number') continue
    aus[id] = { status: r.status, zeit: r.zeit, ...(typeof r.ergebnis === 'string' ? { ergebnis: r.ergebnis.slice(0, 160) } : {}) }
  }
  return aus
}

/**
 * Führt den Stand aus offen.md - auch von einer anderen Sitzung im selben Projekt geschrieben -
 * in die eigene Liste. Geschlossen gewinnt, außer der Punkt wurde hier danach wieder geöffnet.
 * Was nur in der Datei steht, kommt dazu und behält seine Sitzung: steht in /offen, wird
 * aber nicht gefragt.
 */
export function abgleichen(eigene: readonly Punkt[], datei: readonly Punkt[], ab = 0, geschlossen: Geschlossen = {}): Punkt[] {
  const dort = new Map(datei.map(p => [p.id, p]))
  const liste = zuGeschlossen(eigene, geschlossen).map(p => {
    const d = dort.get(p.id)
    if (d === undefined) return p
    // Geprüft (Abgleich) gilt für alle Sitzungen: sonst prüft die nächste denselben Punkt noch einmal.
    if ((d.geprueft ?? 0) > (p.geprueft ?? 0)) p = { ...p, geprueft: d.geprueft }
    if (p.status !== 'offen' || d.status === 'offen') return p
    // Hier wieder geöffnet, nicht vor dem Schließen dort: bleibt offen.
    if (p.geaendert !== undefined && p.geaendert >= (d.geaendert ?? 0)) return p
    const { ausstehend: _a, ruht: _r, ergebnis: _e, ...rest } = p
    return { ...rest, status: d.status, geaendert: d.geaendert, ...(d.ergebnis !== undefined ? { ergebnis: d.ergebnis } : {}) }
  })
  const bekannt = new Set(eigene.map(p => p.id))
  const vergeben = new Set(liste.map(p => p.nr).filter(n => n !== undefined))
  for (const d of datei) {
    // Offen in der Datei, aber schon geschlossen (eine Sitzung kannte ihn noch offen): nicht wieder aufnehmen.
    if (bekannt.has(d.id) || (d.status === 'offen' && begraben(d, geschlossen) !== undefined)) continue
    const { ausstehend: _a, nr, ...rest } = d
    const p = { ...rest, sitzung: d.sitzung ?? 'unbekannt' }
    // Offen und hier schon vergeben (zwei Sitzungen zugleich): bekommt eine neue.
    if (nr !== undefined && (d.status !== 'offen' || !vergeben.has(nr))) {
      vergeben.add(nr)
      liste.push({ ...p, nr })
    } else liste.push(p)
  }

  return nummerieren(begrenzen(doppelteLoesen(liste)), ab)
}

/**
 * Eine Nummer gehört genau einem Punkt. Tragen mehrere dieselbe (eine Sitzung hat ohne Zählerstand
 * gezählt), behält sie der älteste; offene Nachzügler verlieren sie und bekommen eine neue,
 * geschlossene behalten sie für den Verlauf.
 */
export function doppelteLoesen(liste: readonly Punkt[]): Punkt[] {
  const erster = new Map<number, Punkt>()
  for (const p of [...liste].sort((a, b) => a.erstellt - b.erstellt)) {
    if (p.nr !== undefined && !erster.has(p.nr)) erster.set(p.nr, p)
  }
  return liste.map(p => {
    if (p.nr === undefined || p.status !== 'offen' || erster.get(p.nr)?.id === p.id) return p
    const { nr: _n, ...rest } = p
    return rest
  })
}

/**
 * Offene Punkte einer Sitzung, die es nicht mehr gibt (Start, /clear), werden die eigenen. Punkte
 * einer Sitzung, die noch lebt (Lebenszeichen in .sitzungen/), bleiben ihre: sonst fragten beide dasselbe.
 */
export const uebernehmen = (liste: readonly Punkt[], sitzung: string, nur?: string, lebende?: ReadonlySet<string>): Punkt[] =>
  liste.map(p => (p.status === 'offen' && (nur === undefined || p.sitzung === nur || herrenlos(p)) &&
    !(p.sitzung !== undefined && lebende?.has(p.sitzung) === true) ? { ...p, sitzung } : p))
