import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Ausstehend, Option, Punkt, Warnung } from '../types'
import {
  AUFTRAG, UEBERBLICK_NEU, WARTEZEIT, ZUSAMMENFASSUNG, ueberblickAus, abgleichen, abschliessen, ablageLesen, alteVerlaeufe, antwortIn, ausfuehrBitte, ablageText, anfrage, kurzNummern,
  auswerten as auswertenNoetig, ausnahmeErgaenzen, ausstehende, befehlLabel, befehle, brauchtErgaenzung, datum, fragbar, fremd, istVeraltet,
  hoechsteImVerlauf, hoechsteNr, kommando, lies, mitCompact, monatsKopf, nichtsFragbar, notiz, nummerieren, offene, ordnerName, ruhe, sammelText, statuszeile, stempeln, tagAnhaengen,
  ruht, ruheVermerk, uebernehmen, verlaufKopf, verlaufsEintraege, vermerk, zuZeigen, zuruecknehmen, zusammenfuehren,
  HINWEIS_CLAUDE, HINWEIS_WERKZEUG, autoErledigt, schlussMarken, perMarkeSchliessen, markenHinweis, markenOhneTreffer,
  WERKZEUG, WERKZEUG_BESCHREIBUNG, WERKZEUG_SCHEMA, altern, nachfassen, werkzeugLesen,
  listeFuerClaude, veraltetSchliessen, zuletztGeschlossen, zuletztFertig,
  ABGLEICH_AUFTRAG, abgleichAnfrage, abgleichAnwenden, abgleichKandidaten, entscheidungenAus, liesAbgleich,
  ABGLEICH_TAKT_MS, BUDGET_GRENZE, ablageDaten, bitteZu, eingetippteAntworten, istMaschinenEingabe, klaerungsBitte, kostenZeile,
  EINGANG_RUHE_MS, EINGANG_TAKT_MS, EINGANG_WACH_MS, NACHFASSEN_AUFTRAG, UEBERBLICK_NACH, eingangZeilen, verlaufsText,
  HINWEIS_BLOCK, aenderungenZuIds, abgelehnteAenderungen, beiClaudeFertig, blockLesen, insInterview, interviewNummer,
  gedankeBitte, gedankeKurz, gedankeZustand, gedankenLesen, gedankenMarken, gedankenPruefBitte, gedankenText, naechsteGedankenNr, zeitText,
  installierteVersion, laufendeVersion, laufendeVersionSetzen, manifestVersion, neuerAlsLaufend,
} from './logik'
import type { Auswertung, Gedanke, GedankenDatei, Marke, Nachricht, NrAenderung, Ruhezeit, Sicht, Teil } from './logik'

// Offene Punkte der Sitzung: nach jeder Antwort liest ein kleines Modell
// (Haiku), was noch eine Entscheidung, Freigabe oder Zuarbeit des Nutzers
// braucht, und stellt es als Frage mit Antwortmoeglichkeiten ueber die
// Eingabe - immer auch mit einer eigenen Antwort. Aufgaben bringen ihre
// Anleitung mit (Befehle, Pfade), dazu fuehrt Haiku einen kurzen Ueberblick.
// Die Liste liegt je Projekt in offene-punkte/offen.md und geht so in die
// naechste Sitzung; was entschieden wurde, landet mit Gruenden in
// offene-punkte/antworten-JJJJ-MM-TT.md. /offen zeigt alles,
// /zusammenfassung laesst das Hauptmodell die ganze Sitzung zusammenfassen.

const PANE = 'offene-punkte'
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const hoechsteA = atom({ plugin: 'offene-punkte', key: 'hoechsteNr' } as const, 0)
const prueftA = atom({ plugin: 'offene-punkte', key: 'prueft' } as const, false)
const ausgeblendetA = atom({ plugin: 'offene-punkte', key: 'ausgeblendet' } as const, false)
const ueberblickA = atom({ plugin: 'offene-punkte', key: 'ueberblick' } as const, '')
const eigeneA = atom({ plugin: 'offene-punkte', key: 'eigene' } as const, '')
const spaeterA = atom({ plugin: 'offene-punkte', key: 'spaeter' } as const, '')
const warnungenAusA = atom({ plugin: 'offene-punkte', key: 'warnungenAus' } as const, [])
const abschickenA = atom({ plugin: 'offene-punkte', key: 'abschicken' } as const, { sekunden: 0, inEingabe: false })
const gedankenStandA = atom({ plugin: 'offene-punkte', key: 'gedankenStand' } as const, 0)
// Gehoert kontext-anzeige (ab 0.4.0) und wird hier nur gelesen; ohne den Mod bleibt es leer.
const warnungenA = atom({ plugin: 'kontext-anzeige', key: 'warnungen' } as const, [] as Warnung[])

// Feste Wahlmoeglichkeiten unter jeder Frage.
// Steht vorgewaehlt in der Auswahl, damit dort nicht "none" erscheint; waehlt nichts.
const KEINE = '__keine'
const EIGENE = '__eigene'
const SPAETER = '__spaeter'
const ANS_ENDE = '__ende'
const RUHE = '__ruhe:'
const ERLEDIGT = '__erledigt'
const VERWERFEN = '__verwerfen'
const AKTUELL = '__aktuell'
const BEFEHL = '__befehl:'
// Vorbereitete Bitten (aus claude-web uebernommen): der Punkt bleibt offen, der Nutzer schickt selbst ab.
const ERKLAEREN = '__erklaeren'
const INTERVIEW = '__interview'
const KLAEREN = '__klaeren'


// Einstellungen, von register gesetzt.
let modell = 'haiku'
let mindestLaenge = 400
let fragenAnzeigen = true
// "claude": Claude legt Punkte mit dem Werkzeug selbst an, Haiku fasst nur nach, wenn er es vergessen
// hat; "haiku": Haiku liest jede Antwort (wie bis 0.13).
let auswertung: 'claude' | 'haiku' = 'claude'
// "block": Claude schreibt Punkte als Block ans Ende der Antwort (kein Werkzeug im Katalog, keine
// Extra-Runde); "werkzeug": wie 0.14 ueber das Werkzeug punkte. Der Block wird in beiden Faellen gelesen.
let eintrag: 'block' | 'werkzeug' = 'block'
// Hat Claude das Werkzeug in der laufenden Antwort benutzt? Dann braucht es kein Nachfassen.
let werkzeugBenutzt = false
const WERKZEUG_VOLL = `mcp__offene-punkte__${WERKZEUG}`
// Die letzte Nachricht des Nutzers - sagt Haiku, was er gerade schon beantwortet hat.
let letzteEingabe = ''
// Laeuft schon eine Auswertung, sammeln sich die naechsten Antworten hier (nie zwei Auswertungen gleichzeitig).
let warteschlange: string[] = []
let wartendeEingabe = ''
let laeuft = false
// Gewaehlte Antworten stehen als "ausstehend" am Punkt (im State, uebersteht ein Neuladen) und
// gehen gesammelt an Claude: wenn keine aktuelle Frage mehr offen ist oder WARTEZEIT nach der
// letzten Wahl. Erst dann schliesst sich der Punkt. Spaeter, Schon erledigt und Nicht relevant
// brauchen keine Nachricht und wirken sofort.
let zeitgeber: Timer | null = null
// Alle Fragen beantwortet: noch ABSCHICKEN_NACH Sekunden Zeit (Enter schickt sofort), dann geht es los.
const ABSCHICKEN_NACH = 5
let ticker: Timer | null = null
// Was wir dafuer in die Eingabe gelegt haben; leer: die Eingabe war belegt, es bleibt bei der Sammlung.
let vorschlag = ''
// Gerade abgeschickt, Antwort der Engine steht noch aus: nicht ein zweites Mal senden.
const unterwegs = new Set<string>()
// Wo die Dateien liegen; einmal je Sitzung ermittelt.
let ort: Promise<{ ordner: string } | null> | null = null
// Die eigene Sitzung: Punkte anderer Sitzungen im selben Projekt werden nicht gefragt.
let sitzung = ''
// Welche Liste Claude zuletzt als Kontext bekam; leer nach /clear und nach einer Compaction.
let claudeKennt = ''
// Sitzt ein Mensch davor? Unter claude -p oder dem SDK bleibt der Mod still: nur Datei und Marken.
let interaktiv = true
// Kam die letzte Eingabe von einem Menschen (Tastatur, Handy) oder von einer Maschine (Peer-Nachricht,
// Zeitplan, claude-webs Klaerung per tmux)? Nach Maschinen-Turns wird nicht ausgewertet und nichts altert.
let eingabeArt: 'mensch' | 'maschine' = 'mensch'
// Laeuft gerade ein Turn? Der Abgleich wartet dann auf den naechsten Takt.
let turnLaeuft = false
/** Beginn und Text des laufenden Haupt-Turns: wann eine Antwort „bei Claude“ fertig ist. */
let turnStart = 0
/** Wann die letzte Nachricht kam (auch von Maschinen): was seitdem geschlossen wurde, hat eine Marke nicht verfehlt. */
let eingangZeit = 0
let turnText = ''
/** Was Claude mit der nächsten Nachricht erfahren soll (z. B. eine Änderung, die nicht ankam). */
let hinweiseFuerClaude: string[] = []
let abgleichLaeuft = false
let abgleichTakt: Timer | null = null
// Ab so viel Prozent des 5-Stunden-Fensters kein Haiku mehr (Option haikuBisProzent).
let budgetGrenze = BUDGET_GRENZE
// Ueberblick: laeuft gerade einer, und wie viele fertige Menschen-Turns seit dem letzten.
let ueberblickLaeuft = false
let fertigeTurns = 0
// Eingang (eingang.txt): der naechste Blick hinein - alle 15 s, solange ein Mensch arbeitet, sonst seltener.
let eingangTakt: Timer | null = null
let eingangLaeuft = false
let letzterMensch = 0
// Die installierte Fassung (installed_plugins.json), wenn sie von der laufenden abweicht - steht in offen.json.
let installiert = ''

async function sicht($: EngineInterface): Promise<Sicht> {
  return { sitzung, jetzt: await $.clock.now() }
}

async function zeigeStatus($: EngineInterface) {
  const [punkte, prueft, s] = await Promise.all([read($, punkteA), read($, prueftA), sicht($)])
  $.ui.status(statuszeile(punkte, prueft, s))
}

/** Ab hier zaehlen neue Nummern: hoechste je vergebene, mindestens die hoechste in der Liste. */
async function nummernAb($: EngineInterface): Promise<number> {
  // Auch den Stand der Datei: eine Sitzung, die sie nie geladen hat (claude -p, nach dem
  // Neuladen der Mod), fing sonst bei 0 an und vergab eine Nummer ein zweites Mal (12.10.2026).
  const o = await ablageOrt($)
  const text = o === null ? '' : await $.fs.read(`${o.ordner}/offen.md`).then(t => String(t)).catch(() => '')
  const dort = text === '' ? null : ablageLesen(text)
  if (dort !== null) await zaehlerHeben($, Math.max(dort.hoechsteNr ?? 0, hoechsteNr(dort.punkte)))
  const [h, punkte] = await Promise.all([read($, hoechsteA), read($, punkteA)])
  return Math.max(h, hoechsteNr(punkte))
}

/** Den Zaehler nachziehen (nie zurueck). */
async function zaehlerHeben($: EngineInterface, n: number) {
  await update($, hoechsteA, h => Math.max(h, n))
}

// ---------------------------------------------------------------- Dateien

/**
 * Im Git-Repo: <projekt>/offene-punkte/, lokal ausgenommen ueber .git/info/exclude
 * (die .gitignore des Projekts bleibt unberuehrt). Sonst ~/.claude/offene-punkte/<projekt>/.
 */
async function ermittleOrt($: EngineInterface): Promise<{ ordner: string } | null> {
  const wurzel = (await $.session.root()).replace(/[\\/]+$/, '')
  const git = await $.fs.stat(`${wurzel}/.git`).catch(() => undefined)
  if (git?.kind === 'dir') {
    const datei = `${wurzel}/.git/info/exclude`
    const alt = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    const neu = ausnahmeErgaenzen(alt)
    if (neu !== null) await $.fs.write(datei, neu)
    return { ordner: `${wurzel}/offene-punkte` }
  }
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (home === undefined) return null
  return { ordner: `${home.replace(/[\\/]+$/, '')}/.claude/offene-punkte/${ordnerName(wurzel)}` }
}

function ablageOrt($: EngineInterface) {
  ort ??= ermittleOrt($).catch(fehler => {
    $.ui.log(`offene-punkte: kein Ablageort (${String(fehler)})`)
    return null
  })
  return ort
}

/**
 * Schreibt eine Datei in einem Zug: erst daneben, dann an ihren Platz - wer sie gerade liest
 * (claude-web, eine zweite Sitzung), sieht nie einen halben Stand. Klappt das Verschieben nicht
 * (kein mv, Rechte), wird direkt geschrieben.
 */
async function schreiben($: EngineInterface, datei: string, text: string) {
  const tmp = `${datei}.${(sitzung || 'neu').slice(0, 8)}.tmp`
  const windows = (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT'
  const ok = await $.fs.write(tmp, text)
    .then(() => $.process.run(windows
      ? ['cmd', '/c', 'move', '/y', tmp.replace(/\//g, '\\'), datei.replace(/\//g, '\\')]
      : ['mv', '-f', tmp, datei]))
    .then(r => r.exitCode === 0)
    .catch(() => false)
  if (!ok) await $.fs.write(datei, text)
}

/**
 * Schreibt offen.md und offen.json. Vorher wird eingelesen, was dort steht: eine andere Sitzung im
 * selben Projekt kann inzwischen Punkte angelegt oder geschlossen haben (mitAbgleich: false beim Leeren).
 */
async function speichern($: EngineInterface, mitAbgleich = true) {
  const o = await ablageOrt($)
  if (o === null) return
  const datei = `${o.ordner}/offen.md`
  if (mitAbgleich) {
    const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    const dort = text === '' ? null : ablageLesen(text)
    if (dort !== null) {
      await zaehlerHeben($, dort.hoechsteNr ?? 0)
      const ab = await nummernAb($)
      await update($, punkteA, alt => abgleichen(alt, dort.punkte, ab))
    }
  }
  await zaehlerHeben($, hoechsteNr(await read($, punkteA)))
  const [punkte, ueberblick, h, jetzt] = await Promise.all([read($, punkteA), read($, ueberblickA), read($, hoechsteA), $.clock.now()])
  const daten = { punkte, ueberblick, hoechsteNr: h }
  await schreiben($, datei, ablageText(daten, jetzt))
    .catch(fehler => $.ui.log(`offene-punkte: offen.md nicht geschrieben (${String(fehler)})`))
  // Dieselben Daten als reine JSON-Datei fuer claude-web; der Block in offen.md bleibt fuer aeltere Sitzungen.
  await schreiben($, `${o.ordner}/offen.json`, `${ablageDaten(daten, jetzt, installiert)}\n`)
    .catch(fehler => $.ui.log(`offene-punkte: offen.json nicht geschrieben (${String(fehler)})`))
}

async function insVerlauf($: EngineInterface, eintraege: string[], jetzt: number) {
  const o = await ablageOrt($)
  if (o === null || eintraege.length === 0) return
  const datei = `${o.ordner}/antworten-${datum(jetzt)}.md`
  const alt = await $.fs.read(datei).then(t => String(t)).catch(() => verlaufKopf(jetzt))
  await schreiben($, datei, `${alt}\n${eintraege.join('\n')}`)
    .catch(fehler => $.ui.log(`offene-punkte: Verlauf nicht geschrieben (${String(fehler)})`))
}

/**
 * Versionsdrift: Sitzungen laufen tagelang und laden Updates erst beim Neustart. Weicht die installierte
 * Fassung von der laufenden ab, sagt es ein Toast, und offen.json traegt "installiert" fuer claude-web.
 */
async function versionPruefen($: EngineInterface) {
  // Die laufende Fassung steht in der plugin.json des geladenen Ordners (je Fassung ein eigener im Cache) -
  // so kann sie nicht hinter dem Manifest zurückbleiben.
  const root = String($.plugin.root ?? '').replace(/[\\/]+$/, '')
  if (root !== '') laufendeVersionSetzen(manifestVersion(await $.fs.read(`${root}/.claude-plugin/plugin.json`).then(t => String(t)).catch(() => '')))
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined))
  if (home === undefined) return
  const text = await $.fs.read(`${home.replace(/[\\/]+$/, '')}/.claude/plugins/installed_plugins.json`).then(t => String(t)).catch(() => '')
  installiert = installierteVersion(text)
  if (neuerAlsLaufend(installiert)) {
    $.ui.toast(`offene-punkte ${installiert} ist installiert, diese Sitzung läuft noch ${laufendeVersion()} – ein Neustart lädt die neue Fassung`, { timeoutMs: 10_000 })
    $.ui.log(`offene-punkte: läuft ${laufendeVersion()}, installiert ${installiert}`)
  }
}

/** Darf der Mod gerade Haiku rufen? Nicht ohne Menschen davor und nicht, wenn das 5-Stunden-Fenster fast voll ist. */
async function haikuErlaubt($: EngineInterface): Promise<boolean> {
  if (!interaktiv) return false
  try {
    const u = await $.session.usage()
    const fenster = (u?.rateLimits ?? []).find(r => r.kind === 'five_hour')
    return fenster === undefined || typeof fenster.percentUsed !== 'number' || fenster.percentUsed < budgetGrenze
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
  if (r.isAnswered && r.usage !== undefined) {
    const o = await ablageOrt($)
    if (o !== null) {
      const datei = `${o.ordner}/kosten.jsonl`
      const alt = await $.fs.read(datei).then(t => String(t)).catch(() => '')
      // Nicht endlos wachsen lassen: ab 200 kB bleibt der juengere Teil.
      const basis = alt.length > 200_000 ? alt.slice(alt.indexOf('\n', alt.length - 150_000) + 1) : alt
      await $.fs.write(datei, `${basis}${kostenZeile(art, r.usage, sitzung, await $.clock.now())}\n`).catch(() => undefined)
    }
  }
  return r
}

/** Liste aendern; was dabei geschlossen oder wieder geoeffnet wird, geht in den Verlauf. Alles landet in der Datei. */
async function aendere($: EngineInterface, fn: (liste: Punkt[]) => Punkt[]): Promise<Punkt[]> {
  const vorher = await read($, punkteA)
  const jetzt = await $.clock.now()
  await update($, punkteA, alt => stempeln(alt, fn(alt), jetzt))
  const nachher = await read($, punkteA)
  const alt = new Map(vorher.map(p => [p.id, p]))
  await insVerlauf($, verlaufsEintraege(vorher, nachher, jetzt), jetzt)
  await speichern($)
  await zeigeStatus($)
  // Was gerade geschlossen wurde, damit der Aufrufer davon erzaehlen kann.
  return nachher.filter(p => p.status !== 'offen' && alt.get(p.id)?.status === 'offen')
}

/** Zu Beginn einer Sitzung (oder nach /clear) die Punkte aus der Datei uebernehmen. */
async function laden($: EngineInterface) {
  const [punkte, ueberblick] = await Promise.all([read($, punkteA), read($, ueberblickA)])
  if (punkte.length > 0 || ueberblick !== '') return
  const o = await ablageOrt($)
  if (o === null) return
  const text = await $.fs.read(`${o.ordner}/offen.md`).then(t => String(t)).catch(() => '')
  const a = text === '' ? null : ablageLesen(text)
  if (a === null) return
  await zaehlerHeben($, a.hoechsteNr ?? 0)
  // Was die letzte Sitzung offen liess, fuehrt jetzt diese.
  await update($, punkteA, () => uebernehmen(a.punkte, sitzung))
  await update($, ueberblickA, () => a.ueberblick)
  await zeigeStatus($)
  const n = fragbar(await read($, punkteA), await sicht($)).length
  if (n > 0) $.ui.toast(n === 1 ? '1 offener Punkt aus der letzten Sitzung übernommen · /offen' : `${n} offene Punkte aus der letzten Sitzung übernommen · /offen`)
}

/**
 * Zum Start und dann jede Stunde (Server-Sitzungen laufen tagelang): offene Punkte, die seit sechs
 * Stunden niemand angefasst hat, gleicht ein kleines Modell mit den Commits seither, dem Ueberblick
 * und den Entscheidungen seither ab. Was belegt erledigt oder ueberholt ist, schliesst sich (mit
 * Grund, per /offen wieder zu oeffnen); der Rest gilt fuer sechs Stunden als geprueft. Das ersetzt
 * claude-webs „automatische Klaerung“, die dafuer Turns des Hauptmodells brauchte.
 */
async function abgleich($: EngineInterface, anlass: 'start' | 'takt') {
  if (abgleichLaeuft || turnLaeuft) return
  abgleichLaeuft = true
  try {
    const jetzt = await $.clock.now()
    // Was schon lange keine Rolle mehr spielt (auch aus aelteren Fassungen), schliesst sich ohne Frage.
    const veraltet = await aendere($, l => veraltetSchliessen(l, jetzt))
    if (veraltet.length > 0) $.ui.toast(`🤖 ${veraltet.length === 1 ? '1 veralteter Punkt' : `${veraltet.length} veraltete Punkte`} geschlossen · /offen zum Wiederöffnen`, { timeoutMs: 6000 })
    const kandidaten = abgleichKandidaten(await read($, punkteA), jetzt)
    if (kandidaten.length === 0) return
    const seit = Math.floor(Math.min(...kandidaten.map(p => p.erstellt)) / 1000)
    const wurzel = (await $.session.root()).replace(/[\\/]+$/, '')
    const log = await $.process.run(['git', '-C', wurzel, 'log', `--since=@${seit}`, '-n', '80', '--date=format:%d.%m. %H:%M', '--format=%h %ad %s'])
      .catch(() => null)
    const commits = log !== null && log.exitCode === 0 ? log.stdout : ''
    const r = await haiku($, 'abgleich', {
      model: modell,
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
    abgleichLaeuft = false
  }
}

/** Der naechste Takt des Abgleichs - als Kette von after statt every, damit ein Neuladen ihn sauber beendet. */
function abgleichPlanen($: EngineInterface) {
  abgleichTakt?.cancel()
  abgleichTakt = $.clock.after(ABGLEICH_TAKT_MS, () => {
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
async function ueberblickErneuern($: EngineInterface, anlass: string): Promise<string> {
  if (ueberblickLaeuft) return ''
  ueberblickLaeuft = true
  try {
    const nachrichten = await Promise.resolve().then(() => $.session.messages()).catch(() => null)
    if (!Array.isArray(nachrichten)) return ''
    const verlauf = verlaufsText(nachrichten as readonly Nachricht[])
    if (verlauf === '') return ''
    const r = await haiku($, 'ueberblick', {
      model: modell,
      system: [{ text: UEBERBLICK_NEU, cache: true }],
      prompt: `VERLAUF (älteste Nachricht zuerst):\n\n${verlauf}`,
      maxTokens: 400,
      timeoutMs: 45_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`offene-punkte: kein Überblick (${r.reason})`)
      return ''
    }
    const u = ueberblickAus(r.text)
    if (u === '') return ''
    await update($, ueberblickA, () => u)
    await speichern($)
    fertigeTurns = 0
    $.ui.log(`offene-punkte: Überblick neu (${anlass})`)
    return u
  } finally {
    ueberblickLaeuft = false
  }
}

/**
 * eingang.txt im Projektordner: je Zeile ein /offen-Befehl ohne das „/offen“, von claude-web oder
 * einem Skript angehaengt. Die Sitzung fuehrt die Zeilen aus und nimmt sie aus der Datei; was
 * waehrenddessen dazukam, bleibt stehen. So antwortet claude-web ohne tmux und ohne Modellrunde.
 */
async function eingangLesen($: EngineInterface) {
  if (eingangLaeuft) return
  eingangLaeuft = true
  try {
    const o = await ablageOrt($)
    if (o === null) return
    const datei = `${o.ordner}/eingang.txt`
    const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    const zeilen = eingangZeilen(text)
    if (zeilen.length === 0) return
    const ergebnisse: string[] = []
    for (const z of zeilen) {
      const r = await offenKommando($, z).catch(fehler => `Fehler: ${String(fehler)}`)
      ergebnisse.push(`${z} → ${r ?? 'Liste'}`)
    }
    const danach = await $.fs.read(datei).then(t => String(t)).catch(() => '')
    await $.fs.write(datei, danach.startsWith(text) ? danach.slice(text.length) : danach)
      .catch(fehler => $.ui.log(`offene-punkte: eingang.txt nicht geleert (${String(fehler)})`))
    $.ui.log(`offene-punkte: Eingang: ${ergebnisse.join(' · ')}`)
    $.ui.toast(`Eingang: ${zeilen.length === 1 ? '1 Befehl' : `${zeilen.length} Befehle`} ausgeführt · /offen`, { timeoutMs: 5000 })
  } finally {
    eingangLaeuft = false
  }
}

function eingangPlanen($: EngineInterface, takt = EINGANG_RUHE_MS) {
  eingangTakt?.cancel()
  eingangTakt = $.clock.after(takt, () => {
    void eingangLesen($)
      .catch(fehler => $.ui.log(`offene-punkte: Eingang (${String(fehler)})`))
      .then(() => $.clock.now())
      .then(jetzt => eingangPlanen($, turnLaeuft || jetzt - letzterMensch < EINGANG_WACH_MS ? EINGANG_TAKT_MS : EINGANG_RUHE_MS))
      .catch(() => eingangPlanen($))
  })
}

/** Was seit diesem Zeitpunkt entschieden wurde, aus den Tagesverlaeufen (auch anderer Sitzungen im Projekt). */
async function entscheidungenSeit($: EngineInterface, seit: number): Promise<string> {
  const o = await ablageOrt($)
  if (o === null) return ''
  const ab = `antworten-${datum(seit)}.md`
  const namen = await $.fs.list(o.ordner).then(l => l.filter(x => x.kind === 'file').map(x => x.name)).catch((): string[] => [])
  const tage = namen.filter(n => /^antworten-\d{4}-\d{2}-\d{2}\.md$/.test(n) && n >= ab).sort().slice(-7)
  const texte = await Promise.all(tage.map(n => $.fs.read(`${o.ordner}/${n}`).then(t => String(t)).catch(() => '')))
  return entscheidungenAus(texte)
}

/**
 * Zum Start: der Zaehler kennt auch Nummern, die nur noch im Verlauf stehen (offen.md
 * geloescht oder aelter) - eine Nummer wird nie zweimal vergeben.
 */
async function zaehlerLaden($: EngineInterface) {
  const o = await ablageOrt($)
  if (o === null) return
  const namen = await $.fs.list(o.ordner).then(l => l.filter(x => x.kind === 'file').map(x => x.name)).catch((): string[] => [])
  for (const name of namen.filter(n => /^antworten-[\d-]+\.md$/.test(n))) {
    const text = await $.fs.read(`${o.ordner}/${name}`).then(t => String(t)).catch(() => '')
    await zaehlerHeben($, hoechsteImVerlauf(text))
  }
}

/** Tagesverlaeufe, die aelter als 30 Tage sind, kommen in die Monatsdatei antworten-JJJJ-MM.md. */
async function verlaufAufraeumen($: EngineInterface) {
  const o = await ablageOrt($)
  if (o === null) return
  const namen = await $.fs.list(o.ordner).then(l => l.filter(x => x.kind === 'file').map(x => x.name)).catch((): string[] => [])
  const monate = alteVerlaeufe(namen, await $.clock.now())
  if (monate.size === 0) return
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  for (const [monat, tage] of monate) {
    const ziel = `${o.ordner}/antworten-${monat}.md`
    let inhalt = await $.fs.read(ziel).then(t => String(t)).catch(() => monatsKopf(monat))
    for (const tag of tage) {
      const text = await $.fs.read(`${o.ordner}/antworten-${tag}.md`).then(t => String(t)).catch(() => null)
      if (text !== null) inhalt = tagAnhaengen(inhalt, tag, text) ?? inhalt
    }
    await $.fs.write(ziel, inhalt)
    // Erst wenn die Monatsdatei steht; ein Tag, der dort schon steht, kommt nicht doppelt hinein.
    for (const tag of tage) {
      const datei = `${o.ordner}/antworten-${tag}.md`
      await $.process.run(windows ? ['cmd', '/c', 'del', '/q', datei.replace(/\//g, '\\')] : ['rm', '-f', datei])
        .catch(fehler => $.ui.log(`offene-punkte: ${datei} nicht entfernt (${String(fehler)})`))
    }
  }
}

// ---------------------------------------------------------------- Auswertung

/** Eine Antwort von Haiku auswerten lassen und das Ergebnis in die Liste nehmen. */
async function auswerten($: EngineInterface, antworten: string[], eingabe: string) {
  if (laeuft) {
    warteschlange.push(...antworten)
    wartendeEingabe = eingabe
    return
  }
  laeuft = true
  await update($, prueftA, () => true)
  await zeigeStatus($)
  try {
    const alle = await read($, punkteA)
    const vorher = offene(alle)
    // Nachfassen (Standard): kurzer, strenger Auftrag ohne Ueberblick; „haiku“ liest jede Antwort mit dem vollen.
    const nachfassenModus = auswertung === 'claude'
    const r = await haiku($, nachfassenModus ? 'nachfassen' : 'auswertung', {
      model: modell,
      system: [{ text: nachfassenModus ? NACHFASSEN_AUFTRAG : AUFTRAG, cache: true }],
      prompt: anfrage(antworten, eingabe, vorher, nachfassenModus ? '' : await read($, ueberblickA), zuletztGeschlossen(alle)),
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
    if (a.ueberblick !== '') await update($, ueberblickA, () => a.ueberblick)
    const ab = await nummernAb($)
    // Bei "claude" altert altern() je Antwort; das Nachfassen soll nicht ein zweites Mal zaehlen.
    const mitBezug = auswertung === 'claude' ? { ...a, erwaehnt: [...a.erwaehnt, ...vorher.map(p => p.id)] } : a
    const geschlossen = await aendere($, alt => zusammenfuehren(alt, mitBezug, jetzt, neueId, ab, sitzung))

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
    laeuft = false
    await update($, prueftA, () => false)
    await zeigeStatus($)
    const weiter = warteschlange
    warteschlange = []
    if (weiter.length > 0) await auswerten($, weiter, wartendeEingabe)
  }
}

// ---------------------------------------------------------------- Wahl

async function setzeStatus($: EngineInterface, id: string, status: Punkt['status'], ergebnis: string) {
  await aendere($, liste => liste.map(p => (p.id === id ? { ...p, status, ergebnis } : p)))
}

async function wiederOeffnen($: EngineInterface, id: string) {
  // Die Nummer bleibt (sie wird nie neu vergeben); Punkte aus aelteren Fassungen bekommen eine.
  const ab = await nummernAb($)
  await aendere($, liste => nummerieren(liste.map(p => {
    if (p.id !== id) return p
    const { ergebnis: _e, ruht: _r, auto: _a, ...rest } = p
    return { ...rest, status: 'offen' as const, ohneBezug: 0, zurueckgestellt: 0, sitzung }
  }), ab))
}

/** Ruht ein Punkt, wird er gleich wieder gefragt. */
async function aufnehmen($: EngineInterface, id: string) {
  await aendere($, liste => liste.map(p => {
    if (p.id !== id) return p
    const { ruht: _r, ...rest } = p
    return rest
  }))
}

const teileVon = (punkte: readonly Punkt[]): Teil[] => punkte.map(p => {
  const text = p.ausstehend?.text ?? ''
  // Nur ein Label (Block-Punkt): die Frage kommt dazu, damit Claude den Bezug auch nach einer Compaction kennt.
  const kurz = text !== '' && p.optionen.some(o => o.antwort === text && o.label === text)
  return { titel: p.titel, text, ...(p.nr !== undefined ? { nr: p.nr } : {}), ...(kurz ? { frage: p.frage } : {}) }
})

/** Punkte anlegen, aendern und schliessen - aus dem Werkzeug (Kennung c) oder aus dem Block in der Antwort (b). */
async function punkteEintragen($: EngineInterface, neu: Auswertung['neu'], aenderungen: readonly NrAenderung[], marken: readonly Marke[], kennung: 'c' | 'b') {
  const [jetzt, ab, vorher] = await Promise.all([$.clock.now(), nummernAb($), read($, punkteA)])
  const vergeben = new Set(vorher.map(p => p.id))
  let i = 0
  const neueId = () => {
    let id: string
    do id = `${kennung}${jetzt.toString(36)}${(i++).toString(36)}`
    while (vergeben.has(id))
    vergeben.add(id)
    return id
  }
  // Erwaehnt sind hier alle: ein Eintrag laesst keinen Punkt altern.
  const alle = offene(vorher).map(p => p.id)
  const aktualisiert = aenderungenZuIds(vorher, aenderungen)
  const abgelehnt = abgelehnteAenderungen(vorher, aenderungen)
  const zu = await aendere($, l => perMarkeSchliessen(
    zusammenfuehren(l, { neu, aktualisiert, erledigt: [], erwaehnt: alle, ueberblick: '' }, jetzt, neueId, ab, sitzung), marken, jetzt, sitzung))
  const bekannt = new Set(vorher.map(p => p.id))
  const angelegt = (await read($, punkteA)).filter(p => !bekannt.has(p.id))
  if (angelegt.length > 0) $.ui.toast(angelegt.length === 1 ? '1 neuer offener Punkt – Frage über der Eingabe' : `${angelegt.length} neue offene Punkte – Frage über der Eingabe`, { timeoutMs: 5000 })
  // Aus dem Block kennt Claude die vergebenen Nummern nicht (das Werkzeug nennt sie im Ergebnis): mit der naechsten Nachricht.
  if (kennung === 'b' && angelegt.length > 0) {
    hinweiseFuerClaude.push(`offene-punkte: Dein Block hat angelegt: ${angelegt.map(p => `#${p.nr ?? '?'} „${p.titel}“`).join(', ')}. Mit diesen Nummern schließt du sie.`)
  }
  // Claude hat einen schon erledigten (oder gerade beantworteten) Punkt geaendert: er ist wieder offen.
  const warZu = new Set(vorher.filter(p => p.status !== 'offen').map(p => p.id))
  const wieder = aktualisiert.filter(a => warZu.has(a.id)).map(a => vorher.find(p => p.id === a.id)!)
  if (wieder.length > 0) $.ui.toast(wieder.map(p => `↺ #${p.nr} „${p.titel}“ wieder offen`).join(' · ') + ' – Claude hat ihn geändert', { timeoutMs: 6000 })
  // Verworfen oder unbekannt: nicht still verlieren - der Nutzer sieht es, Claude erfährt es mit der naechsten Nachricht.
  if (abgelehnt.length > 0) {
    const zeilen = abgelehnt.map(a => {
      const p = vorher.find(x => x.nr === a.nr)
      return p !== undefined
        ? `#${a.nr} „${p.titel}“ ist vom Nutzer verworfen (nicht relevant)`
        : `#${a.nr} gibt es nicht`
    })
    $.ui.toast(`Änderung nicht übernommen: ${zeilen.join(' · ')}`, { timeoutMs: 8000 })
    hinweiseFuerClaude.push(`offene-punkte: Deine Änderung kam nicht an – ${zeilen.join('; ')}. Brauchst du das noch vom Nutzer, leg einen neuen Punkt an.`)
  }
  return { angelegt, geaendert: aktualisiert.length, zu, doppelt: neu.length - angelegt.length, ohneTreffer: markenOhneTreffer(vorher, marken, sitzung, eingangZeit) }
}

// ---------------------------------------------------------------- Gedanken

/** gedanken.md im Projektordner - die Datei ist der Stand, claude-web schreibt sie auch: immer frisch lesen. */
async function gedankenDatei($: EngineInterface): Promise<{ datei: string; d: GedankenDatei } | null> {
  const o = await ablageOrt($)
  if (o === null) return null
  const datei = `${o.ordner}/gedanken.md`
  const text = await $.fs.read(datei).then(t => String(t)).catch(() => '')
  return { datei, d: gedankenLesen(text) }
}

async function gedankenSchreiben($: EngineInterface, datei: string, d: GedankenDatei) {
  await schreiben($, datei, gedankenText(d))
  await update($, gedankenStandA, n => n + 1)
}

/** Den Vermerk eines Gedankens setzen; null, wenn es ihn nicht gibt. */
async function gedankeVermerken($: EngineInterface, nr: number, vermerk: string): Promise<Gedanke | null> {
  const g = await gedankenDatei($)
  const eintrag = g?.d.gedanken.find(x => x.nr === nr)
  if (g === null || eintrag === undefined) return null
  eintrag.vermerk = vermerk
  await gedankenSchreiben($, g.datei, g.d)
  return eintrag
}

/** senden / interview / punkt / erledigt / weg zu einem Gedanken - aus /offen, dem Pane und eingang.txt. */
async function gedankeTun($: EngineInterface, nr: number, tun: 'senden' | 'interview' | 'punkt' | 'erledigt' | 'weg', text = ''): Promise<string> {
  const g = await gedankenDatei($)
  const eintrag = g?.d.gedanken.find(x => x.nr === nr)
  if (g === null || eintrag === undefined) return `Gedanke G${nr} gibt es nicht – /offen gedanken zeigt die Nummern.`
  const jetzt = await $.clock.now()
  if (tun === 'senden' || tun === 'interview') {
    const bitte = gedankeBitte(eintrag, tun)
    await gedankeVermerken($, nr, tun === 'senden' ? 'gesendet' : 'im Planungsinterview')
    $.clock.after(0, () => {
      void $.prompt.submit({ text: bitte, asUser: true }).catch(fehler => $.ui.log(`offene-punkte: Gedanke nicht gesendet (${String(fehler)})`))
    })
    return `G${nr} ${tun === 'senden' ? 'geht an Claude' : 'geht ins Planungsinterview'}.`
  }
  if (tun === 'punkt') {
    // Wie /offen neu: ein eigener Punkt ohne feste Antworten, den die Auswertung in Ruhe laesst.
    const [alle, ab] = await Promise.all([read($, punkteA), nummernAb($)])
    const ids = new Set(alle.map(p => p.id))
    let i = 0
    let id: string
    do id = `g${jetzt.toString(36)}${(i++).toString(36)}`
    while (ids.has(id))
    await aendere($, liste => nummerieren([...liste, notiz(eintrag.text, id, jetzt, sitzung)], ab))
    const neu = (await read($, punkteA)).find(p => p.id === id)
    await gedankeVermerken($, nr, `als Punkt #${neu?.nr ?? '?'}`)
    return `G${nr} ist jetzt Punkt ${neu?.nr ?? '?'}: „${neu?.titel ?? ''}“`
  }
  const tag = zeitText(jetzt).slice(0, 6)
  const vermerk = tun === 'erledigt' ? `erledigt ${tag}${text !== '' ? ` · ${text}` : ''}` : `verworfen${text !== '' ? ` · ${text}` : ''}`
  await gedankeVermerken($, nr, vermerk)
  return `G${nr}: ${vermerk}.`
}

const naechsteReihe = (liste: readonly Punkt[]) => Math.max(0, ...liste.map(p => p.ausstehend?.reihe ?? 0)) + 1

/** Was gesammelt auf das Senden wartet. */
const gesammelt = (punkte: readonly Punkt[]) => ausstehende(punkte, 'sammlung').filter(p => !unterwegs.has(p.id))

/** Eine Antwort, wie sie gewaehlt wurde: Status beim Schliessen, Label fuers Ergebnis, Text fuer Claude. */
type Wahl = { status: Ausstehend['status']; label: string; text: string }

const ergebnis = (w: Wahl, text: string) => (text !== '' ? `${w.label} – „${text}“` : w.label)

/** Das Gesammelte als eine Nachricht an Claude; die Punkte schliessen sich, sobald sie angekommen ist. */
async function senden($: EngineInterface, wo: 'sammlung' | 'eingabe' = 'sammlung') {
  zeitgeber?.cancel()
  zeitgeber = null
  await anhalten($)
  const liste = ausstehende(await read($, punkteA), wo).filter(p => !unterwegs.has(p.id))
  if (liste.length === 0) return
  const ids = new Set(liste.map(p => p.id))
  for (const id of ids) unterwegs.add(id)
  const text = sammelText(teileVon(liste))
  const gesendet = await $.clock.now()
  // Haiku soll bei der naechsten Auswertung wissen, was der Nutzer gerade beantwortet hat.
  letzteEingabe = text
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
async function weiter($: EngineInterface) {
  const punkte = await read($, punkteA)
  if (gesammelt(punkte).length === 0) return
  const rest = fragbar(punkte, await sicht($)).filter(p => !istVeraltet(p) && p.zurueckgestellt === 0)
  if (rest.length === 0) return alleBeantwortet($)
  zeitgeber?.cancel()
  zeitgeber = $.clock.after(WARTEZEIT, () => {
    void senden($).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
  })
}

/**
 * Die letzte offene Frage ist beantwortet: die Antworten kommen in die leere Eingabe (Enter
 * schickt sofort) und gehen nach ABSCHICKEN_NACH Sekunden von selbst los. Ist die Eingabe
 * belegt oder laesst sie sich nicht fuellen, bleiben sie gesammelt - ebenfalls mit Countdown.
 */
async function alleBeantwortet($: EngineInterface) {
  zeitgeber?.cancel()
  zeitgeber = null
  const mit = gesammelt(await read($, punkteA))
  if (mit.length === 0) return
  const box = await $.prompt.read().catch(() => null)
  vorschlag = ''
  if (box !== null && box.text.trim() === '') {
    const text = sammelText(teileVon(mit))
    const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => null)
    if (r !== null && r.isFilled) {
      vorschlag = text
      const ids = new Set(mit.map(p => p.id))
      await aendere($, l => l.map(p => (ids.has(p.id) && p.ausstehend !== undefined ? { ...p, ausstehend: { ...p.ausstehend, wo: 'eingabe' as const } } : p)))
    }
  }
  await zaehlen($, ABSCHICKEN_NACH)
}

async function zaehlen($: EngineInterface, n: number) {
  ticker?.cancel()
  ticker = null
  if (n <= 0) return abschicken($)
  await update($, abschickenA, () => ({ sekunden: n, inEingabe: vorschlag !== '' }))
  ticker = $.clock.after(1000, () => {
    void zaehlen($, n - 1).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
  })
}

/** Countdown aus; was in der Eingabe steht, bleibt dort und geht mit Enter. */
async function anhalten($: EngineInterface) {
  ticker?.cancel()
  ticker = null
  if ((await read($, abschickenA)).sekunden !== 0) await update($, abschickenA, () => ({ sekunden: 0, inEingabe: false }))
}

/** Countdown abgelaufen oder "Jetzt senden": abschicken, was wartet. */
async function abschicken($: EngineInterface) {
  const text = vorschlag
  vorschlag = ''
  if (text === '') return senden($)
  // Nur, wenn noch genau unser Text in der Eingabe steht - sonst hat der Nutzer uebernommen.
  const box = await $.prompt.read().catch(() => null)
  if (box === null || box.text.trimEnd() !== text.trimEnd()) return anhalten($)
  await $.prompt.fill({ text: '', mode: 'replace' })
  await senden($, 'eingabe')
}

/** Text in die Eingabe: eine leere bekommt ihn ganz, an Angefangenes kommt er in einer neuen Zeile. */
async function eintragen($: EngineInterface, text: string) {
  const box = await $.prompt.read()
  if (box.text.trim() === '') await $.prompt.fill({ text, mode: 'replace' })
  else await $.prompt.fill({ text: `${box.text.endsWith('\n') ? '' : '\n'}${text}`, mode: 'append' })
}

/**
 * Antwort in die Eingabe statt abschicken: der Nutzer ergaenzt und schickt selbst ab. Was
 * gesammelt wartet, kommt mit; der Punkt schliesst sich mit der Nachricht.
 */
async function inEingabe($: EngineInterface, punkt: Punkt, w: Wahl) {
  zeitgeber?.cancel()
  zeitgeber = null
  vorschlag = ''
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
async function antworten($: EngineInterface, punkt: Punkt, w: Wahl) {
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
async function eigeneAntwort($: EngineInterface, punkt: Punkt, text: string) {
  await update($, eigeneA, () => '')
  const t = text.trim()
  if (t === '') return
  await antworten($, punkt, { status: 'erledigt', label: 'eigene Antwort', text: t })
}

/** Eine Wahl in der Frage eines Punkts ausfuehren. */
async function waehlen($: EngineInterface, punkt: Punkt, wert: string, mitTextfeld: boolean) {
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

function auswahl(punkt: Punkt) {
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

type Els = ReturnType<EngineInterface['ui']['resolve']>

/**
 * Die Wahl zu einem Punkt: eine Auswahlliste, wo die Oberflaeche eine hat,
 * sonst (Handy) ein Knopf je Antwort - dort ohnehin das Bessere zum Antippen.
 * Ist "Eigene Antwort" gewaehlt, steht darunter ein Textfeld.
 */
const ZEITEN: { wert: string; label: string }[] = [
  { wert: ANS_ENDE, label: 'Ans Ende' },
  { wert: `${RUHE}sitzung`, label: 'Nächste Sitzung' },
  { wert: `${RUHE}morgen`, label: 'Morgen' },
  { wert: `${RUHE}drei`, label: 'In 3 Tagen' },
  { wert: `${RUHE}woche`, label: 'Nächste Woche' },
]

function wahl($: EngineInterface, els: Els, surface: string, key: string, punkt: Punkt, eigene: string, spaeter: string) {
  const optionen = auswahl(punkt)
  const mitTextfeld = surface !== 'mobile' && 'Input' in els
  const { Box, Button, Text } = els
  if (spaeter === punkt.id) {
    return (
      <Box key={`${key}-spaeter`} flexDirection="row" flexWrap="wrap">
        <Text>Später: </Text>
        {ZEITEN.map(z => (
          <Button key={`${key}-${z.wert}`} label={z.label} onPress={() => void waehlen($, punkt, z.wert, false)} />
        ))}
        <Button key={`${key}-zurueck`} label="Zurück" onPress={() => void update($, spaeterA, () => '')} />
      </Box>
    )
  }
  // Die Antworten des Punkts stehen als Knoepfe da (man sieht, was a und b ist); das Menue hat nur den Rest.
  const feste = optionen.slice(0, punkt.optionen.length)
  const liste = surface !== 'mobile' && 'Select' in els
    ? (
      <Box key={key} flexDirection="row" flexWrap="wrap">
        {feste.map(o => (
          <Box key={`${key}-${o.value}`} flexDirection="row">
            <Button key={`${key}-k${o.value}`} label={o.label} onPress={() => void waehlen($, punkt, o.value, mitTextfeld)} />
            <Text> </Text>
          </Box>
        ))}
        <els.Select
          key={`${key}-menue`}
          label={feste.length > 0 ? '' : 'Antwort'}
          options={[{ value: KEINE, label: feste.length > 0 ? 'mehr …' : 'bitte wählen' }, ...optionen.slice(feste.length)]}
          value={KEINE}
          onSelect={(wert: string) => void (wert === KEINE ? undefined : waehlen($, punkt, wert, mitTextfeld))}
        />
      </Box>
    )
    : (
      <Box key={key} flexDirection="row" flexWrap="wrap">
        {optionen.map(o => (
          <Button key={`${key}-${o.value}`} label={o.label ?? o.value} onPress={() => void waehlen($, punkt, o.value, false)} />
        ))}
      </Box>
    )
  if (!(mitTextfeld && 'Input' in els) || eigene !== punkt.id) return liste

  return (
    <Box key={`${key}-eigene`} flexDirection="column">
      <els.Input
        key={`${key}-text`}
        label="Deine Antwort: "
        placeholder="eigene Antwort, Enter schickt ab"
        submitLabel="senden"
        autoFocus
        onSubmit={(text: string) => void eigeneAntwort($, punkt, text)}
      />
      <Box key={`${key}-zurueck`} flexDirection="row">
        <Text dimColor>Esc: zurück zur Eingabe · </Text>
        <Button key={`${key}-abbrechen`} label="Abbrechen" onPress={() => void update($, eigeneA, () => '')} />
      </Box>
    </Box>
  )
}

const kopf = (p: Punkt) =>
  p.stufe === 'blockiert'
    ? { zeichen: '■ Blockiert', farbe: 'red' }
    : p.stufe === 'angebot'
      ? { zeichen: '◇ Angebot', farbe: 'gray' }
      : { zeichen: p.art === 'aufgabe' ? '◆ Zu tun' : '◆ Offen', farbe: 'yellow' }

/** Die Befehle, mit denen sich der Punkt ohne Auswahl beantworten laesst - unter der Frage ueber der Eingabe. */
const kurzbefehle = (p: Punkt) => {
  const n = `/offen ${p.nr}`
  const buchstaben = p.optionen.slice(0, 4).map((_, i) => String.fromCharCode(97 + i)).join('|')
  return [...(buchstaben !== '' ? [`${n} ${buchstaben}`] : []), `${n} <Antwort>`, `/erledigt ${p.nr}`, `/weg ${p.nr}`, `${n} später`].join(' · ')
}

const optionenText = (p: Punkt) =>
  p.optionen.map((o, i) => `${String.fromCharCode(97 + i)}) ${o.label}`).join(' · ')

/** /offen mit Nummer: einen Punkt erledigen, verwerfen, zurueckstellen oder eine Antwort waehlen. */
async function offenKommando($: EngineInterface, args: string): Promise<string | null> {
  const k = kommando(args)
  if (k.art === 'liste') return null
  if (k.art === 'fehler') return k.text
  if (k.art === 'senden') {
    const n = gesammelt(await read($, punkteA)).length
    if (vorschlag !== '') {
      await abschicken($)
      return 'Vorgelegte Antworten gesendet.'
    }
    await senden($)
    return n > 0 ? 'Gesammelte Antworten gesendet.' : 'Es wartet nichts.'
  }
  if (k.art === 'leeren') {
    zeitgeber?.cancel()
    zeitgeber = null
    await update($, punkteA, () => [])
    await update($, ueberblickA, () => '')
    await speichern($, false)
    await zeigeStatus($)
    return 'Liste der offenen Punkte geleert.'
  }
  if (k.art === 'neu') {
    const [alle, jetzt, ab] = await Promise.all([read($, punkteA), $.clock.now(), nummernAb($)])
    const ids = new Set(alle.map(p => p.id))
    let i = 0
    let id: string
    do id = `n${jetzt.toString(36)}${(i++).toString(36)}`
    while (ids.has(id))
    await aendere($, liste => nummerieren([...liste, notiz(k.text, id, jetzt, sitzung)], ab))
    const neu = (await read($, punkteA)).find(p => p.id === id)
    return neu === undefined ? 'Punkt nicht angelegt.' : `Punkt ${neu.nr ?? '?'} angelegt: „${neu.titel}“`
  }
  if (k.art === 'gedanke-neu') {
    const g = await gedankenDatei($)
    if (g === null) return 'Kein Ablageort für Gedanken.'
    const nr = naechsteGedankenNr(g.d)
    const neu: Gedanke = { nr, zeit: zeitText(await $.clock.now()), vermerk: 'offen', text: k.text }
    g.d.gedanken.push(neu)
    await gedankenSchreiben($, g.datei, g.d)
    return `Gedanke G${nr} notiert: „${gedankeKurz(neu)}“ – /offen gedanke ${nr} senden|interview|punkt`
  }
  if (k.art === 'gedanken') {
    const g = await gedankenDatei($)
    const liste = (g?.d.gedanken ?? []).filter(x => gedankeZustand(x) !== 'verarbeitet')
    if (liste.length === 0) return 'Keine Gedanken offen – /offen gedanke <Text> notiert einen.'
    return `Gedanken (${liste.length}):\n${liste.map(x => `G${x.nr} · ${x.zeit} · ${x.vermerk}: ${gedankeKurz(x, 120)}`).join('\n')}\n\n/offen gedanke <Nr> senden|interview|punkt|erledigt|weg · /offen gedanken prüfen`
  }
  if (k.art === 'gedanken-pruefen') {
    const g = await gedankenDatei($)
    const inArbeit = (g?.d.gedanken ?? []).filter(x => gedankeZustand(x) === 'in Arbeit')
    if (inArbeit.length === 0) return 'Kein Gedanke in Arbeit.'
    // Wie /offen klaeren: ein Maschinen-Turn, in dem nur die Marken zaehlen.
    eingabeArt = 'maschine'
    const text = gedankenPruefBitte(inArbeit)
    $.clock.after(0, () => {
      void $.prompt.submit({ text, asUser: true }).catch(fehler => $.ui.log(`offene-punkte: Prüfung nicht gesendet (${String(fehler)})`))
    })
    return `Prüfung von ${inArbeit.length} ${inArbeit.length === 1 ? 'Gedanken' : 'Gedanken'} geht an Claude.`
  }
  if (k.art === 'gedanke') return gedankeTun($, k.nummer, k.tun, k.text)
  if (k.art === 'ueberblick') {
    const u = await ueberblickErneuern($, 'befehl')
    return u !== '' ? `Überblick neu:\n${u}` : 'Überblick nicht erneuert (kein Verlauf, oder Haiku gerade nicht erlaubt).'
  }
  if (k.art === 'klaeren') {
    const s = await sicht($)
    const punkte = await read($, punkteA)
    // alle: auch Zurückgelegtes und Punkte anderer (oft längst beendeter) Sitzungen - die werden dafür
    // übernommen, sonst prallten Claudes Marken an ihnen ab („gehört einer anderen Sitzung“).
    const liste = k.alle ? offene(punkte) : fragbar(punkte, s)
    if (liste.length === 0) return nichtsFragbar(punkte, s, ', /offen klären alle übernimmt und klärt sie')
    const fremde = new Set(liste.filter(p => fremd(p, s.sitzung)).map(p => p.id))
    if (fremde.size > 0) await aendere($, l => l.map(p => (fremde.has(p.id) ? { ...p, sitzung } : p)))
    const uebrig = k.alle ? 0 : offene(punkte).length - liste.length
    const text = klaerungsBitte(liste)
    // Ein eigener Submit laeuft nicht durch den eigenen prompt.submit-Hook: die Antwort darauf gilt
    // als Maschinen-Turn (nur Marken und Block, kein Nachfassen, kein Altern).
    eingabeArt = 'maschine'
    $.clock.after(0, () => {
      void $.prompt.submit({ text, asUser: true }).catch(fehler => $.ui.log(`offene-punkte: Klärung nicht gesendet (${String(fehler)})`))
    })
    const zusatz = fremde.size > 0 ? ` (${fremde.size} aus anderen Sitzungen hierher übernommen)`
      : uebrig > 0 ? ` (${uebrig} weitere aus anderen Sitzungen oder zurückgelegt: /offen klären alle)` : ''
    return `Klärung von ${liste.length} ${liste.length === 1 ? 'Punkt' : 'Punkten'} geht an Claude${zusatz}.`
  }
  if (k.art === 'alle') {
    // Sammelschluss ohne Modellrunde (claude-web, Aufraeumen); im Verlauf je Punkt nur eine Kurzzeile.
    const [punkte, s] = await Promise.all([read($, punkteA), sicht($)])
    const ids = new Set(fragbar(punkte, s).map(p => p.id))
    if (ids.size === 0) return nichtsFragbar(punkte, s, ', /offen <Nr> erledigt|weg schließt einzelne')
    const status = k.tun === 'weg' ? 'verworfen' as const : 'erledigt' as const
    const ergebnis = `gesammelt ${status}${k.grund !== '' ? ` – ${k.grund}` : ''}`
    await aendere($, liste => liste.map(p => (ids.has(p.id) ? { ...p, status, ergebnis } : p)))
    return `${ids.size} ${ids.size === 1 ? 'Punkt' : 'Punkte'} ${status}.`
  }
  const alle = await read($, punkteA)
  const punkt = offene(alle).find(p => p.nr === k.nummer)
  // Wieder öffnen, was ohne Zutun geschlossen wurde (claude-web: Knopf „wieder öffnen“)
  const zu = punkt === undefined && k.tun === 'aktuell' ? alle.find(p => p.nr === k.nummer && p.status !== 'offen') : undefined
  if (zu !== undefined) {
    await wiederOeffnen($, zu.id)
    return `„${zu.titel}“ ist wieder offen.`
  }
  if (punkt === undefined) {
    const beantwortet = ausstehende(alle).find(p => p.nr === k.nummer)
    if (beantwortet !== undefined) return `„${beantwortet.titel}“ ist schon beantwortet und geht mit den übrigen Antworten an Claude.`
    const geschlossen = alle.filter(p => p.nr === k.nummer && p.status !== 'offen')
      .sort((a, b) => (b.geaendert ?? b.erstellt) - (a.geaendert ?? a.erstellt))[0]
    return geschlossen !== undefined
      ? `#${k.nummer} „${geschlossen.titel}“ ist schon ${geschlossen.status === 'verworfen' ? 'verworfen' : 'erledigt'}${geschlossen.ergebnis ? ` (${geschlossen.ergebnis.slice(0, 120)})` : ''} – /offen ${k.nummer} aktuell öffnet ihn wieder.`
      : `Punkt ${k.nummer} gibt es nicht – /offen zeigt die Nummern.`
  }
  if (k.tun === 'antwort') {
    // Freie Antwort (auch von claude-web): schliesst den Punkt und geht sofort - direkt in die Sammlung,
    // nicht ueber die Eingabe (dort bliebe sie liegen, bis jemand Enter drueckt).
    const w: Wahl = { status: 'erledigt', label: 'eigene Antwort', text: k.text }
    await aendere($, liste => {
      const reihe = naechsteReihe(liste)
      return liste.map(p => (p.id === punkt.id
        ? { ...p, ausstehend: { status: w.status, ergebnis: ergebnis(w, w.text), text: w.text, wo: 'sammlung' as const, reihe } }
        : p))
    })
    await senden($)
    return `„${punkt.titel}“: Antwort geht an Claude.`
  }
  if (k.tun === 'optionen') {
    // Mehrere Antworten zusammen (Punkte mit Mehrfachauswahl): Saetze hintereinander als eine Antwort
    const gewaehlt = k.optionen.map(i => punkt.optionen[i])
    if (gewaehlt.some(o => o === undefined)) return `„${punkt.titel}“ hat nicht alle diese Antworten – ${optionenText(punkt)}`
    const os = gewaehlt as Option[]
    const w: Wahl = { status: 'erledigt', label: os.map(o => o.label).join(' + '),
                      text: os.map(o => o.antwort || o.label).join(' ') }
    await antworten($, punkt, w)
    return `„${punkt.titel}“: ${w.label}`
  }
  if (k.tun === 'option') {
    const o = punkt.optionen[k.option ?? -1]
    if (o === undefined) return `„${punkt.titel}“ hat keine Antwort ${String.fromCharCode(97 + (k.option ?? 0))}) – ${optionenText(punkt)}`
    await waehlen($, punkt, String(k.option), false)
    const wartet = gesammelt(await read($, punkteA)).length
    const ab = await read($, abschickenA)
    if (ab.sekunden > 0) {
      return `„${punkt.titel}“: ${o.label} – alle Fragen beantwortet, geht in ${ab.sekunden} s an Claude${ab.inEingabe ? ' (steht in der Eingabe, Enter schickt sofort)' : ' (oder /offen senden)'}`
    }
    return `„${punkt.titel}“: ${o.label}${wartet > 0 ? ` – wartet auf die übrigen Fragen (höchstens 30 s, oder /offen senden)` : ''}`
  }
  if (k.tun === 'spaeter' && k.bis !== undefined) {
    await waehlen($, punkt, `${RUHE}${k.bis}`, false)
    const p = (await read($, punkteA)).find(x => x.id === punkt.id)
    const wie = p !== undefined ? ruheVermerk(p, { sitzung: '', jetzt: await $.clock.now() }) : ''
    return `„${punkt.titel}“: ${wie || 'zurückgelegt.'}`
  }
  const wert = { erledigt: ERLEDIGT, weg: VERWERFEN, spaeter: ANS_ENDE, aktuell: AKTUELL }[k.tun]
  await waehlen($, punkt, wert, false)
  const was = { erledigt: 'erledigt', weg: 'verworfen', spaeter: 'zurückgestellt', aktuell: 'wieder aktuell' }[k.tun]
  return `„${punkt.titel}“: ${was}.`
}

export const register: Register = (on, options) => {
  modell = String(options.modell ?? 'haiku') || 'haiku'
  mindestLaenge = Number(options.mindestLaenge ?? 400)
  fragenAnzeigen = options.fragenAnzeigen !== false
  auswertung = options.auswertung === 'haiku' ? 'haiku' : 'claude'
  eintrag = options.eintrag === 'werkzeug' ? 'werkzeug' : 'block'
  budgetGrenze = Number(options.haikuBisProzent ?? BUDGET_GRENZE) || BUDGET_GRENZE
  werkzeugBenutzt = false
  warteschlange = []
  laeuft = false
  ort = null
  zeitgeber = null
  unterwegs.clear()
  sitzung = ''
  claudeKennt = ''
  interaktiv = true
  eingabeArt = 'mensch'
  turnLaeuft = false
  abgleichLaeuft = false
  abgleichTakt = null
  ueberblickLaeuft = false
  fertigeTurns = 0
  eingangTakt = null
  eingangLaeuft = false
  letzterMensch = 0
  installiert = ''

  on('session.start', async ($, e, next) => {
    // Ohne Menschen davor (claude -p, SDK) bleibt der Mod still: kein Werkzeug, kein Hinweis, kein Haiku -
    // nur die Datei und Claudes Marken. Das spart in Skript-Laeufen jede Anfrage rund 1.000 Tokens.
    interaktiv = e.isInteractive !== false
    turnLaeuft = false
    await $.command.register({
      name: 'offen',
      description: 'Zeigt, was noch offen ist; /offen 2 erledigt|weg|später [sitzung|morgen|drei|woche], /offen 2 a wählt eine Antwort, /offen 2 <Text> antwortet frei, /offen alle weg|erledigt [Grund], /offen klären [alle], /offen neu <Text>, /offen gedanke <Text> notiert einen Einfall (gedanken.md), /offen gedanke 3 senden|interview|punkt, /offen leeren',
    })
    await $.command.register({ name: 'erledigt', description: 'Kurzform: /erledigt 2 (oder 2 3) schließt offene Punkte wie /offen 2 erledigt' })
    await $.command.register({ name: 'weg', description: 'Kurzform: /weg 2 (oder 2 3) verwirft offene Punkte wie /offen 2 weg' })
    await $.command.register({
      name: 'zusammenfassung',
      description: 'Fasst die ganze Sitzung zusammen: Ziel, Erledigtes, was du noch tun musst (mit Befehlen), offene Entscheidungen',
    })
    // Das Werkzeug nur auf Wunsch: im Standard (Block) spart das rund 800 Tokens in jeder Anfrage.
    if (auswertung === 'claude' && eintrag === 'werkzeug' && interaktiv) {
      await $.tool.register({ name: WERKZEUG, description: WERKZEUG_BESCHREIBUNG, inputSchema: WERKZEUG_SCHEMA, isDeferred: false })
        .catch(fehler => $.ui.log(`offene-punkte: Werkzeug nicht registriert (${String(fehler)})`))
    }
    await update($, prueftA, () => false)
    sitzung = await $.session.id().catch(() => '')
    await versionPruefen($).catch(() => undefined)
    await laden($).catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
    $.clock.after(0, () => {
      void verlaufAufraeumen($).catch(fehler => $.ui.log(`offene-punkte: Verlauf nicht aufgeräumt (${String(fehler)})`))
    })
    await zaehlerLaden($).catch(fehler => $.ui.log(`offene-punkte: Zaehler nicht gelesen (${String(fehler)})`))
    // Punkte aus 0.5.0 haben noch keine Nummer.
    const ab = await nummernAb($)
    await update($, punkteA, l => nummerieren(l, ab))
    await zeigeStatus($)
    if (interaktiv) {
      $.clock.after(0, () => {
        void abgleich($, 'start').catch(fehler => $.ui.log(`offene-punkte: Abgleich fehlgeschlagen (${String(fehler)})`))
        void eingangLesen($).catch(fehler => $.ui.log(`offene-punkte: Eingang (${String(fehler)})`))
      })
      abgleichPlanen($)
      eingangPlanen($)
    }
    // Nach einem Neuladen des Plugins: was gesammelt wartete, wartet weiter (der Zeitgeber ist neu).
    await weiter($).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turnLaeuft = true
    turnStart = await $.clock.now()
    turnText = e.text
    return next(e)
  })

  // Nach einer Compaction kennt Claude die Liste nicht mehr sicher: mit dem naechsten Prompt kommt sie wieder.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && !('skip' in r && r.skip !== undefined)) {
      claudeKennt = ''
      // Der Ueberblick aus dem komprimierten Verlauf: die Zusammenfassung der Engine ist jetzt Teil davon.
      if (interaktiv) $.clock.after(0, () => void ueberblickErneuern($, 'compaction').catch(fehler => $.ui.log(`offene-punkte: Überblick (${String(fehler)})`)))
    }
    return r
  }).catch((_, e, next) => next(e))

  // Nach /clear startet keine neue Sitzung im Sinne von session.start: dort die Datei nachladen.
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason === 'clear') {
      ort = null
      claudeKennt = ''
      // Rückmeldungen zur alten Unterhaltung („Dein Block hat angelegt: #79“) gehören nicht in die neue.
      hinweiseFuerClaude = []
      eingabeArt = 'mensch'
      zeitgeber?.cancel()
      zeitgeber = null
      vorschlag = ''
      ticker?.cancel()
      ticker = null
      $.clock.after(0, () => void update($, abschickenA, () => ({ sekunden: 0, inEingabe: false })))
      // Antworten, die noch nicht bei Claude sind, gehoeren zur alten Unterhaltung: wieder fragen.
      $.clock.after(0, () => {
        void (async () => {
          // Neue Unterhaltung, neue Sitzungs-ID: die eigenen Punkte gehen mit.
          const alt = sitzung
          sitzung = await $.session.id().catch(() => alt)
          await aendere($, l => uebernehmen(zuruecknehmen(l), sitzung, alt))
          await laden($)
        })().catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
      })
    }
    return r
  })

  // Eingaben von Maschinen: Peer-Nachrichten, Zeitplaene, der SDK-Host, Kanaele. Was Claude darauf
  // antwortet, erzeugt keine Punkte und laesst keinen altern - nur seine Marken zaehlen.
  const MASCHINEN = new Set(['sdk', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel'])

  on('prompt.submit', async ($, e, next) => {
    eingangZeit = await $.clock.now()
    const punkte = await read($, punkteA).catch((): Punkt[] => [])
    // Die offenen Punkte gehen still mit, wenn sie sich geaendert haben (und nach einer Compaction):
    // Claude kennt den ganzen Verlauf und schliesst, was schon erledigt oder hinfaellig ist. Auch zu
    // Maschinen-Eingaben - sonst erfaehrt Claude Nummern und Rueckmeldungen erst Turns spaeter.
    const liste = interaktiv ? listeFuerClaude(punkte, await sicht($)) : ''
    const mitListe = liste !== '' && liste !== claudeKennt
    if (mitListe) claudeKennt = liste
    const hinweise = hinweiseFuerClaude
    hinweiseFuerClaude = []
    const zusatz = [...(mitListe ? [liste] : []), ...hinweise]
    const kontext = zusatz.length > 0 ? { context: [...(e.context ?? []), ...zusatz] } : {}
    if (MASCHINEN.has(e.origin.kind)) {
      eingabeArt = 'maschine'
      return next({ ...e, ...kontext })
    }
    // Nur was der Nutzer selbst schreibt, an der Tastatur oder am Handy - eine Antwort aus der Auswahl kennt
    // der Mod schon. Die eigene Klaerung (/offen klaeren) zaehlt wie claude-webs Klaerung als Maschine.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') {
      if (istMaschinenEingabe(e.text)) eingabeArt = 'maschine'
      return next({ ...e, ...kontext })
    }
    // claude-webs Klaerung kommt per tmux wie getippt an: wie eine Maschine behandeln.
    eingabeArt = istMaschinenEingabe(e.text) ? 'maschine' : 'mensch'
    if (eingabeArt === 'mensch') letzterMensch = await $.clock.now()
    // Selbst abgeschickt (z. B. Enter auf die vorgelegten Antworten): kein Countdown mehr.
    vorschlag = ''
    ticker?.cancel()
    ticker = null
    $.clock.after(0, () => void update($, abschickenA, () => ({ sekunden: 0, inEingabe: false })))
    const mit = gesammelt(punkte)
    const eingabe = ausstehende(punkte, 'eingabe')
    // Selbst geschriebene Antworten („Zum offenen Punkt „Titel“: …“, auch von claude-web per tmux):
    // die Punkte schliessen sich mit dieser Nachricht, ohne zweiten Befehl.
    const getippt = eingetippteAntworten(e.text, punkte)
    // Die Bitte aus dem Knopf Planungsinterview ist abgeschickt: der Punkt ruht, solange das Interview laeuft.
    const interview = interviewNummer(e.text)
    if (interview !== undefined) {
      $.clock.after(0, () => void aendere($, l => insInterview(l, interview, sitzung)).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`)))
    }
    // Gesammelte Antworten gehen mit dieser Nachricht, vor ihr - so kennt Claude sie zuerst.
    const text = mit.length > 0 ? `${sammelText(teileVon(mit))}\n\n${e.text}` : e.text
    letzteEingabe = text
    if (mit.length + eingabe.length + getippt.length === 0) return next({ ...e, ...kontext })

    zeitgeber?.cancel()
    zeitgeber = null
    const ids = new Set(mit.map(p => p.id))
    const weg = new Set<string>()
    const ergebnisse = new Map<string, string>()
    // Antworten aus der Eingabe: was noch in der Nachricht steht, ist beantwortet; was der Nutzer
    // herausgenommen hat, wird wieder gefragt.
    for (const p of eingabe) {
      const t = antwortIn(e.text, p.titel)
      if (t === null) {
        weg.add(p.id)
        continue
      }
      ids.add(p.id)
      // Was der Nutzer ergaenzt hat, kommt hinter die Wahl - nicht die Wahl selbst noch einmal.
      ergebnisse.set(p.id, t !== '' && t !== p.ausstehend?.text ? `${p.ausstehend?.ergebnis} – „${t}“` : String(p.ausstehend?.ergebnis))
    }
    const gesendet = await $.clock.now()
    const r = await next({ ...e, text, ...kontext })
    const angekommen = !('drop' in r && r.drop !== undefined)
    // Nicht hier warten: das Schliessen schreibt Dateien.
    $.clock.after(0, () => {
      void aendere($, l => {
        if (!angekommen) return zuruecknehmen(l)
        const selbst = new Map(getippt.map(g => [g.id, g.text]))
        const mitSelbst = l.map(p => {
          const t = selbst.get(p.id)
          if (t === undefined || p.status !== 'offen' || p.ausstehend !== undefined) return p
          return { ...p, status: 'erledigt' as const, ergebnis: t !== '' ? `eigene Antwort – „${t.slice(0, 300)}“` : 'eigene Antwort', beiClaude: gesendet }
        })
        return zuruecknehmen(abschliessen(mitSelbst, ids, ergebnisse, gesendet), weg)
      }).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
    })
    return r
  }).catch((_, e, next) => next(e))

  // Tippt der Nutzer in die vorgelegten Antworten, laeuft kein Countdown mehr: er schickt selbst ab.
  on('prompt.edit', async ($, e, next) => {
    if (ticker !== null && vorschlag !== '') {
      vorschlag = ''
      await anhalten($)
    }
    return next(e)
  })

  // Claude schließt selbst: „erledigt: #3“ in der Antwort schließt den Punkt sofort (auch bei kurzen Antworten).
  on('prompt.context', async ($, e, next) => {
    if (!interaktiv) return next(e)
    const r = await next(e)
    const hinweis = auswertung !== 'claude' ? HINWEIS_CLAUDE : eintrag === 'block' ? HINWEIS_BLOCK : HINWEIS_WERKZEUG
    return { ...r, blocks: [...r.blocks, { name: 'offenePunkte', text: hinweis }] }
  })

  // Claude legt Punkte selbst an und schliesst sie; die Antwort nennt die vergebenen Nummern.
  on('tool.call', { tool: WERKZEUG_VOLL }, async ($, e) => {
    // Subagenten fuehren keine Punkte: ihre Fragen gehoeren in ihre Abschlussmeldung, die Hauptsitzung traegt ein.
    if (e.agentId !== undefined) return { result: 'Offene Punkte führt nur die Hauptsitzung. Nenne, was der Nutzer entscheiden oder tun muss, in deiner Abschlussmeldung.' }
    werkzeugBenutzt = true
    const { neu, aenderungen, marken } = werkzeugLesen(e.input)
    if (neu.length + aenderungen.length + marken.length === 0) return { deny: 'Nichts übergeben: "neu" (Punkte mit titel, art, frage, optionen), "aktualisieren" (nr und Felder) oder "schliessen" (nr).' }
    const r = await punkteEintragen($, neu, aenderungen, marken, 'c')
    const teile = [
      r.angelegt.length > 0 ? `angelegt: ${r.angelegt.map(p => `#${p.nr ?? '?'} ${p.titel}`).join(', ')}` : '',
      r.doppelt > 0 ? `${r.doppelt} schon vorhanden (gleicher Titel offen oder kürzlich geschlossen)` : '',
      r.geaendert > 0 ? `geändert: ${r.geaendert}` : '',
      r.zu.length > 0 ? `geschlossen: ${r.zu.map(p => `#${p.nr ?? '?'}`).join(', ')}` : '',
      r.ohneTreffer.length > 0 ? `nicht geschlossen: ${r.ohneTreffer.join(', ')} (Nummern nur aus „Offene Punkte“ oder diesem Ergebnis, nie raten)` : '',
    ].filter(t => t !== '')
    return { result: `Offene Punkte: ${teile.join('; ') || 'nichts geändert'}. Der Nutzer bekommt neue Punkte über der Eingabe als Auswahl gestellt.` }
  }).catch(() => ({ deny: 'offene-punkte: Eintrag fehlgeschlagen, bitte noch einmal.' }))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) turnLaeuft = false
    const marken = e.agentId === undefined && e.reason === 'answer' ? schlussMarken(e.answer) : []
    if (marken.length > 0) {
      $.clock.after(0, () => {
        void (async () => {
          const jetzt = await $.clock.now()
          let vorher: Punkt[] = []
          const zu = await aendere($, l => {
            vorher = l
            return perMarkeSchliessen(l, marken, jetzt, sitzung)
          })
          if (zu.length > 0) $.ui.toast(zu.map(p => `🤖 „${p.titel}“ ${p.ergebnis?.includes('überholt') ? 'überholt' : 'erledigt'}`).join(' · ') + ' · /offen zum Wiederöffnen', { timeoutMs: 6000 })
          // Eine geratene oder fremde Nummer nicht still verpuffen lassen: der Nutzer sieht es, Claude erfaehrt es mit der naechsten Nachricht.
          const fehl = markenOhneTreffer(vorher, marken, sitzung, eingangZeit)
          if (fehl.length > 0) {
            $.ui.toast(`Marke ohne Treffer: ${fehl.join(' · ')}`, { timeoutMs: 8000 })
            hinweiseFuerClaude.push(markenHinweis(fehl, await read($, punkteA), sitzung))
          }
        })().catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    // „gedanke erledigt: G3 – Commit abc1234“: der Vermerk in gedanken.md.
    if (e.agentId === undefined && e.reason === 'answer' && /gedanke\s+(erledigt|umgesetzt|verworfen):/i.test(e.answer)) {
      const antwort = e.answer
      $.clock.after(0, () => {
        void (async () => {
          const jetzt = await $.clock.now()
          const fertig: string[] = []
          for (const m of gedankenMarken(antwort, jetzt)) {
            if ((await gedankeVermerken($, m.nr, m.vermerk)) !== null) fertig.push(`G${m.nr} ${m.vermerk}`)
          }
          if (fertig.length > 0) $.ui.toast(`💭 ${fertig.join(' · ')}`, { timeoutMs: 6000 })
        })().catch(fehler => $.ui.log(`offene-punkte: Gedanken (${String(fehler)})`))
      })
    }
    const benutzt = werkzeugBenutzt
    if (e.agentId === undefined) werkzeugBenutzt = false
    // Der Block in der Antwort: Punkte anlegen und aendern, ohne Werkzeug und ohne weitere Modellrunde.
    const block = e.agentId === undefined && e.reason === 'answer' ? blockLesen(e.answer) : { neu: [], aenderungen: [] }
    const blockDa = block.neu.length + block.aenderungen.length > 0
    if (blockDa) {
      $.clock.after(0, () => {
        void punkteEintragen($, block.neu, block.aenderungen, [], 'b').catch(fehler => $.ui.log(`offene-punkte: Block (${String(fehler)})`))
      })
    }
    // Nach Marken und Block (beide oben eingereiht): was bei Claude lag und weder bestaetigt noch
    // wieder geoeffnet wurde, ist nur noch beantwortet. Kaeme es doch zuerst, oeffnet der Block trotzdem.
    if (e.agentId === undefined && e.reason === 'answer') {
      const start = turnStart
      const text = turnText
      $.clock.after(0, () => {
        void aendere($, l => beiClaudeFertig(l, start, text)).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    // Nach Maschinen-Eingaben (Peer, Zeitplan, Klaerung) und ohne Menschen davor: nur Marken und Block.
    const mensch = interaktiv && eingabeArt === 'mensch'
    if (mensch && auswertung === 'claude' && e.agentId === undefined && e.reason === 'answer') {
      const antwort = e.answer
      const eingabe = letzteEingabe
      $.clock.after(0, () => {
        void (async () => {
          const jetzt = await $.clock.now()
          const alt = await aendere($, l => altern(l, antwort, jetzt))
          if (alt.length > 0) $.ui.toast(alt.map(p => `🤖 „${p.titel}“ geschlossen (${p.auto?.grund})`).join(' · ') + ' · /offen zum Wiederöffnen', { timeoutMs: 6000 })
          // Claude hat gefragt, aber nichts eingetragen (weder Werkzeug noch Block): Haiku fasst nach.
          if (!benutzt && !blockDa && nachfassen(antwort)) await auswerten($, [antwort], eingabe)
          // Alle UEBERBLICK_NACH Antworten den Ueberblick aus dem Verlauf neu schreiben.
          fertigeTurns++
          if (fertigeTurns >= UEBERBLICK_NACH) await ueberblickErneuern($, 'takt')
        })().catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    if (mensch && auswertung === 'haiku' && e.agentId === undefined && e.reason === 'answer' && auswertenNoetig(e.answer, mindestLaenge)) {
      const antwort = e.answer
      const eingabe = letzteEingabe
      // Ausserhalb dieses Hooks: die Auswertung soll das Ende der Antwort nicht aufhalten.
      $.clock.after(0, () => {
        void auswerten($, [antwort], eingabe).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    return r
  })

  on('command.run', { command: 'offen' }, async ($, e) => {
    const antwort = await offenKommando($, e.args)
    if (antwort !== null) return { text: antwort }

    await update($, ausgeblendetA, () => false)
    const platz = await $.ui.open({ id: PANE, title: 'Offene Punkte' })
    const liste = offene(await read($, punkteA))
    const ueberblick = await read($, ueberblickA)
    const s = await sicht($)
    const o = await ablageOrt($)
    const aktiv = liste.filter(p => !ruht(p, s))
    const ruhend = liste.filter(p => ruht(p, s))
    // Steht das Pane, zeigt es alles - die Befehlsausgabe landet sonst als Text im Kontext des Modells.
    if (platz.isPlaced) {
      const stand = liste.length === 0 ? 'Nichts offen' : `${aktiv.length} offen${ruhend.length > 0 ? `, ${ruhend.length} zurückgelegt` : ''}`
      return { text: `${stand} – alles im Pane „Offene Punkte“.` }
    }
    const kopfzeile = ueberblick !== '' ? `Überblick:\n${ueberblick}\n\n` : ''
    const fuss = o !== null ? `\n\nDatei: ${o.ordner}/offen.md · Verlauf: antworten-JJJJ-MM-TT.md` : ''
    if (liste.length === 0) return { text: `${kopfzeile}Nichts offen.${fuss}` }

    const aktivText = aktiv.length === 0 ? 'Gerade ist nichts dran.' : aktiv.map((p, i) => {
      const anleitung = (p.anleitung ?? '') !== '' ? `\n${p.anleitung.replace(/^/gm, '   ')}` : ''
      return `${p.nr ?? i + 1}. ${p.art === 'aufgabe' ? 'Zu tun: ' : ''}${p.titel}${vermerk(p, s)} – ${p.frage}${p.info !== '' ? `\n   ${p.info}` : ''}${anleitung}\n   ${optionenText(p)}`
    }).join('\n')
    // Zurueckgelegtes nur mit Titel und Termin, damit es nicht wie eine offene Frage aussieht.
    const ruhendText = ruhend.length === 0 ? '' : `\n\nZurückgelegt (${ruhend.length}):\n` + ruhend
      .map((p, i) => `${p.nr ?? i + 1}. ${p.titel} – ${ruheVermerk(p, s)}`).join('\n')
    const auto = autoErledigt(await read($, punkteA), await $.clock.now())
    const autoText = auto.length === 0 ? '' : `\n\nAutomatisch erledigt (${auto.length}, /offen <Nr> aktuell öffnet wieder):\n` + auto
      .map(p => `🤖 ${p.nr ?? '?'}. ${p.titel} – ${p.auto?.grund}`).join('\n')
    const gedanken = ((await gedankenDatei($))?.d.gedanken ?? []).filter(x => gedankeZustand(x) !== 'verarbeitet')
    const gedankenAbschnitt = gedanken.length === 0 ? '' : `\n\nGedanken (${gedanken.length}, /offen gedanke <Nr> senden|interview|punkt):\n` + gedanken
      .map(x => `💭 G${x.nr} · ${x.vermerk}: ${gedankeKurz(x, 100)}`).join('\n')
    return {
      text: kopfzeile + aktivText + ruhendText + autoText + gedankenAbschnitt + `\n\n/offen <Nr> a|b|c|d wählt eine Antwort · /offen <Nr> antwort <Text> · /offen <Nr> erledigt|weg|später [sitzung|morgen|drei|woche] · /offen alle weg|erledigt · /offen klären [alle] · /offen neu <Text> · /offen gedanke <Text>${fuss}`,
    }
  })

  // Kurzformen: /erledigt 2 3 und /weg 2 - je Nummer wie /offen <Nr> erledigt|weg.
  for (const tun of ['erledigt', 'weg'] as const) {
    on('command.run', { command: tun }, async ($, e) => {
      const nummern = kurzNummern(e.args)
      if (nummern === null) return { text: `Verwendung: /${tun} <Nr> [<Nr> …] – die Nummern zeigt /offen.` }
      const antworten: string[] = []
      for (const n of nummern) antworten.push((await offenKommando($, `${n} ${tun}`)) ?? '')
      return { text: antworten.filter(t => t !== '').join('\n') }
    })
  }

  // Die ganze Sitzung zusammenfassen: ein Fork des Hauptmodells ueber den eigenen Verlauf (aus dem
  // Prompt-Cache), ohne Werkzeuge. Der Ueberblick kommt daneben von Haiku aus den Texten des Verlaufs -
  // nicht als zweiter Fork, der den ganzen Kontext noch einmal laese (claude-web: Knopf "Aktualisieren").
  on('command.run', { command: 'zusammenfassung' }, async $ => {
    const [r] = await Promise.all([
      $.model.fork({ prompt: ZUSAMMENFASSUNG }),
      ueberblickErneuern($, 'zusammenfassung').catch(fehler => $.ui.log(`offene-punkte: Überblick (${String(fehler)})`)),
    ])
    if (r.isAnswered) return { text: r.text }
    if (r.reason === 'nothing-to-fork') return { text: 'Noch nichts zusammenzufassen – die Sitzung hat noch keine Antwort.' }
    return { text: `Zusammenfassung nicht möglich (${r.reason}).` }
  })

  // Die naechste offene Frage ueber der Eingabe, darueber Warnungen von kontext-anzeige.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [alle, aus, warnungen, s] = await Promise.all([read($, punkteA), read($, warnungenAusA), read($, warnungenA), sicht($)])
    // Ausgeblendete Warnungen kommen wieder, sobald sie einmal verschwunden waren.
    const aktuell = new Set(warnungen.map(w => w.schluessel))
    if (aus.some(x => !aktuell.has(x))) $.clock.after(0, () => void update($, warnungenAusA, l => l.filter(x => aktuell.has(x))))
    const zeigen = zuZeigen(warnungen, aus)
    const fragen = fragenAnzeigen && !(await read($, ausgeblendetA))
    const liste = fragen ? fragbar(alle, s) : []
    const punkt = liste[0]
    const ab = await read($, abschickenA)
    if (punkt === undefined && zeigen.length === 0 && ab.sekunden === 0) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    const warnZeilen = zeigen.map(w => (
      <Box key={`warn-${w.schluessel}`} flexDirection="row" flexWrap="wrap">
        <Text color="red" wrap="wrap">⚠ {w.text} </Text>
        {mitCompact(w) && <Button key={`compact-${w.schluessel}`} label="/compact" onPress={() => void eintragen($, '/compact ')} />}
        <Text> </Text>
        <Button key={`aus-${w.schluessel}`} label="Ausblenden" onPress={() => void update($, warnungenAusA, l => [...l, w.schluessel])} />
      </Box>
    ))
    if (punkt === undefined && ab.sekunden > 0) {
      const n = gesammelt(alle).length + ausstehende(alle, 'eingabe').length
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          {warnZeilen}
          <Text>
            <Text color="green" bold>✓ Alle Fragen beantwortet</Text>
            <Text>{` – ${n === 1 ? 'die Antwort geht' : `${n} Antworten gehen`} in ${ab.sekunden} s an Claude.`}</Text>
          </Text>
          <Box flexDirection="row">
            <Text dimColor>{ab.inEingabe ? 'Steht in der Eingabe: Enter schickt sofort, Tippen hält an. ' : ''}</Text>
            <Button key="jetzt" label="Jetzt senden" variant="primary" onPress={() => void abschicken($)} />
            {ab.inEingabe && <Text> </Text>}
            {ab.inEingabe && <Button key="anhalten" label="Anhalten" onPress={() => { vorschlag = ''; void anhalten($) }} />}
          </Box>
        </Box>
      )
    }
    if (punkt === undefined) return <Box flexDirection="column" paddingX={1}>{warnZeilen}</Box>

    const k = kopf(punkt)
    const wartend = gesammelt(alle).length
    const [eigene, spaeter] = await Promise.all([read($, eigeneA), read($, spaeterA)])

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={k.farbe} paddingX={1}>
        {warnZeilen}
        <Text>
          <Text color={k.farbe} bold>{k.zeichen}{punkt.nr !== undefined ? ` #${punkt.nr}` : ''}</Text>
          <Text dimColor>{liste.length > 1 ? ` (1 von ${liste.length})` : ''}{istVeraltet(punkt) ? ' – noch aktuell?' : ''}: </Text>
          <Text bold>{punkt.titel}</Text>
        </Text>
        <Text wrap="wrap">{punkt.frage}</Text>
        {(punkt.anleitung ?? '') !== '' && <Markdown key={`anleitung-${punkt.id}`} text={punkt.anleitung} />}
        {punkt.nr !== undefined && <Text dimColor wrap="wrap">{kurzbefehle(punkt)}</Text>}
        {wartend > 0 && (
          <Box key="wartend" flexDirection="row">
            <Text color="cyan">{wartend === 1 ? '1 Antwort wartet' : `${wartend} Antworten warten`} auf die übrigen Fragen (höchstens 30 s) </Text>
            <Button key="senden" label="Jetzt senden" onPress={() => void senden($)} />
          </Box>
        )}
        <Box flexDirection="row">
          {wahl($, els, e.surface, `wahl-${punkt.id}`, punkt, eigene, spaeter)}
          <Text> </Text>
          <Button key="alle" label="Alle zeigen" onPress={() => void $.ui.open({ id: PANE, title: 'Offene Punkte' })} />
          <Text> </Text>
          <Button key="ausblenden" label="Ausblenden" onPress={() => void update($, ausgeblendetA, () => true)} />
        </Box>
      </Box>
    )
  })

  // /offen: alles, was offen ist, und was zuletzt erledigt wurde.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    const [punkte, prueft, ueberblick, eigene, spaeter, s] = await Promise.all([
      read($, punkteA), read($, prueftA), read($, ueberblickA), read($, eigeneA), read($, spaeterA), sicht($),
    ])
    const liste = offene(punkte).filter(p => !ruht(p, s))
    const ruhend = offene(punkte).filter(p => ruht(p, s))
    const fertig = zuletztFertig(punkte)
    // Gedanken aus der Datei; der Stand-Zaehler sorgt dafuer, dass das Pane nach einer Aenderung neu zeichnet.
    await read($, gedankenStandA)
    const gedanken = ((await gedankenDatei($))?.d.gedanken ?? []).filter(x => gedankeZustand(x) !== 'verarbeitet')

    return (
      <Box flexDirection="column">
        {ueberblick !== '' && (
          <Box key="ueberblick" flexDirection="column" marginBottom={1}>
            <Text bold>Überblick</Text>
            <Markdown key="ueberblick-text" text={ueberblick} />
          </Box>
        )}
        {prueft && <Text dimColor>prüft die letzte Antwort …</Text>}
        {liste.length === 0 && <Text dimColor>{ruhend.length > 0 ? 'Gerade ist nichts dran.' : 'Nichts offen.'}</Text>}
        {liste.map((p, i) => (
          <Box key={p.id} flexDirection="column" borderStyle="round" borderColor={kopf(p).farbe} borderDimColor={istVeraltet(p)} paddingX={1}>
            <Text>
              <Text color={kopf(p).farbe} bold>{p.nr ?? i + 1}. {p.art === 'aufgabe' ? 'Zu tun: ' : ''}</Text>
              <Text bold>{p.titel}</Text>
              <Text dimColor>{vermerk(p, s)}</Text>
            </Text>
            <Text wrap="wrap" dimColor={istVeraltet(p)}>{p.frage}</Text>
            {p.info !== '' && <Text dimColor wrap="wrap">{p.info}</Text>}
            {(p.anleitung ?? '') !== '' && <Markdown key={`anl-${p.id}`} text={p.anleitung} />}
            {fremd(p, s.sitzung)
              ? <Button key={`hier-${p.id}`} label="Hier übernehmen" onPress={() => void aendere($, l => l.map(x => (x.id === p.id ? { ...x, sitzung } : x)))} />
              : wahl($, els, e.surface, `liste-${p.id}`, p, eigene, spaeter)}
          </Box>
        ))}
        {gedanken.length > 0 && <Text key="gedanken-kopf" dimColor>— Gedanken ({gedanken.length}) —</Text>}
        {gedanken.map(x => (
          <Box key={`g-${x.nr}`} flexDirection="row" flexWrap="wrap">
            <Text dimColor={gedankeZustand(x) !== 'offen'}>💭 G{x.nr} · {x.vermerk}: {gedankeKurz(x)} </Text>
            {gedankeZustand(x) === 'offen' && <Button key={`gs-${x.nr}`} label="Senden" onPress={() => void gedankeTun($, x.nr, 'senden')} />}
            {gedankeZustand(x) === 'offen' && <Text> </Text>}
            {gedankeZustand(x) === 'offen' && <Button key={`gi-${x.nr}`} label="Interview" onPress={() => void gedankeTun($, x.nr, 'interview')} />}
            {gedankeZustand(x) === 'offen' && <Text> </Text>}
            {gedankeZustand(x) === 'offen' && <Button key={`gp-${x.nr}`} label="Als Punkt" onPress={() => void gedankeTun($, x.nr, 'punkt')} />}
            <Text> </Text>
            <Button key={`ge-${x.nr}`} label="Erledigt" onPress={() => void gedankeTun($, x.nr, 'erledigt')} />
            <Text> </Text>
            <Button key={`gw-${x.nr}`} label="Weg" onPress={() => void gedankeTun($, x.nr, 'weg')} />
          </Box>
        ))}
        {ruhend.length > 0 && <Text key="ruhend-kopf" dimColor>— zurückgelegt ({ruhend.length}) —</Text>}
        {ruhend.map(p => (
          <Box key={`r-${p.id}`} flexDirection="row" flexWrap="wrap">
            <Text dimColor>⏸ {p.titel} · {ruheVermerk(p, s)}</Text>
            <Text> </Text>
            <Button key={`aufnehmen-${p.id}`} label="Jetzt aufnehmen" onPress={() => void aufnehmen($, p.id)} />
          </Box>
        ))}
        {fertig.length > 0 && <Text dimColor>— zuletzt erledigt —</Text>}
        {fertig.map(p => (
          <Box key={`f-${p.id}`} flexDirection="row">
            <Text dimColor strikethrough={p.status === 'verworfen'}>
              {p.status === 'verworfen' ? '✗' : p.beiClaude !== undefined ? '⏳' : p.auto !== undefined ? '🤖' : '✓'} {p.titel}{p.ergebnis ? `: ${p.ergebnis}` : ''}{p.beiClaude !== undefined ? ' – bei Claude' : ''}
            </Text>
            <Text> </Text>
            <Button key={`auf-${p.id}`} label="Wieder öffnen" onPress={() => void wiederOeffnen($, p.id)} />
          </Box>
        ))}
      </Box>
    )
  })
}
