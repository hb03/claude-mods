// /offen-Befehle, Antworten über der Eingabe, Bitten an Claude, eingang.txt
import type { Art, Grabstein, Option, Punkt, Ruhe, Stufe, Warnung } from '../../types'
import { fremd } from './punkte'
import type { Ruhezeit } from './punkte'

/** Sprachen, deren Codeblöcke als Shell-Befehl gelten (leer: ohne Angabe). */
const SHELL = new Set(['', 'bash', 'sh', 'shell', 'console', 'zsh'])

/**
 * Die Shell-Befehle aus einer Anleitung, je Codeblock einer (mehrere Zeilen mit
 * && verbunden), höchstens drei. Kommentare und ein "$ " am Anfang fallen weg.
 */
export function befehle(anleitung: string): string[] {
  const liste: string[] = []
  // Zeilen „$ befehl“ ausserhalb von Codeblöcken (so schreibt Claude sie im Block).
  for (const m of anleitung.replace(/```[\s\S]*?```/g, '').matchAll(/^[ \t]*\$[ \t]+(.+?)[ \t]*$/gm)) {
    const befehl = (m[1] ?? '').trim()
    if (befehl !== '' && !liste.includes(befehl)) liste.push(befehl)
  }
  for (const m of anleitung.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    if (!SHELL.has((m[1] ?? '').trim().toLowerCase())) continue
    const zeilen = (m[2] ?? '').split('\n')
      .map(z => z.trim().replace(/^\$\s+/, ''))
      .filter(z => z !== '' && !z.startsWith('#'))
    if (zeilen.length === 0) continue
    // Ohne Sprachangabe nur, was wie ein Befehl aussieht - kein JSON, keine Einstellungen.
    if ((m[1] ?? '').trim() === '' && /^[{["<]|^\w+\s*[=:]\s/.test(zeilen[0] ?? '')) continue
    const befehl = zeilen.map(z => z.replace(/\s*\\$/, '')).join(zeilen.some(z => z.endsWith('\\')) ? ' ' : ' && ')
    if (!liste.includes(befehl)) liste.push(befehl)
  }
  return liste.slice(0, 3)
}

/**
 * Was "Ausführen" in die Eingabe legt: eine Bitte an Claude, den Befehl mit seinem
 * Bash-Werkzeug auszuführen. Ein eingefügtes "! befehl" schaltet die Eingabe nicht
 * in den Bash-Modus, sondern ginge als Text an Claude.
 */
export function ausfuehrBitte(titel: string, befehl: string): string {
  const zaun = befehl.includes('`') ? '``' : '`'
  const abstand = zaun === '``' ? ' ' : ''
  return `Zum offenen Punkt „${titel}“: Bitte führe aus: ${zaun}${abstand}${befehl}${abstand}${zaun}`
}

/** Wie lange gesammelte Antworten nach der letzten Wahl auf weitere warten. */
export const WARTEZEIT = 30_000

/**
 * Eine gesammelte Antwort: zu welchem Punkt, und was Claude bekommt. Mit `frage`, wenn der Text nur
 * das Label einer Möglichkeit ist (Block-Punkte): dann steht die Frage dabei, damit Claude auch nach
 * einer Compaction weiss, worauf sich „55 MB“ bezieht.
 */
export type Teil = { titel: string; text: string; frage?: string; nr?: number }

const teilKopf = (t: Teil) => `${t.nr !== undefined ? `#${t.nr} ` : ''}„${t.titel}“${t.frage !== undefined && t.frage !== '' ? ` (${t.frage})` : ''}`

/**
 * Die gesammelten Antworten als eine Nachricht. Ist der letzte Text leer, endet sie
 * offen - für die Eingabe, wo der Nutzer noch etwas ergänzt.
 */
export function sammelText(teile: readonly Teil[]): string {
  if (teile.length === 1) return `Zum offenen Punkt ${teilKopf(teile[0]!)}: ${teile[0]!.text}`
  return 'Zu den offenen Punkten:\n' + teile.map(t => `- ${teilKopf(t)}: ${t.text}`).join('\n')
}

/** Kurzform eines Befehls für die Auswahl. */
export const befehlLabel = (befehl: string): string => `Ausführen: ${befehl.length > 32 ? befehl.slice(0, 31) + '…' : befehl}`

export type Kommando =
  | { art: 'liste' }
  | { art: 'leeren' }
  | { art: 'senden' }
  /** Claude soll die offenen Punkte selbst durchgehen (erledigt/überholt per Marke), ohne sie neu zu formulieren;
   *  alle: auch zurückgelegte und die anderer Sitzungen (die werden dafür übernommen). */
  | { art: 'klaeren'; alle: boolean }
  /** Den Überblick aus dem Verlauf neu schreiben lassen (Haiku). */
  | { art: 'ueberblick' }
  | { art: 'kosten'; tage: number }
  /** Übergabe an die nächste Sitzung schreiben (Fork des Hauptmodells), danach /clear - außer mit „nur“. */
  | { art: 'uebergabe'; clear: boolean }
  /** Archiv der Übergaben: alle zeigen, eine ältere lesen (1 = die neueste). */
  | { art: 'uebergaben' }
  | { art: 'uebergabe-zeigen'; nummer: number }
  /** Gedanken: notieren, zeigen, prüfen lassen, einen senden / ins Interview / als Punkt / erledigt / weg. */
  | { art: 'gedanke-neu'; text: string }
  | { art: 'gedanken' }
  | { art: 'gedanken-pruefen' }
  | { art: 'gedanke'; nummer: number; tun: 'senden' | 'interview' | 'punkt' | 'erledigt' | 'weg'; text: string }
  | { art: 'fehler'; text: string }
  | { art: 'neu'; text: string }
  /** Alle offenen Punkte dieser Sitzung auf einmal schließen (claude-web, Aufräumen). */
  | { art: 'alle'; tun: 'erledigt' | 'weg'; grund: string }
  | { art: 'punkt'; nummer: number; tun: 'erledigt' | 'weg' | 'spaeter' | 'aktuell' | 'option'; option?: number; bis?: Ruhezeit }
  | { art: 'punkt'; nummer: number; tun: 'optionen'; optionen: number[] }
  /** Freie Antwort auf einen Punkt: schließt ihn und geht sofort an Claude. */
  | { art: 'punkt'; nummer: number; tun: 'antwort'; text: string }

const ZEITWORT: Record<string, Ruhezeit> = { sitzung: 'sitzung', morgen: 'morgen', drei: 'drei', woche: 'woche' }

/** Liest die Argumente von /offen: "", "leeren", "neu Text", "2 erledigt", "3 weg", "1 später", "1 später morgen", "2 a", "2 antwort Text", "2 Text", "alle weg Grund". */
export function kommando(args: string): Kommando {
  const neu = /^neu(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (neu !== null) {
    const text = (neu[1] ?? '').trim()
    return text === '' ? { art: 'fehler', text: 'Verwendung: /offen neu <Text>' } : { art: 'neu', text }
  }
  const gedanke = /^gedanke\s+G?(\d+)\s+(senden|interview|punkt|erledigt|weg)(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (gedanke !== null) {
    return { art: 'gedanke', nummer: Number(gedanke[1]), tun: (gedanke[2] ?? '').toLowerCase() as 'senden' | 'interview' | 'punkt' | 'erledigt' | 'weg', text: (gedanke[3] ?? '').trim() }
  }
  const gedankeNeu = /^gedanke(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (gedankeNeu !== null) {
    const text = (gedankeNeu[1] ?? '').trim()
    return text === '' ? { art: 'fehler', text: 'Verwendung: /offen gedanke <Text> · /offen gedanke <Nr> senden|interview|punkt|erledigt|weg' } : { art: 'gedanke-neu', text }
  }
  if (/^gedanken\s+(prüfen|pruefen)$/i.test(args.trim())) return { art: 'gedanken-pruefen' }
  if (/^gedanken$/i.test(args.trim())) return { art: 'gedanken' }
  const antwort = /^(\d+)\s+antwort(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (antwort !== null) {
    const text = (antwort[2] ?? '').trim()
    return text === '' ? { art: 'fehler', text: 'Verwendung: /offen <Nr> antwort <Text>' } : { art: 'punkt', nummer: Number(antwort[1]), tun: 'antwort', text }
  }
  const alle = /^alle\s+(weg|verwerfen|erledigt|fertig)(?:\s+([\s\S]*))?$/i.exec(args.trim())
  if (alle !== null) return { art: 'alle', tun: /^(weg|verwerfen)$/i.test(alle[1] ?? '') ? 'weg' : 'erledigt', grund: (alle[2] ?? '').trim() }
  const a = args.trim().toLowerCase()
  if (a === '') return { art: 'liste' }
  const klaeren = /^(?:(alle)\s+)?kl(?:ä|ae)ren(?:\s+(alle))?$/.exec(a)
  if (klaeren !== null) return { art: 'klaeren', alle: klaeren[1] !== undefined || klaeren[2] !== undefined }
  if (a === 'überblick' || a === 'ueberblick') return { art: 'ueberblick' }
  const kosten = /^kosten(?:\s+(\d+))?$/.exec(a)
  if (kosten !== null) return { art: 'kosten', tage: Number(kosten[1] ?? 0) }
  const uebergabe = /^(?:übergabe|uebergabe)(?:\s+(nur|\d+))?$/.exec(a)
  if (uebergabe !== null) {
    const zusatz = uebergabe[1]
    if (zusatz === undefined || zusatz === 'nur') return { art: 'uebergabe', clear: zusatz === undefined }
    return { art: 'uebergabe-zeigen', nummer: Number(zusatz) }
  }
  if (a === 'übergaben' || a === 'uebergaben') return { art: 'uebergaben' }
  // Mehrere Antworten: "3 a c" oder "3 a,c" (bei Punkten mit Mehrfachauswahl)
  const mehrere = /^(\d+)\s+([a-d](?:[\s,]+[a-d])+)$/.exec(a)
  if (mehrere !== null) {
    const optionen = [...new Set((mehrere[2] ?? '').split(/[\s,]+/).map(b => b.charCodeAt(0) - 97))].sort((x, y) => x - y)
    return { art: 'punkt', nummer: Number(mehrere[1]), tun: 'optionen', optionen }
  }
  if (a === 'leeren') return { art: 'leeren' }
  if (a === 'senden') return { art: 'senden' }
  const m = /^(\d+)\s+(\S+)(?:\s+(\S+))?$/.exec(a)
  if (m !== null) {
    const nummer = Number(m[1])
    const wort = m[2] ?? ''
    if (m[3] !== undefined && (wort === 'später' || wort === 'spaeter')) {
      const bis = ZEITWORT[m[3]]
      return bis === undefined ? { art: 'fehler', text: HILFE } : { art: 'punkt', nummer, tun: 'spaeter', bis }
    }
    if (m[3] === undefined) {
      if (/^[a-d]$/.test(wort)) return { art: 'punkt', nummer, tun: 'option', option: wort.charCodeAt(0) - 97 }
      if (wort === 'erledigt' || wort === 'fertig') return { art: 'punkt', nummer, tun: 'erledigt' }
      if (wort === 'weg' || wort === 'verwerfen') return { art: 'punkt', nummer, tun: 'weg' }
      if (wort === 'später' || wort === 'spaeter') return { art: 'punkt', nummer, tun: 'spaeter' }
      if (wort === 'aktuell') return { art: 'punkt', nummer, tun: 'aktuell' }
    }
  }
  // Alles andere nach der Nummer ist eine freie Antwort: "/offen 2 bitte erst morgen" wie "/offen 2 antwort …".
  // Beginnt es mit einem Befehlswort ("2 erledigt morgen"), ist es eher ein Vertipper als eine Antwort.
  const frei = /^(\d+)\s+([\s\S]+)$/.exec(args.trim())
  if (frei !== null && !BEFEHLSWORT.test(frei[2] ?? '')) return { art: 'punkt', nummer: Number(frei[1]), tun: 'antwort', text: (frei[2] ?? '').trim() }
  return { art: 'fehler', text: HILFE }
}

/** Die Nummern hinter /erledigt und /weg: "1", "1 3", "#1, #3". Sonst null. */
export function kurzNummern(args: string): number[] | null {
  const t = args.trim()
  if (!/^#?\d+(?:[\s,]+#?\d+)*$/.test(t)) return null
  return [...new Set(t.split(/[\s,]+/).map(x => Number(x.replace('#', ''))))]
}

const BEFEHLSWORT = /^(erledigt|fertig|weg|verwerfen|später|spaeter|aktuell)(\s|$)/i

const HILFE = 'Verwendung: /offen · /offen <Nr> erledigt|weg|später|aktuell · /offen <Nr> später sitzung|morgen|drei|woche · /offen <Nr> a|b|c|d (Antwort wählen, bei Mehrfachauswahl auch "a c") · /offen <Nr> <Text> oder /offen <Nr> antwort <Text> (freie Antwort, geht sofort) · /offen alle weg|erledigt [Grund] · /offen klären [alle] · /offen überblick · /offen übergabe [nur] · /offen übergaben · /offen übergabe <Nr> · /offen neu <Text> · /offen gedanke <Text> · /offen gedanken [prüfen] · /offen gedanke <Nr> senden|interview|punkt|erledigt|weg · /offen senden (gesammelte Antworten jetzt) · /offen leeren'

/**
 * Die Bitte, die /offen klären an Claude schickt. Beginnt mit „Automatische Klärung“, damit der
 * Turn nicht ausgewertet wird (keine neuen Punkte, keine Alterung) - nur die Marken darin zählen.
 * Anders als claude-webs alte Klärung verlangt sie Marken statt neu formulierter Fragen: die
 * hielten die Punkte am Leben und erzeugten Geschwister mit anderem Titel.
 */
export function klaerungsBitte(punkte: readonly Punkt[]): string {
  const liste = punkte.map(p => `#${p.nr ?? '?'} ${p.titel} (${p.frage})`).join('; ')
  return `Automatische Klärung der offenen Punkte: ${liste}. Geh sie durch. Ist einer inzwischen erledigt, entschieden oder hinfällig - aus dem Verlauf, oder weil du es selbst nachsehen kannst (Code, Logs, Dateien, Commits) -, schreib je eine Zeile „erledigt: #N – Grund“ bzw. „überholt: #N – Grund“. Noch offene Punkte nicht neu formulieren und keine neuen Punkte anlegen; nenne sie höchstens als „offen: #N – was noch fehlt“ in einer Zeile. Nichts umsetzen.`
}

/** Vorbereitete Bitten zu einem Punkt (Knöpfe Erklären, Planungsinterview, Selbst klären); der Punkt bleibt offen. */
export function bitteZu(art: 'erklaeren' | 'interview' | 'klaeren', p: Punkt): string {
  const nr = p.nr !== undefined ? `#${p.nr} ` : ''
  if (art === 'erklaeren') return `Erkläre mir den offenen Punkt ${nr}„${p.titel}“ genauer: worum geht es, welche Möglichkeiten gibt es, was empfiehlst du und warum?`
  if (art === 'interview') {
    const ref = nr.trim() || p.titel
    return `Lass uns den offenen Punkt ${nr}„${p.titel}“ im Planungsinterview durchgehen: frag mich die offenen Details einzeln ab. Am Ende: ist alles entschieden, schreib „erledigt: ${ref}“; bleibt etwas offen, ändere den Punkt mit „# ${nr.trim() || '#<Nr>'} ${p.titel}“ im Block, und was neu offen ist, leg als eigenen Punkt an.`
  }
  return `Kläre den offenen Punkt ${nr}„${p.titel}“ bitte selbst (Code, Logs, Dateien, Commits) und sag mir das Ergebnis; ist er damit erledigt, schreib „erledigt: ${nr.trim() || p.titel}“.`
}

/** Die Nummer aus einer abgeschickten Interview-Bitte (bitteZu 'interview'), sonst undefined. */
export function interviewNummer(text: string): number | undefined {
  const m = /Lass uns den offenen Punkt #(\d+) „[^“]*“ im Planungsinterview durchgehen/.exec(text)
  return m !== null ? Number(m[1]) : undefined
}

/**
 * Der Punkt geht ins Planungsinterview: er ruht, damit er nicht nebenher über der Eingabe gefragt wird.
 * Er wacht auf, wenn Claude ihn ändert („# #N“), schließt ihn ohnehin per Marke - spätestens in der nächsten Sitzung.
 */
export function insInterview(liste: readonly Punkt[], nr: number, sitzung: string): Punkt[] {
  return liste.map(p => p.nr === nr && p.status === 'offen' && p.ausstehend === undefined && !fremd(p, sitzung)
    ? { ...p, ruht: { sitzung, interview: true as const } }
    : p)
}

export const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** Was über der Eingabe steht: nur Warnungen, ohne die ausgeblendeten. */
export const zuZeigen = (w: readonly Warnung[], aus: readonly string[]): Warnung[] =>
  w.filter(x => x.stufe === 'warn' && !aus.includes(x.schluessel))

/** Warnungen zum Kontext bekommen einen Knopf /compact. */
export const mitCompact = (w: Warnung): boolean => w.schluessel.startsWith('kontext')

/** So oft sieht eine Sitzung nach, ob in eingang.txt etwas liegt - solange jemand daran arbeitet … */
export const EINGANG_TAKT_MS = 15_000

/** … und so oft, wenn seit EINGANG_WACH_MS keine Eingabe eines Menschen kam (Server-Sitzungen ruhen stundenlang). */
export const EINGANG_RUHE_MS = 90_000

export const EINGANG_WACH_MS = 10 * 60_000

/**
 * eingang.txt: je Zeile ein /offen-Befehl ohne das „/offen“ („12 antwort Ja, bitte“, „12 a“,
 * „12 erledigt“, „alle weg Aufgeräumt“, „klären“, „neu Text“). claude-web oder ein Skript hängt an,
 * die Sitzung führt aus und leert die Datei. Leere Zeilen und Kommentare (#) fallen weg.
 */
export function eingangZeilen(text: string): string[] {
  return text.split(/\r?\n/)
    .map(z => z.trim().replace(/^\/offen\s+/i, ''))
    .filter(z => z !== '' && !z.startsWith('#'))
}
