import type { Fund, Push } from '../types'

/** Höchstens so viele Funde stehen in der Frage. */
export const MAX_FUNDE = 12

/** Zerlegt eine Shell-Zeile in Wörter; Anführungszeichen halten zusammen. */
export function woerter(zeile: string): string[] {
  const liste: string[] = []
  let wort = ''
  let hat = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i]!
    if (quote !== null) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < zeile.length) wort += zeile[++i]
      else wort += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      hat = true
    } else if (c === '\\' && i + 1 < zeile.length) {
      wort += zeile[++i]
      hat = true
    } else if (/\s/.test(c)) {
      if (hat || wort !== '') liste.push(wort)
      wort = ''
      hat = false
    } else {
      wort += c
      hat = true
    }
  }
  if (hat || wort !== '') liste.push(wort)
  return liste
}

/** Optionen von git vor dem Unterbefehl, die einen Wert nehmen. */
const MIT_WERT = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/**
 * Die git-push-Aufrufe in einem Shell-Befehl, mit dem Verzeichnis (`git -C`, sonst ein
 * `cd` davor) und dem Remote. Andere git-Befehle und Text in Anführungszeichen zählen nicht.
 */
export function pushAufrufe(befehl: string): Push[] {
  const liste: Push[] = []
  let cd: string | undefined
  for (const teil of befehl.split(/&&|\|\||[;|\n]/)) {
    const w = woerter(teil.trim())
    if (w[0] === 'cd') {
      cd = w[1]
      continue
    }
    const g = w.indexOf('git')
    if (g < 0 || (g > 0 && !/^(\w+=\S*|sudo|env|command|exec|time)$/.test(w[g - 1] ?? ''))) continue
    let verzeichnis = cd
    let i = g + 1
    while (i < w.length && w[i]!.startsWith('-')) {
      const opt = w[i]!
      if (opt === '-C') verzeichnis = w[i + 1]
      i += MIT_WERT.has(opt) ? 2 : 1
    }
    if (w[i] !== 'push') continue
    const remote = w.slice(i + 1).find(x => !x.startsWith('-'))
    liste.push({ ...(verzeichnis !== undefined ? { verzeichnis } : {}), ...(remote !== undefined ? { remote } : {}) })
  }
  return liste
}

/** Der Host einer Remote-URL (https://host/…, git@host:…, ssh://user@host/…); leer: keiner. */
export function host(url: string): string {
  const m = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url) ?? /^(?:[^@/]+@)?([^/:]+):/.exec(url)
  return (m?.[1] ?? '').toLowerCase()
}

export const istOeffentlich = (url: string, hosts: string): boolean => {
  const h = host(url)
  return h !== '' && hosts.split(',').map(x => x.trim().toLowerCase()).some(x => x !== '' && (h === x || h.endsWith(`.${x}`)))
}

/** Typische Zugangsdaten; die Treffer werden in der Frage gekürzt. */
const GEHEIMNISSE: [string, RegExp][] = [
  ['Anthropic-Schlüssel', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-Schlüssel', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ['GitHub-Token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['AWS-Schlüssel', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack-Token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['privater Schlüssel', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['Passwort im Klartext', /\b(?:password|passwort|passwd|secret|api[_-]?key|token)\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i],
]

const kuerzen = (s: string): string => (s.length > 10 ? `${s.slice(0, 6)}…` : s)

/** Eine hinzugefügte Zeile eines Diffs. */
export type Zeile = { datei: string; nr: number; text: string; commit: string }

/** Liest die hinzugefügten Zeilen aus `git log -p --format=commit %H --unified=0`. */
export function hinzugefuegt(diff: string): Zeile[] {
  const liste: Zeile[] = []
  let commit = ''
  let datei = ''
  let nr = 0
  for (const z of diff.split('\n')) {
    if (z.startsWith('commit ')) commit = z.slice(7, 14)
    else if (z.startsWith('+++ ')) datei = z === '+++ /dev/null' ? '' : z.replace(/^\+\+\+ (b\/)?/, '')
    else if (z.startsWith('@@')) nr = Number(/\+(\d+)/.exec(z)?.[1] ?? 0)
    else if (z.startsWith('+') && datei !== '') liste.push({ datei, nr: nr++, text: z.slice(1), commit })
    else if (z.startsWith(' ')) nr++
  }
  return liste
}

/** Durchsucht die neuen Zeilen nach Mustern und Geheimnissen; je Datei und Treffer nur einmal. */
export function inhaltPruefen(zeilen: readonly Zeile[], muster: string): Fund[] {
  let eigene: RegExp | null = null
  try {
    eigene = muster.trim() === '' ? null : new RegExp(muster, 'i')
  } catch {
    eigene = null
  }
  const funde: Fund[] = []
  const schon = new Set<string>()
  const dazu = (f: Fund, schluessel: string) => {
    if (schon.has(schluessel)) return
    schon.add(schluessel)
    funde.push(f)
  }
  for (const z of zeilen) {
    const wo = `${z.datei}:${z.nr} (${z.commit})`
    const m = eigene?.exec(z.text)
    if (m) dazu({ art: 'muster', wo, was: `„${m[0]}“` }, `m:${z.datei}:${m[0].toLowerCase()}`)
    for (const [name, re] of GEHEIMNISSE) {
      const g = re.exec(z.text)
      if (g) dazu({ art: 'geheimnis', wo, was: `${name} ${kuerzen(g[0])}` }, `g:${z.datei}:${g[0]}`)
    }
  }
  return funde
}

/** Prüft Autor- und Committer-Mail je Commit (Zeilen „hash<TAB>autor<TAB>committer“). */
export function mailsPruefen(log: string, erlaubt: string): Fund[] {
  if (erlaubt.trim() === '') return []
  let re: RegExp
  try {
    re = new RegExp(erlaubt, 'i')
  } catch {
    return []
  }
  const funde: Fund[] = []
  for (const z of log.split('\n')) {
    const [hash, autor, committer] = z.split('\t')
    if (hash === undefined || hash === '' || autor === undefined) continue
    const falsch = [...new Set([autor, committer ?? autor])].filter(m => !re.test(m))
    for (const m of falsch) funde.push({ art: 'mail', wo: `Commit ${hash.slice(0, 7)}`, was: m === autor ? `Autor ${m}` : `Committer ${m}` })
  }
  return funde
}

const ART: Record<Fund['art'], string> = { muster: 'Muster', mail: 'Mail', geheimnis: 'Geheimnis' }

const liste = (funde: readonly Fund[]): string => {
  const zeilen = funde.slice(0, MAX_FUNDE).map(f => `- ${f.wo}: ${f.was} (${ART[f.art]})`)
  if (funde.length > MAX_FUNDE) zeilen.push(`- … und ${funde.length - MAX_FUNDE} weitere`)
  return zeilen.join('\n')
}

/** Die Frage an den Nutzer. */
export function frage(ziel: string, funde: readonly Fund[]): string {
  return `Push nach ${ziel}: ${funde.length === 1 ? '1 Fund' : `${funde.length} Funde`} in den neuen Commits\n${liste(funde)}\n\nTrotzdem pushen?`
}

export const ABBRECHEN = 'Abbrechen'
export const TROTZDEM = 'Trotzdem pushen'

/** Was Claude liest, wenn der Push abgelehnt ist. */
export function ablehnung(ziel: string, funde: readonly Fund[], antwort: string): string {
  const nutzer = antwort !== ABBRECHEN && antwort !== '' ? `\nDer Nutzer schreibt dazu: ${antwort}` : ''
  return `push-wache: Push nach ${ziel} abgebrochen – der Nutzer hat die Funde gesehen und nicht freigegeben.\n${liste(funde)}${nutzer}\n` +
    'Echte Funde aus den Commits entfernen (bei schon gemachten Commits Historie umschreiben, z. B. amend/rebase, Mail per git -c user.email=…), dann neu pushen. Nicht ohne Änderung erneut versuchen.'
}
