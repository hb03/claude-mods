// Haiku-Aufrufe: Nachfassen, stuendlicher Abgleich, Ueberblick
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Punkt } from '../types'
import {
  ABGLEICH_AUFTRAG, ABGLEICH_TAKT_MS, NACHFASSEN_AUFTRAG, abgleichAnfrage, abgleichAnwenden, abgleichFaellig, abgleichKandidaten, anfrage,
  kostenZeile, lies, liesAbgleich, offene, ueberblickAnfrage, ueberblickAus, veraltetSchliessen, zuletztGeschlossen, zusammenfuehren,
} from './logik'
import type { Nachricht } from './logik'
import { z } from './zustand'
import { ablageOrt, aendere, entscheidungenSeit, kostenSchreiben, mitSperre, nachladen, nummernAb, speichern, zeigeStatus } from './dateien'

// Die Zustandsreferenzen stehen in jeder Datei, die sie liest oder schreibt: der Lader der Engine
// nimmt an read/update nur Referenzen aus derselben Datei (kein Import).
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const prueftA = atom({ plugin: 'offene-punkte', key: 'prueft' } as const, false)
const ueberblickA = atom({ plugin: 'offene-punkte', key: 'ueberblick' } as const, '')

/** Darf der Mod gerade Haiku rufen? Nicht ohne Menschen davor und nicht, wenn das 5-Stunden-Fenster fast voll ist. */
async function haikuErlaubt($: EngineInterface): Promise<boolean> {
  if (!z.interaktiv) return false
  try {
    const u = await $.session.usage()
    const fenster = (u?.rateLimits ?? []).find(r => r.kind === 'five_hour')
    return fenster === undefined || typeof fenster.percentUsed !== 'number' || fenster.percentUsed < z.budgetGrenze
  } catch {
    // Kein Verbrauchsstand (Test, alter Host): dann gilt kein Limit.
    return true
  }
}

type ModellAntwort = Awaited<ReturnType<EngineInterface['model']['complete']>> | { isAnswered: false; reason: 'budget' }

/** Ein Haiku-Aufruf mit Buchfuehrung: was er gekostet hat, kommt nach kosten.jsonl im Projektordner. */
async function haiku($: EngineInterface, art: string, request: Parameters<EngineInterface['model']['complete']>[0]): Promise<ModellAntwort> {
  if (!(await haikuErlaubt($))) return { isAnswered: false, reason: 'budget' }
  const r = await $.model.complete(request)
  if (r.isAnswered && r.usage !== undefined) await kostenSchreiben($, kostenZeile(art, r.usage, z.sitzung, await $.clock.now()))
  return r
}

/**
 * Zum Start und dann jede Stunde (Server-Sitzungen laufen tagelang): offene Punkte, die seit sechs
 * Stunden niemand angefasst hat, gleicht ein kleines Modell mit den Commits seither, dem Ueberblick
 * und den Entscheidungen seither ab. Was belegt erledigt oder ueberholt ist, schliesst sich (mit
 * Grund, per /offen wieder zu oeffnen); der Rest gilt fuer sechs Stunden als geprueft. Das ersetzt
 * claude-webs „automatische Klaerung“, die dafuer Turns des Hauptmodells brauchte.
 */
export async function abgleich($: EngineInterface, anlass: 'start' | 'takt') {
  if (z.abgleichLaeuft || z.turnLaeuft) return
  z.abgleichLaeuft = true
  try {
    await nachladen($)
    const jetzt = await $.clock.now()
    // Was schon lange keine Rolle mehr spielt (auch aus aelteren Fassungen), schliesst sich ohne Frage.
    const veraltet = await aendere($, l => veraltetSchliessen(l, jetzt))
    if (veraltet.length > 0) $.ui.toast(`🤖 ${veraltet.length === 1 ? '1 veralteter Punkt' : `${veraltet.length} veraltete Punkte`} geschlossen · /offen zum Wiederöffnen`, { timeoutMs: 6000 })
    const kandidaten = abgleichKandidaten(await read($, punkteA), jetzt)
    if (kandidaten.length === 0) return
    // Den Abgleich braucht das Projekt einmal je Takt, nicht einmal je Sitzung: wer ihn macht, traegt sich ein.
    if (!(await abgleichUebernehmen($, jetzt))) {
      $.ui.log(`offene-punkte: Abgleich (${anlass}) übersprungen - eine andere Sitzung hat ihn eben gemacht`)
      return
    }
    const seit = Math.floor(Math.min(...kandidaten.map(p => p.erstellt)) / 1000)
    const wurzel = (await $.session.root()).replace(/[\\/]+$/, '')
    const log = await $.process.run(['git', '-C', wurzel, 'log', `--since=@${seit}`, '-n', '80', '--date=format:%d.%m. %H:%M', '--format=%h %ad %s'])
      .catch(() => null)
    const commits = log !== null && log.exitCode === 0 ? log.stdout : ''
    const r = await haiku($, 'abgleich', {
      model: z.modell,
      system: [{ text: ABGLEICH_AUFTRAG, cache: true }],
      prompt: abgleichAnfrage(kandidaten, { commits, ueberblick: await read($, ueberblickA), entschieden: await entscheidungenSeit($, seit * 1000) }),
      maxTokens: 1500,
      timeoutMs: 45_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`offene-punkte: kein Abgleich (${r.reason})`)
      return
    }
    const ergebnisse = liesAbgleich(r.text)
    if (ergebnisse === null) {
      $.ui.log('offene-punkte: Antwort des Abgleichs war kein lesbares JSON')
      return
    }
    const nrn = kandidaten.map(p => p.nr ?? -1)
    const zu = await aendere($, l => abgleichAnwenden(l, nrn, ergebnisse, jetzt))
    $.ui.log(`offene-punkte: Abgleich (${anlass}): ${kandidaten.length} geprüft, ${zu.length} geschlossen`)
    if (zu.length > 0) $.ui.toast(zu.map(p => `🤖 „${p.titel}“ abgeglichen`).join(' · ') + ' · /offen zum Wiederöffnen', { timeoutMs: 8000 })
  } finally {
    z.abgleichLaeuft = false
  }
}

/** abgleich.txt unter der Sperre: faellig, dann gehoert der Abgleich dieser Sitzung. */
async function abgleichUebernehmen($: EngineInterface, jetzt: number): Promise<boolean> {
  const o = await ablageOrt($)
  if (o === null) return true
  const datei = `${o.ordner}/abgleich.txt`
  return mitSperre($, async () => {
    if (!abgleichFaellig(await $.fs.read(datei).then(t => String(t)).catch(() => ''), jetzt)) return false
    await $.fs.write(datei, `${jetzt} ${z.sitzung}\n`).catch(() => undefined)
    return true
  })
}

/** Der naechste Takt des Abgleichs - als Kette von after statt every, damit ein Neuladen ihn sauber beendet. */
export function abgleichPlanen($: EngineInterface) {
  z.abgleichTakt?.cancel()
  z.abgleichTakt = $.clock.after(ABGLEICH_TAKT_MS, () => {
    void abgleich($, 'takt')
      .catch(fehler => $.ui.log(`offene-punkte: Abgleich fehlgeschlagen (${String(fehler)})`))
      .finally(() => abgleichPlanen($))
  })
}

/**
 * Schreibt den Ueberblick neu - aus dem eigenen Verlauf ($.session.messages(): nur die Texte, keine
 * Tool-Ergebnisse) per Haiku. Ein Fork des Hauptmodells laese dafuer den ganzen Kontext zum Preis des
 * Hauptmodells; so kostet es ein paar tausend Haiku-Tokens. Laeuft nach UEBERBLICK_NACH fertigen
 * Menschen-Turns, nach jeder Compaction, bei /zusammenfassung und auf /offen ueberblick.
 */
export async function ueberblickErneuern($: EngineInterface, anlass: string): Promise<string> {
  if (z.ueberblickLaeuft) return ''
  z.ueberblickLaeuft = true
  try {
    const nachrichten = await Promise.resolve().then(() => $.session.messages()).catch(() => null)
    if (!Array.isArray(nachrichten)) return ''
    const liste = nachrichten as readonly Nachricht[]
    // Auf Wunsch (/offen ueberblick) und nach einer Compaction (der Verlauf ist ein anderer) ganz neu,
    // sonst fortschreiben: alter Ueberblick plus die Nachrichten seither - rund ein Drittel der Tokens.
    const ganz = anlass === 'befehl' || anlass === 'compaction'
    const a = ueberblickAnfrage(liste, ganz ? '' : await read($, ueberblickA), z.ueberblickBis, z.fortgeschrieben)
    if (a === null) return ''
    const r = await haiku($, 'ueberblick', {
      model: z.modell,
      system: a.system,
      prompt: a.prompt,
      // Die Ausgabe ist eine Liste von 8 Zeilen; mehr Denken bringt hier nichts (Ausgabe kostet fuenffach).
      maxTokens: 500,
      effort: 'low',
      timeoutMs: 45_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`offene-punkte: kein Überblick (${r.reason})`)
      return ''
    }
    const u = ueberblickAus(r.text)
    if (u === '') return ''
    await update($, ueberblickA, () => u)
    z.ueberblickBis = liste.length
    z.fortgeschrieben = a.modus === 'fort' ? z.fortgeschrieben + 1 : 0
    await speichern($)
    z.fertigeTurns = 0
    $.ui.log(`offene-punkte: Überblick ${a.modus === 'fort' ? 'fortgeschrieben' : 'neu'} (${anlass})`)
    return u
  } finally {
    z.ueberblickLaeuft = false
  }
}

/** Eine Antwort von Haiku auswerten lassen und das Ergebnis in die Liste nehmen. */
export async function auswerten($: EngineInterface, antworten: string[], eingabe: string) {
  if (z.laeuft) return
  z.laeuft = true
  await update($, prueftA, () => true)
  await zeigeStatus($)
  try {
    const alle = await read($, punkteA)
    const vorher = offene(alle)
    // Kurzer, strenger Auftrag ohne Ueberblick: nur, was ohne Eintrag verloren ginge.
    const r = await haiku($, 'nachfassen', {
      model: z.modell,
      system: NACHFASSEN_AUFTRAG,
      prompt: anfrage(antworten, eingabe, vorher, '', zuletztGeschlossen(alle)),
      maxTokens: 3000,
      timeoutMs: 45_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`offene-punkte: keine Auswertung (${r.reason})`)
      return
    }
    const a = lies(r.text)
    if (a === null) {
      $.ui.log('offene-punkte: Antwort des Modells war kein lesbares JSON')
      return
    }
    const jetzt = await $.clock.now()
    let zaehler = 0
    // Eindeutig, auch wenn zwei Auswertungen in dieselbe Millisekunde fallen.
    const vergeben = new Set((await read($, punkteA)).map(p => p.id))
    const neueId = () => {
      let id: string
      do id = `p${jetzt.toString(36)}${(zaehler++).toString(36)}`
      while (vergeben.has(id))
      vergeben.add(id)
      return id
    }
    const ab = await nummernAb($)
    // altern() zaehlt je Antwort; das Nachfassen soll nicht ein zweites Mal zaehlen.
    const mitBezug = { ...a, erwaehnt: [...a.erwaehnt, ...vorher.map(p => p.id)] }
    const geschlossen = await aendere($, alt => zusammenfuehren(alt, mitBezug, jetzt, neueId, ab, z.sitzung))

    const bekannt = new Set(vorher.map(p => p.id))
    const neu = offene(await read($, punkteA)).filter(p => !bekannt.has(p.id)).length
    const meldungen = [
      neu === 1 ? '1 neuer offener Punkt' : neu > 1 ? `${neu} neue offene Punkte` : '',
      ...geschlossen.filter(p => p.auto !== undefined).map(p => `🤖 „${p.titel}“ geschlossen (${p.auto?.grund})`),
    ].filter(t => t !== '')
    if (meldungen.length > 0) {
      const zusatz = geschlossen.length > 0 ? ' · /offen zum Wiederöffnen' : ' – Frage über der Eingabe'
      $.ui.toast(meldungen.join(' · ') + zusatz, { timeoutMs: 6000 })
    }
  } finally {
    z.laeuft = false
    await update($, prueftA, () => false)
    await zeigeStatus($)
  }
}
