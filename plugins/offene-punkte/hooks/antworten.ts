// Antworten ueber der Eingabe: waehlen, sammeln, senden, Countdown
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Ausstehend, Punkt } from '../types'
import {
  WARTEZEIT, abschliessen, ausfuehrBitte, ausstehende, befehle, befehlLabel, bitteZu, brauchtErgaenzung, fragbar, istVeraltet, ruhe, sammelText,
  zuruecknehmen,
} from './logik'
import type { Ruhezeit, Teil } from './logik'
import {
  ABSCHICKEN_NACH, AKTUELL, ANS_ENDE, BEFEHL, EIGENE, ERKLAEREN, ERLEDIGT, INTERVIEW, KLAEREN, RUHE, SPAETER, VERWERFEN, unterwegs, z,
} from './zustand'
import { aendere, nutzung, sicht } from './dateien'
import { setzeStatus } from './kommandos'
import { KEINE } from './zustand'

// Die Zustandsreferenzen stehen in jeder Datei, die sie liest oder schreibt: der Lader der Engine
// nimmt an read/update nur Referenzen aus derselben Datei (kein Import).
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const eigeneA = atom({ plugin: 'offene-punkte', key: 'eigene' } as const, '')
const spaeterA = atom({ plugin: 'offene-punkte', key: 'spaeter' } as const, '')
const abschickenA = atom({ plugin: 'offene-punkte', key: 'abschicken' } as const, { sekunden: 0, inEingabe: false })

export const teileVon = (punkte: readonly Punkt[]): Teil[] => punkte.map(p => {
  const text = p.ausstehend?.text ?? ''
  // Nur ein Label (Block-Punkt): die Frage kommt dazu, damit Claude den Bezug auch nach einer Compaction kennt.
  const kurz = text !== '' && p.optionen.some(o => o.antwort === text && o.label === text)
  return { titel: p.titel, text, ...(p.nr !== undefined ? { nr: p.nr } : {}), ...(kurz ? { frage: p.frage } : {}) }
})

export const naechsteReihe = (liste: readonly Punkt[]) => Math.max(0, ...liste.map(p => p.ausstehend?.reihe ?? 0)) + 1

/** Was gesammelt auf das Senden wartet. */
export const gesammelt = (punkte: readonly Punkt[]) => ausstehende(punkte, 'sammlung').filter(p => !unterwegs.has(p.id))

/** Eine Antwort, wie sie gewaehlt wurde: Status beim Schliessen, Label fuers Ergebnis, Text fuer Claude. */
export type Wahl = { status: Ausstehend['status']; label: string; text: string }

export const ergebnis = (w: Wahl, text: string) => (text !== '' ? `${w.label} – „${text}“` : w.label)

/** Das Gesammelte als eine Nachricht an Claude; die Punkte schliessen sich, sobald sie angekommen ist. */
export async function senden($: EngineInterface, wo: 'sammlung' | 'eingabe' = 'sammlung') {
  z.zeitgeber?.cancel()
  z.zeitgeber = null
  await anhalten($)
  const liste = ausstehende(await read($, punkteA), wo).filter(p => !unterwegs.has(p.id))
  if (liste.length === 0) return
  const ids = new Set(liste.map(p => p.id))
  for (const id of ids) unterwegs.add(id)
  const text = sammelText(teileVon(liste))
  const gesendet = await $.clock.now()
  // Haiku soll bei der naechsten Auswertung wissen, was der Nutzer gerade beantwortet hat.
  z.letzteEingabe = text
  // Als eigene Nachricht des Nutzers; laeuft gerade eine Antwort, kommt sie danach. Ausserhalb
  // des aufrufenden Hooks: aus /offen (command.run) heraus lehnt die Engine ein submit ab.
  $.clock.after(0, () => {
    void $.prompt.submit({ text, asUser: true })
      .then(r => aendere($, l => ('drop' in r && r.drop !== undefined ? zuruecknehmen(l, ids) : abschliessen(l, ids, undefined, gesendet))))
      .catch(async fehler => {
        $.ui.log(`offene-punkte: nicht gesendet (${String(fehler)})`)
        await aendere($, l => zuruecknehmen(l, ids))
      })
      .finally(() => {
        for (const id of ids) unterwegs.delete(id)
      })
  })
}

/**
 * Nach einer Wahl: ist keine aktuelle Frage mehr offen (zurueckgestellte und veraltete zaehlen
 * nicht), geht das Gesammelte los, sonst WARTEZEIT nach dieser Wahl.
 */
export async function weiter($: EngineInterface) {
  const punkte = await read($, punkteA)
  if (gesammelt(punkte).length === 0) return
  const rest = fragbar(punkte, await sicht($)).filter(p => !istVeraltet(p) && p.zurueckgestellt === 0)
  if (rest.length === 0) return alleBeantwortet($)
  z.zeitgeber?.cancel()
  z.zeitgeber = $.clock.after(WARTEZEIT, () => {
    void senden($).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
  })
}

/**
 * Die letzte offene Frage ist beantwortet: die Antworten kommen in die leere Eingabe (Enter
 * schickt sofort) und gehen nach ABSCHICKEN_NACH Sekunden von selbst los. Ist die Eingabe
 * belegt oder laesst sie sich nicht fuellen, bleiben sie gesammelt - ebenfalls mit Countdown.
 */
async function alleBeantwortet($: EngineInterface) {
  z.zeitgeber?.cancel()
  z.zeitgeber = null
  const mit = gesammelt(await read($, punkteA))
  if (mit.length === 0) return
  const box = await $.prompt.read().catch(() => null)
  z.vorschlag = ''
  if (box !== null && box.text.trim() === '') {
    const text = sammelText(teileVon(mit))
    const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => null)
    if (r !== null && r.isFilled) {
      z.vorschlag = text
      const ids = new Set(mit.map(p => p.id))
      await aendere($, l => l.map(p => (ids.has(p.id) && p.ausstehend !== undefined ? { ...p, ausstehend: { ...p.ausstehend, wo: 'eingabe' as const } } : p)))
    }
  }
  await zaehlen($, ABSCHICKEN_NACH)
}

async function zaehlen($: EngineInterface, n: number) {
  z.ticker?.cancel()
  z.ticker = null
  if (n <= 0) return abschicken($)
  await update($, abschickenA, () => ({ sekunden: n, inEingabe: z.vorschlag !== '' }))
  z.ticker = $.clock.after(1000, () => {
    void zaehlen($, n - 1).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
  })
}

/** Countdown aus; was in der Eingabe steht, bleibt dort und geht mit Enter. */
export async function anhalten($: EngineInterface) {
  z.ticker?.cancel()
  z.ticker = null
  if ((await read($, abschickenA)).sekunden !== 0) await update($, abschickenA, () => ({ sekunden: 0, inEingabe: false }))
}

/** Countdown abgelaufen oder "Jetzt senden": abschicken, was wartet. */
export async function abschicken($: EngineInterface) {
  const text = z.vorschlag
  z.vorschlag = ''
  if (text === '') return senden($)
  // Nur, wenn noch genau unser Text in der Eingabe steht - sonst hat der Nutzer uebernommen.
  const box = await $.prompt.read().catch(() => null)
  if (box === null || box.text.trimEnd() !== text.trimEnd()) return anhalten($)
  await $.prompt.fill({ text: '', mode: 'replace' })
  await senden($, 'eingabe')
}

/** Text in die Eingabe: eine leere bekommt ihn ganz, an Angefangenes kommt er in einer neuen Zeile. */
export async function eintragen($: EngineInterface, text: string) {
  const box = await $.prompt.read()
  if (box.text.trim() === '') await $.prompt.fill({ text, mode: 'replace' })
  else await $.prompt.fill({ text: `${box.text.endsWith('\n') ? '' : '\n'}${text}`, mode: 'append' })
}

/**
 * Antwort in die Eingabe statt abschicken: der Nutzer ergaenzt und schickt selbst ab. Was
 * gesammelt wartet, kommt mit; der Punkt schliesst sich mit der Nachricht.
 */
async function inEingabe($: EngineInterface, punkt: Punkt, w: Wahl) {
  z.zeitgeber?.cancel()
  z.zeitgeber = null
  z.vorschlag = ''
  await anhalten($)
  const mit = gesammelt(await read($, punkteA))
  const ids = new Set(mit.map(p => p.id))
  await aendere($, liste => {
    const reihe = naechsteReihe(liste)
    return liste.map(p => {
      if (p.id === punkt.id) return { ...p, ausstehend: { status: w.status, ergebnis: w.label, text: w.text, wo: 'eingabe' as const, reihe } }
      if (ids.has(p.id) && p.ausstehend !== undefined) return { ...p, ausstehend: { ...p.ausstehend, wo: 'eingabe' as const } }
      return p
    })
  })
  await eintragen($, sammelText([...teileVon(mit), { titel: punkt.titel, text: w.text, ...(punkt.nr !== undefined ? { nr: punkt.nr } : {}) }]).trimEnd() + ' ')
}

/** Eine fertige Antwort: gesammelt - oder in die Eingabe, wenn dort schon Antworten auf das Abschicken warten. */
export async function antworten($: EngineInterface, punkt: Punkt, w: Wahl) {
  if (ausstehende(await read($, punkteA), 'eingabe').length > 0) return inEingabe($, punkt, w)
  await aendere($, liste => {
    const reihe = naechsteReihe(liste)
    return liste.map(p => (p.id === punkt.id
      ? { ...p, ausstehend: { status: w.status, ergebnis: ergebnis(w, w.text), text: w.text, wo: 'sammlung' as const, reihe } }
      : p))
  })
  await weiter($)
}

/** Die eigene Antwort aus dem Textfeld. */
export async function eigeneAntwort($: EngineInterface, punkt: Punkt, text: string) {
  await update($, eigeneA, () => '')
  const t = text.trim()
  if (t === '') return
  await antworten($, punkt, { status: 'erledigt', label: 'eigene Antwort', text: t })
}

/** Eine Wahl in der Frage eines Punkts ausfuehren. */
/** Was gewaehlt wurde, als Wort fuer die Nutzungszaehlung. */
function wahlArt(wert: string): string {
  if (wert === EIGENE) return 'eigene'
  if (wert === ERKLAEREN) return 'erklaeren'
  if (wert === INTERVIEW) return 'interview'
  if (wert === KLAEREN) return 'klaeren'
  if (wert.startsWith(BEFEHL)) return 'befehl'
  if (wert === SPAETER) return 'spaeter'
  if (wert === ANS_ENDE) return 'ans-ende'
  if (wert.startsWith(RUHE)) return `ruhe-${wert.slice(RUHE.length)}`
  if (wert === ERLEDIGT) return 'erledigt'
  if (wert === VERWERFEN) return 'verwerfen'
  if (wert === AKTUELL) return 'aktuell'
  return 'option'
}

export async function waehlen($: EngineInterface, punkt: Punkt, wert: string, mitTextfeld: boolean) {
  if (wert !== KEINE) void nutzung($, 'wahl', wahlArt(wert)).catch(() => undefined)
  if (wert === EIGENE) {
    if (mitTextfeld) {
      await update($, eigeneA, () => punkt.id)
      return
    }
    // Kein Textfeld (Handy): in der Eingabe vorbereiten; beim Abschicken schliesst sich der Punkt.
    return inEingabe($, punkt, { status: 'erledigt', label: 'eigene Antwort', text: '' })
  }
  if (wert === ERKLAEREN || wert === INTERVIEW || wert === KLAEREN) {
    // Nur vorbereitet, der Punkt bleibt offen: der Nutzer sieht die Bitte und schickt sie selbst ab.
    await eintragen($, bitteZu(wert === ERKLAEREN ? 'erklaeren' : wert === INTERVIEW ? 'interview' : 'klaeren', punkt))
    return
  }
  if (wert.startsWith(BEFEHL)) {
    // Nur vorbereitet: der Nutzer sieht die Bitte und schickt sie selbst ab; Claude fuehrt aus. Der Punkt bleibt offen.
    const befehl = befehle(punkt.anleitung)[Number(wert.slice(BEFEHL.length))]
    if (befehl !== undefined) await eintragen($, ausfuehrBitte(punkt.titel, befehl))
    return
  }
  if (wert === SPAETER) {
    // Erst fragen, wie lange: darunter stehen die Zeiten.
    await update($, spaeterA, () => punkt.id)
    return
  }
  if (wert === ANS_ENDE) {
    await update($, spaeterA, () => '')
    await aendere($, liste => liste.map(p => (p.id === punkt.id ? { ...p, zurueckgestellt: p.zurueckgestellt + 1 } : p)))
    return weiter($)
  }
  if (wert.startsWith(RUHE)) {
    await update($, spaeterA, () => '')
    const r = ruhe(wert.slice(RUHE.length) as Ruhezeit, await sicht($))
    await aendere($, liste => liste.map(p => (p.id === punkt.id ? { ...p, ruht: r } : p)))
    return weiter($)
  }
  if (wert === AKTUELL) {
    // Wieder aktuell: auch Zurückstellen und Ruhe aufheben, sonst bliebe ein zurückgelegter Punkt liegen.
    await aendere($, liste => liste.map(p => {
      if (p.id !== punkt.id) return p
      const { ruht: _r, ...rest } = p
      return { ...rest, ohneBezug: 0, zurueckgestellt: 0 }
    }))
    return
  }
  if (wert === ERLEDIGT || wert === VERWERFEN) {
    await (wert === ERLEDIGT
      ? setzeStatus($, punkt.id, 'erledigt', 'als erledigt markiert')
      : setzeStatus($, punkt.id, 'verworfen', 'nicht relevant'))
    return weiter($)
  }

  const option = punkt.optionen[Number(wert)]
  if (option === undefined) return
  if (option.antwort === '') {
    // Nichts fuer Claude: gleich schliessen.
    await setzeStatus($, punkt.id, 'erledigt', option.label)
    return weiter($)
  }
  const w: Wahl = { status: 'erledigt', label: option.label, text: option.antwort }
  // Braucht noch eigenen Text: in die Eingabe, ergaenzen und selbst abschicken.
  if (brauchtErgaenzung(option.antwort)) return inEingabe($, punkt, w)
  await antworten($, punkt, w)
}

export function auswahl(punkt: Punkt) {
  return [
    ...punkt.optionen.map((o, i) => ({ value: String(i), label: `${String.fromCharCode(97 + i)}) ${o.label}` })),
    { value: EIGENE, label: 'Eigene Antwort …' },
    ...befehle(punkt.anleitung).map((b, i) => ({ value: `${BEFEHL}${i}`, label: befehlLabel(b) })),
    { value: ERKLAEREN, label: 'Erklären' },
    { value: INTERVIEW, label: 'Planungsinterview' },
    { value: KLAEREN, label: 'Selbst klären' },
    ...(istVeraltet(punkt) ? [{ value: AKTUELL, label: 'Noch aktuell' }] : []),
    { value: SPAETER, label: 'Später' },
    { value: ERLEDIGT, label: 'Schon erledigt' },
    { value: VERWERFEN, label: 'Nicht relevant' },
  ]
}
