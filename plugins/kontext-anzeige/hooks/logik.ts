import type { CacheStand, Messung, Modell, Ttl } from '../types'

export type Hinweis = { schluessel: string; stufe: 'info' | 'warn'; text: string }

export const MIN = 60_000

export const ttlMs = (ttl: Ttl) => (ttl === '1h' ? 60 * MIN : 5 * MIN)

// Unterhalb dieser Größe lohnt kein Hinweis zum Cache: Neuschreiben kostet kaum etwas.
export const CACHE_RELEVANT_AB = 20_000

export function k(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1).replace('.', ',') + 'k'
  return Math.round(n / 1000) + 'k'
}

/** "200k", "1,5m", "200.000", "aus" → Tokens (0 = aus); null, wenn es keine sinnvolle Schwelle ist. */
export function tokenWert(eingabe: string): number | null {
  const s = eingabe.trim().toLowerCase().replace(/\s+/g, '')
  if (s === 'aus' || s === '0') return 0
  const mitEinheit = /^(\d+(?:[.,]\d+)?)(k|m)$/.exec(s)
  const n = mitEinheit
    ? Number(mitEinheit[1]!.replace(',', '.')) * (mitEinheit[2] === 'm' ? 1_000_000 : 1000)
    : /^\d{1,3}(?:[._]?\d{3})*$/.test(s) ? Number(s.replace(/[._]/g, '')) : NaN
  if (!Number.isFinite(n)) return null
  const gerundet = Math.round(n)
  return gerundet >= 10_000 && gerundet <= 2_000_000 ? gerundet : null
}

export function dauer(ms: number): string {
  if (ms < MIN) return Math.max(0, Math.round(ms / 1000)) + ' s'
  return Math.round(ms / MIN) + ' min'
}

export function uhrzeit(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Restlaufzeit des Prompt-Caches in ms; negativ, wenn er abgelaufen ist. */
export function cacheRest(c: CacheStand, jetzt: number): number {
  return c.letzteAntwortAm + ttlMs(c.ttl) - jetzt
}

/** Ab wann vor dem Ablauf gewarnt wird. */
export function vorwarnzeit(ttl: Ttl): number {
  return ttl === '1h' ? 5 * MIN : MIN
}

export function trefferquote(c: CacheStand): number | undefined {
  return c.summeGesamt > 0 ? Math.round((100 * c.summeGelesen) / c.summeGesamt) : undefined
}

export function stufeFarbe(prozent: number, warn: number, ueberTokens = false): 'success' | 'warning' | 'error' {
  if (prozent >= 85) return 'error'
  if (prozent >= warn || ueberTokens) return 'warning'
  return 'success'
}

/** Was gerade sinnvoll ist, das Dringendste zuerst. */
export function hinweise(
  m: Messung | null,
  c: CacheStand | null,
  jetzt: number,
  arbeitet: boolean,
  warnProzent: number,
  // Absolute Schwelle, 0 = aus; bei großem Kontextfenster greift sie lange vor der Prozentschwelle.
  warnTokens = 0,
): Hinweis[] {
  const liste: Hinweis[] = []
  const tokens = m?.tokens ?? 0

  if (m && m.percent !== undefined) {
    const nahAuto = m.autoCompactAb !== undefined && tokens >= m.autoCompactAb * 0.9
    if (m.percent >= 90 || nahAuto) {
      liste.push({
        schluessel: 'kontext-kritisch',
        stufe: 'warn',
        text: 'Auto-Compact steht bevor – besser jetzt selbst /compact mit Fokus, z. B. „/compact behalte den Plan und offene Punkte“',
      })
    } else if (m.percent >= warnProzent || (warnTokens > 0 && tokens >= warnTokens)) {
      liste.push({
        schluessel: 'kontext-warn',
        stufe: 'info',
        text: `Kontext ${m.percent >= warnProzent ? `${m.percent} %` : k(tokens)} – nach Abschluss der Aufgabe /compact, bei neuem Thema /clear`,
      })
    }
  }

  if (c && !arbeitet && tokens >= CACHE_RELEVANT_AB) {
    const rest = cacheRest(c, jetzt)
    if (rest <= 0) {
      liste.push({
        schluessel: 'cache-kalt',
        stufe: 'info',
        text: `Cache abgelaufen – die nächste Nachricht schreibt ${k(tokens)} neu; bei neuem Thema lieber /clear`,
      })
    } else if (rest <= vorwarnzeit(c.ttl)) {
      liste.push({
        schluessel: 'cache-bald',
        stufe: 'warn',
        text: `Cache läuft in ${dauer(rest)} ab – jetzt weitermachen spart das Neuschreiben von ${k(tokens)}`,
      })
    }
  }

  for (const l of m?.limits ?? []) {
    const grenze = l.kind === 'five_hour' ? 80 : 90
    if (l.percentUsed >= grenze) {
      const name = l.kind === 'five_hour' ? '5-h-Limit' : l.kind === 'seven_day' ? 'Wochenlimit' : l.kind
      const um = uhrzeit(l.resetsAt)
      liste.push({
        schluessel: `limit-${l.kind}`,
        stufe: 'warn',
        text: `${name} ${Math.round(l.percentUsed)} % verbraucht${um ? ` – frei ab ${um}` : ''}; große Aufgaben lieber danach`,
      })
    }
  }

  return liste
}

export type Teil = { t: string; farbe?: string; dim?: boolean; bold?: boolean }
export type Segment = { teile: Teil[]; text: string; rang: number }

const seg = (rang: number, ...teile: Teil[]): Segment => ({ teile, text: teile.map(x => x.t).join(''), rang })

/** "claude-opus-5-5[1m]" → "Opus 5.5"; Unbekanntes bleibt, wie es ist. */
export function modellName(id: string): string {
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(id)
  if (!m || !m[1]) return id.replace(/^claude-/, '')
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

/** Balken mit Achtelschritten: 42 % auf 12 Zellen → "█████▏      ". */
export function feinbalken(prozent: number, breite = 12): { voll: string; rest: string } {
  const achtel = Math.max(0, Math.min(breite * 8, Math.round((prozent / 100) * breite * 8)))
  const ganz = Math.floor(achtel / 8)
  const teil = achtel % 8
  const voll = '█'.repeat(ganz) + (teil ? '▏▎▍▌▋▊▉'.charAt(teil - 1) : '')
  return { voll, rest: '░'.repeat(breite - voll.length) }
}

export function minibalken(prozent: number, breite = 5): { voll: string; rest: string } {
  const n = Math.max(0, Math.min(breite, Math.round((prozent / 100) * breite)))
  return { voll: '▰'.repeat(n), rest: '▱'.repeat(breite - n) }
}

function limitSegment(name: string, l: { percentUsed: number } | undefined, grenze: number): Segment | undefined {
  if (!l) return undefined
  const p = Math.round(l.percentUsed)
  const farbe = p >= grenze ? 'warning' : p >= 50 ? 'suggestion' : 'success'
  const b = minibalken(p)
  return seg(2, { t: `${name} `, dim: true }, { t: b.voll, farbe }, { t: b.rest, dim: true }, { t: ` ${p} %`, farbe: p >= grenze ? 'warning' : undefined })
}

/** Bausteine der Zeile; `rang` 0 bleibt immer, höhere fallen bei Platzmangel zuerst weg. */
export function segmente(
  m: Messung,
  c: CacheStand | null,
  jetzt: number,
  arbeitet: boolean,
  warnProzent: number,
  modell?: Modell | null,
  warnTokens = 0,
): Segment[] {
  const s: Segment[] = []
  const p = m.percent ?? 0
  const tokens = m.tokens ?? 0

  if (modell) {
    s.push(seg(1, { t: '◆ ', farbe: 'claude' }, { t: modellName(modell.id), bold: true }, ...(modell.effort ? [{ t: ` ${modell.effort}`, dim: true }] : [])))
  }

  // Ohne Messwert (neues Fenster, nach /clear) keinen Füllstand erfinden.
  const gemessen = m.percent !== undefined
  if (gemessen) {
    const farbe = stufeFarbe(p, warnProzent, warnTokens > 0 && tokens >= warnTokens)
    const b = feinbalken(p)
    const kontext: Teil[] = [{ t: 'Kontext ', dim: true }, { t: b.voll, farbe }, { t: b.rest, dim: true }, { t: ` ${p} %`, farbe, bold: true }]
    s.push(seg(0, ...kontext))
    s.push(seg(4, { t: `${k(tokens)}/${k(m.window)}`, dim: true }))
  } else {
    s.push(seg(0, { t: 'Kontext ', dim: true }, { t: '–', dim: true }))
  }
  if (gemessen && m.autoCompactAb !== undefined) {
    const bis = m.autoCompactAb - tokens
    const knapp = bis < m.autoCompactAb * 0.15
    s.push(seg(3, { t: '⇢ Compact ', dim: true }, bis > 0 ? { t: `in ${k(bis)}`, farbe: knapp ? 'warning' : undefined, dim: !knapp } : { t: 'fällig', farbe: 'error', bold: true }))
  }

  if (c) {
    const teile: Teil[] = [{ t: 'Cache ', dim: true }]
    if (arbeitet) {
      teile.push({ t: '● aktiv', farbe: 'success' })
    } else {
      const rest = cacheRest(c, jetzt)
      if (rest > 0) {
        const knapp = rest <= vorwarnzeit(c.ttl)
        teile.push({ t: '●', farbe: knapp ? 'warning' : 'success' }, { t: ` ${dauer(rest)}`, farbe: knapp ? 'warning' : undefined })
      } else {
        const wichtig = tokens >= CACHE_RELEVANT_AB
        teile.push({ t: '○ kalt', farbe: wichtig ? 'warning' : undefined, dim: !wichtig })
      }
    }
    s.push(seg(1, ...teile))
    const q = trefferquote(c)
    if (q !== undefined) {
      s.push(seg(5, { t: 'Cache-Treffer ', dim: true }, { t: `${q} %`, farbe: q < 80 ? 'warning' : undefined, dim: q >= 80 }))
    }
  }

  const fuenf = limitSegment('5h', m.limits.find(l => l.kind === 'five_hour'), 80)
  if (fuenf) s.push(fuenf)
  const woche = limitSegment('Woche', m.limits.find(l => l.kind === 'seven_day'), 90)
  if (woche) s.push(woche)
  if (m.usd !== undefined) s.push(seg(6, { t: `$${m.usd.toFixed(2)}`, dim: true }))
  return s
}

export const TRENNER = ' │ '

/** Lässt so viele Segmente weg (höchster Rang zuerst), bis die Zeile in `breite` passt. */
export function einpassen(s: Segment[], breite: number): Segment[] {
  let rest = [...s]
  const laenge = (l: Segment[]) => l.reduce((n, x) => n + x.text.length, 0) + TRENNER.length * Math.max(0, l.length - 1)
  while (laenge(rest) > breite && rest.some(x => x.rang > 0)) {
    const hoechster = Math.max(...rest.map(x => x.rang))
    const i = rest.map(x => x.rang).lastIndexOf(hoechster)
    rest = rest.filter((_, j) => j !== i)
  }
  return rest
}
