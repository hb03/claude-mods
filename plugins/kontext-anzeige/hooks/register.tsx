import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { CacheStand, Kompaktierung, Messung, Modell, Ttl } from '../types'
import {
  CACHE_RELEVANT_AB,
  MIN,
  TRENNER,
  cacheRest,
  dauer,
  einpassen,
  hinweise,
  k,
  modellName,
  segmente,
  trefferquote,
  uhrzeit,
} from './logik'

const messungA = atom({ plugin: 'kontext-anzeige', key: 'messung' } as const, null)
const cacheA = atom({ plugin: 'kontext-anzeige', key: 'cache' } as const, null)
const verlaufA = atom({ plugin: 'kontext-anzeige', key: 'verlauf' } as const, [])
const jetztA = atom({ plugin: 'kontext-anzeige', key: 'jetzt' } as const, 0)
const arbeitetA = atom({ plugin: 'kontext-anzeige', key: 'arbeitet' } as const, false)
const modellA = atom({ plugin: 'kontext-anzeige', key: 'modell' } as const, null)
// Die aktuellen Hinweise; offene-punkte liest sie und zeigt die Warnungen über der Eingabe.
const warnungenA = atom({ plugin: 'kontext-anzeige', key: 'warnungen' } as const, [])

const TAKT_MS = 30_000

function ausUsage(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>, alt: Messung | null): Messung {
  return {
    tokens: u.context.tokens,
    window: u.context.window,
    percent: u.context.percent,
    usd: u.cost?.usd,
    limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    autoCompactAb: alt?.autoCompactAb,
  }
}

// Einstellungen, von register gesetzt.
let ttlEinstellung = 'auto'
let warnProzent = 60
let warnTokens = 0
let systemMeldung = false
// Bereits gezeigte Einblendungen; ein Schlüssel wird wieder frei, sobald sein Hinweis verschwindet.
const gezeigt = new Set<string>()
// Nach Compact, /clear oder Modellwechsel ist ein Cache-Fehlgriff erwartet und zählt nicht.
let fehlgriffErwartet = true
let takt: { cancel: () => void } | undefined
// Zuletzt gesetzte Statuszeile, damit sie nur bei Änderung neu geschrieben wird.
let letzterStatus: string | undefined
// Fernsteuerung (claude.ai, App): die Engine zählt sie nicht als Oberfläche, sie zeigt die Zeile aber nicht.
let fernsteuerung = false
// Probe von /kontext test: so lange steht der Probetext in der Statuszeile.
const PROBE_MS = 30_000
let probeBis = 0
// Datei, aus der die Statuszeile (~/.claude/statusline.sh) die Werte des Mods liest; gesetzt in session.start.
let statusDatei: string | undefined
let letzterDateiInhalt: string | undefined

async function pruefeHinweise($: EngineInterface) {
  const [m, c, arbeitet] = await Promise.all([read($, messungA), read($, cacheA), read($, arbeitetA)])
  const jetzt = await $.clock.now()
  const aktuell = hinweise(m, c, jetzt, arbeitet, warnProzent, warnTokens)
  const schluessel = new Set(aktuell.map(x => x.schluessel))
  for (const s of [...gezeigt]) if (!schluessel.has(s)) gezeigt.delete(s)
  for (const x of aktuell) {
    // Kalter Cache ist ein Zustand, kein Ereignis: steht in der Zeile, keine Einblendung.
    if (x.schluessel === 'cache-kalt' || gezeigt.has(x.schluessel)) continue
    gezeigt.add(x.schluessel)
    $.ui.toast(x.text, { timeoutMs: x.stufe === 'warn' ? 10_000 : 6000 })
    if (x.schluessel === 'cache-bald' && systemMeldung) {
      await $.ui.notify(x.text, { title: 'Claude: Cache' }).catch(() => undefined)
    }
  }
  const warnungen = arbeitet ? [] : aktuell.map(({ schluessel, stufe, text }) => ({ schluessel, stufe, text }))
  if (JSON.stringify(warnungen) !== JSON.stringify(await read($, warnungenA))) await update($, warnungenA, () => warnungen)
  if (jetzt >= probeBis) await spiegeleStatus($, m, c, jetzt, arbeitet, aktuell, await read($, modellA))
  await schreibeStatusDatei($, m, c, arbeitet, aktuell)
}

// Für die Statuszeile unter der Eingabe: nur was Claude Code ihr nicht selbst mitgibt.
async function schreibeStatusDatei(
  $: EngineInterface,
  m: Messung | null,
  c: CacheStand | null,
  arbeitet: boolean,
  aktuell: ReturnType<typeof hinweise>,
) {
  if (!statusDatei) return
  const warm = c && c.letzteAntwortAm > 0
  const erster = arbeitet ? undefined : aktuell[0]
  const inhalt = JSON.stringify({
    cache: warm
      ? { letzteAntwortAm: Math.round(c.letzteAntwortAm / 1000), ttlSek: c.ttl === '1h' ? 3600 : 300, treffer: trefferquote(c) ?? null, fehlgriffe: c.fehlgriffe }
      : null,
    autoCompactAb: m?.autoCompactAb ?? null,
    arbeitet,
    hinweis: erster ? { stufe: erster.stufe, text: erster.text } : null,
  })
  if (inhalt === letzterDateiInhalt) return
  letzterDateiInhalt = inhalt
  await $.fs.write(statusDatei, inhalt + '\n').catch(() => undefined)

}

// Die Zeile über der Eingabe zeichnen nur Terminal und Desktop. Hängt eine andere Oberfläche an
// (Handy, VS Code), steht die Kurzfassung zusätzlich in der Statuszeile.
async function spiegeleStatus(
  $: EngineInterface,
  m: Messung | null,
  c: CacheStand | null,
  jetzt: number,
  arbeitet: boolean,
  aktuell: ReturnType<typeof hinweise>,
  modell: Modell | null,
) {
  const flaechen = await $.session.surfaces()
  const ohneZeile = fernsteuerung || flaechen.some(f => f !== 'terminal' && f !== 'desktop')
  let text: string | undefined
  if (ohneZeile && m && m.tokens !== undefined) {
    const teile = einpassen(segmente(m, c && c.letzteAntwortAm > 0 ? c : null, jetzt, arbeitet, warnProzent, modell, warnTokens), 110)
    text = teile.map(x => x.text).join(TRENNER)
    const erster = arbeitet ? undefined : aktuell[0]
    if (erster) text += `\n→ ${erster.text}`
  }
  if (text === letzterStatus) return
  letzterStatus = text
  $.ui.status(text)
}

/**
 * /kontext test: je eine Einblendung, Statuszeile und Systemmeldung zur Probe - zeigt, was auf
 * der gerade verbundenen Oberfläche (Handy, Fernsteuerung, VS Code) ankommt.
 */
async function probe($: EngineInterface): Promise<string> {
  const flaechen = await $.session.surfaces()
  const jetzt = await $.clock.now()
  probeBis = jetzt + PROBE_MS
  $.ui.toast('Probe 1/3: Einblendung von kontext-anzeige', { timeoutMs: 15_000 })
  letzterStatus = 'Probe 2/3: Statuszeile von kontext-anzeige'
  $.ui.status(letzterStatus)
  const meldung = await $.ui.notify('Probe 3/3: Systemmeldung von kontext-anzeige', { title: 'Claude: Probe' })
    .then(() => 'abgeschickt', fehler => `nicht möglich (${String(fehler)})`)
  // Danach wieder die echte Statuszeile.
  $.clock.after(PROBE_MS, () => {
    probeBis = 0
    letzterStatus = undefined
    void pruefeHinweise($).catch(() => undefined)
  })

  return [
    '## Probe',
    `Oberflächen: ${flaechen.join(', ') || 'keine'}${fernsteuerung ? ', Fernsteuerung' : ''}`,
    '',
    'Gerade verschickt – bitte auf jeder Oberfläche nachsehen, was davon ankommt:',
    '1. Einblendung (Toast) „Probe 1/3“, 15 s lang',
    '2. Statuszeile „Probe 2/3“, 30 s lang, danach wieder die normale Zeile',
    `3. Systemmeldung „Probe 3/3“ – ${meldung}`,
  ].join('\n')
}

async function messen($: EngineInterface, mitAufschluesselung: boolean) {
  const u = await $.session.usage(mitAufschluesselung ? { breakdown: 'summary' } : undefined)
  const b = u.context.breakdown
  await update($, messungA, alt => ({
    ...ausUsage(u, alt),
    autoCompactAb: b ? (b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined) : alt?.autoCompactAb,
  }))
}

export const register: Register = (on, options) => {
  ttlEinstellung = String(options.cacheTtl ?? 'auto')
  warnProzent = Number(options.warnProzent ?? 60)
  warnTokens = Number(options.warnTokens ?? 0)
  systemMeldung = options.systemMeldung === true
  probeBis = 0
  letzterDateiInhalt = undefined
  gezeigt.clear()
  fehlgriffErwartet = true
  letzterStatus = undefined

  on('session.start', async ($, e, next) => {
    fernsteuerung = (await $.env.get('CLAUDE_CODE_BRIDGE_SESSION_ID')) !== undefined
    // Windows kennt HOME oft nicht; Git-Bash sieht USERPROFILE als $HOME, also landet die Datei am selben Ort.
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    statusDatei = home ? `${home}/.claude/kontext-anzeige/${await $.session.id()}.json` : undefined
    await $.command.register({
      name: 'kontext',
      description: 'Kontext, Prompt-Cache, Compact-Verlauf und Limits im Detail',
    })
    await update($, jetztA, () => Date.now())
    takt?.cancel()
    takt = $.clock.every(TAKT_MS, async () => {
      await update($, jetztA, () => Date.now())
      await pruefeHinweise($)
    })
    await messen($, true).catch(() => undefined)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, messungA, alt => ausUsage(e, alt))
    const r = await next(e)
    if (e.changed.includes('context') || e.changed.includes('rateLimits')) await pruefeHinweise($)
    return r
  })

  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    await pruefeHinweise($)
    return r
  })

  on('session.detach', async ($, e, next) => {
    const r = await next(e)
    await pruefeHinweise($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    await update($, arbeitetA, () => true)
    await pruefeHinweise($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId !== undefined || !r.usage) return r
    const modell: Modell = { id: r.usage.model || e.model, effort: e.effort === undefined ? undefined : String(e.effort) }
    await update($, modellA, alt => (alt && alt.id === modell.id && alt.effort === modell.effort ? alt : modell))
    const u = r.usage
    const jetzt = await $.clock.now()
    const gesamt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    const alt = await read($, cacheA)
    const luecke = alt ? jetzt - alt.letzteAntwortAm : 0

    // Ohne Erkennung gilt: Abo (Limits gemeldet) 1 Stunde, Abrechnung per API 5 Minuten.
    const abo = ((await read($, messungA))?.limits.length ?? 0) > 0
    const vermutet: Ttl = abo ? '1h' : '5m'
    let ttl: Ttl =
      ttlEinstellung === '1h' || ttlEinstellung === '5m'
        ? ttlEinstellung
        : alt?.ttlQuelle === 'erkannt'
          ? alt.ttl
          : vermutet
    let ttlQuelle: CacheStand['ttlQuelle'] =
      ttlEinstellung === 'auto' ? (alt?.ttlQuelle === 'erkannt' ? 'erkannt' : 'vermutet') : 'einstellung'
    let fehlgriff = false
    if (alt && gesamt >= CACHE_RELEVANT_AB) {
      const gelesenAnteil = u.cache_read_input_tokens / gesamt
      // Treffer nach mehr als 5 Minuten Pause: der Cache lebt eine Stunde.
      if (ttlQuelle !== 'einstellung' && luecke > 5.5 * MIN && gelesenAnteil > 0.5) {
        ttl = '1h'
        ttlQuelle = 'erkannt'
      }
      // Fehlgriff nach 5-60 Minuten Pause, ohne erwarteten Grund: der Cache lebt nur 5 Minuten.
      if (ttlQuelle !== 'einstellung' && !fehlgriffErwartet && luecke > 5.5 * MIN && luecke < 60 * MIN && gelesenAnteil < 0.1) {
        ttl = '5m'
        ttlQuelle = 'erkannt'
      }
      const sollteWarmSein = luecke < (ttl === '1h' ? 60 : 5) * MIN
      fehlgriff = sollteWarmSein && !fehlgriffErwartet && gelesenAnteil < 0.5
    }
    fehlgriffErwartet = false

    await update($, cacheA, () => ({
      letzteAntwortAm: jetzt,
      gelesen: u.cache_read_input_tokens,
      geschrieben: u.cache_creation_input_tokens,
      ungecacht: u.input_tokens,
      summeGelesen: (alt?.summeGelesen ?? 0) + u.cache_read_input_tokens,
      summeGesamt: (alt?.summeGesamt ?? 0) + gesamt,
      fehlgriffe: (alt?.fehlgriffe ?? 0) + (fehlgriff ? 1 : 0),
      ttl,
      ttlQuelle,
    }))
    if (fehlgriff) {
      $.ui.log(`kontext-anzeige: Cache verfehlt – ${k(u.cache_creation_input_tokens)} neu geschrieben, obwohl er warm sein sollte`)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      await update($, arbeitetA, () => false)
      await update($, jetztA, () => Date.now())
      await messen($, true).catch(() => undefined)
      await pruefeHinweise($)
    }
    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || r.skip !== undefined) return r
    fehlgriffErwartet = true
    const eintrag: Kompaktierung = {
      am: await $.clock.now(),
      ausloeser: e.trigger,
      vorher: r.tokensBefore,
      nachher: r.tokensAfter,
    }
    await update($, verlaufA, v => [...v, eintrag].slice(-20))
    const wie = e.trigger === 'auto' ? 'automatisch' : e.trigger === 'manual' ? 'per /compact' : 'durch Plugin'
    const zahlen = r.tokensBefore !== undefined && r.tokensAfter !== undefined ? `: ${k(r.tokensBefore)} → ${k(r.tokensAfter)}` : ''
    $.ui.toast(`Kontext ${wie} verdichtet${zahlen}`, { timeoutMs: 8000 })
    return r
   }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      fehlgriffErwartet = true
      gezeigt.clear()
      await update($, cacheA, alt => (alt ? { ...alt, summeGelesen: 0, summeGesamt: 0, fehlgriffe: 0, letzteAntwortAm: 0 } : null))
      await update($, verlaufA, () => [])
      await update($, messungA, alt => (alt ? { ...alt, tokens: undefined, percent: undefined } : null))
    }
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    fehlgriffErwartet = true
    if (ttlEinstellung === 'auto' && (e.cache_ttl === '1h' || e.cache_ttl === '5m')) {
      await update($, cacheA, alt => (alt ? { ...alt, ttl: e.cache_ttl, ttlQuelle: 'erkannt' as const } : null))
    }
    if (e.prompt_cache_warm && e.context_tokens >= CACHE_RELEVANT_AB) {
      $.ui.toast(
        `Modellwechsel: ${k(e.context_tokens)} werden neu gecacht (≈ $${e.estimated_cache_write_usd.toFixed(2)})`,
        { timeoutMs: 8000 },
      )
    }
    return next(e)
   }).catch(($, e, next) => next(e))

  on('command.run', { command: 'kontext' }, async ($, e) => {
    if (e.args.trim() === 'test') return { text: await probe($) }
    const u = await $.session.usage({ breakdown: 'summary' })
    const [c, verlauf] = await Promise.all([read($, cacheA), read($, verlaufA)])
    const m = await read($, messungA)
    const jetzt = await $.clock.now()
    const z: string[] = []
    const b = u.context.breakdown

    const modell = await read($, modellA)
    if (modell) z.push(`Modell: ${modellName(modell.id)}${modell.effort ? `, Aufwand ${modell.effort}` : ''} (${modell.id})`, '')
    z.push('## Kontext')
    z.push(
      u.context.tokens !== undefined
        ? `${k(u.context.tokens)} von ${k(u.context.window)} Tokens (${u.context.percent ?? 0} %)`
        : 'Noch keine Antwort in diesem Kontextfenster.',
    )
    if (b) {
      z.push(
        b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined
          ? `Auto-Compact bei ${k(b.autoCompactThreshold)}`
          : 'Auto-Compact ist aus',
      )
      const zeilen = b.categories.filter(x => x.kind === 'used' && x.tokens > 0).sort((a, c2) => c2.tokens - a.tokens)
      if (zeilen.length) {
        z.push('', '| Bereich | Tokens |', '|---|---:|')
        for (const x of zeilen) z.push(`| ${x.name} | ${k(x.tokens)} |`)
      }
    }

    z.push('', '## Prompt-Cache')
    if (!c || c.letzteAntwortAm === 0) {
      z.push('Noch keine Antwort gemessen.')
    } else {
      const rest = cacheRest(c, jetzt)
      const herkunft = { einstellung: 'eingestellt', erkannt: 'erkannt', vermutet: 'vermutet' }[c.ttlQuelle]
      z.push(`Lebensdauer ${c.ttl === '1h' ? '1 Stunde' : '5 Minuten'} (${herkunft})`)
      z.push(rest > 0 ? `warm, noch ${dauer(rest)}` : `kalt seit ${dauer(-rest)}`)
      z.push(`Letzte Anfrage: ${k(c.gelesen)} gelesen, ${k(c.geschrieben)} neu geschrieben, ${k(c.ungecacht)} ungecacht`)
      const q = trefferquote(c)
      if (q !== undefined) z.push(`Trefferquote der Sitzung: ${q} %`)
      if (c.fehlgriffe > 0) z.push(`Unerwartete Fehlgriffe: ${c.fehlgriffe}`)
    }

    if (verlauf.length) {
      z.push('', '## Verdichtungen')
      for (const v of verlauf) {
        const d = new Date(v.am)
        const zeit = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        const zahlen = v.vorher !== undefined && v.nachher !== undefined ? ` ${k(v.vorher)} → ${k(v.nachher)}` : ''
        z.push(`- ${zeit} ${v.ausloeser}${zahlen}`)
      }
    }

    if (u.rateLimits.length || u.cost) {
      z.push('', '## Verbrauch')
      if (u.cost) z.push(`Sitzung bisher: $${u.cost.usd.toFixed(2)}`)
      for (const l of u.rateLimits) {
        const um = uhrzeit(l.resetsAt)
        z.push(`${l.kind}: ${l.percentUsed} %${um ? `, frei ab ${um}` : ''}`)
      }
    }

    const arbeitet = await read($, arbeitetA)
    const tipps = hinweise(m ? { ...m, ...ausUsage(u, m) } : ausUsage(u, null), c, jetzt, arbeitet, warnProzent, warnTokens)
    const flaechen = await $.session.surfaces()
    const ohneZeile = fernsteuerung || flaechen.some(f => f !== 'terminal' && f !== 'desktop')
    z.push('', `Oberflächen: ${flaechen.join(', ') || 'keine'}${fernsteuerung ? ', Fernsteuerung' : ''}${ohneZeile ? ' – Kurzfassung steht zusätzlich in der Statuszeile' : ''}`)
    z.push('', '## Empfehlung')
    z.push(tipps.length ? tipps.map(x => `- ${x.text}`).join('\n') : 'Nichts zu tun – weiterarbeiten.')
    return { text: z.join('\n') }
  })
}
