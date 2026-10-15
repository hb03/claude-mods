import { describe, expect, test } from 'claude-code/testing'

import type { CacheStand, Messung } from '../types'
import { MIN, einpassen, feinbalken, hinweise, k, modellName, segmente, tokenWert } from '../hooks/logik'

describe('Token-Schwelle per Befehl', () => {
  test('versteht übliche Schreibweisen', async () => {
    expect(tokenWert('200k')).toBe(200_000)
    expect(tokenWert('1,5m')).toBe(1_500_000)
    expect(tokenWert('350000')).toBe(350_000)
    expect(tokenWert('200.000')).toBe(200_000)
    expect(tokenWert('aus')).toBe(0)
  })

  test('lehnt Unsinn und Werte außerhalb 10k bis 2m ab', async () => {
    expect(tokenWert('viel')).toBeNull()
    expect(tokenWert('5k')).toBeNull()
    expect(tokenWert('3m')).toBeNull()
    expect(tokenWert('200.5')).toBeNull()
  })
})

const JETZT = 1_800_000_000_000

const messung = (percent: number, extra: Partial<Messung> = {}): Messung => ({
  tokens: percent * 2000,
  window: 200_000,
  percent,
  limits: [],
  ...extra,
})

const cache = (vorMs: number, ttl: '5m' | '1h' = '1h'): CacheStand => ({
  letzteAntwortAm: JETZT - vorMs,
  gelesen: 90_000,
  geschrieben: 2000,
  ungecacht: 10,
  summeGelesen: 900,
  summeGesamt: 1000,
  fehlgriffe: 0,
  ttl,
  ttlQuelle: 'erkannt',
})

const schluessel = (m: Messung | null, c: CacheStand | null, arbeitet = false) =>
  hinweise(m, c, JETZT, arbeitet, 60).map(h => h.schluessel)

describe('Hinweise', () => {
  test('ruhig bei wenig Kontext und warmem Cache', async () => {
    expect(schluessel(messung(30), cache(10 * MIN))).toEqual([])
  })

  test('schlägt ab der Schwelle /compact vor, kurz vor Auto-Compact dringend', async () => {
    expect(schluessel(messung(65), cache(MIN))).toEqual(['kontext-warn'])
    expect(schluessel(messung(92), cache(MIN))).toEqual(['kontext-kritisch'])
    expect(schluessel(messung(70, { autoCompactAb: 150_000 }), cache(MIN))).toEqual(['kontext-kritisch'])
  })

  test('warnt zusätzlich ab einer Token-Schwelle', async () => {
    const gross = messung(25, { tokens: 250_000, window: 1_000_000 })
    expect(hinweise(gross, cache(MIN), JETZT, false, 60).map(h => h.schluessel)).toEqual([])
    const h = hinweise(gross, cache(MIN), JETZT, false, 60, 200_000)
    expect(h.map(x => x.schluessel)).toEqual(['kontext-warn'])
    expect(h[0]?.text).toContain('250k')
    expect(hinweise(messung(25, { tokens: 150_000, window: 1_000_000 }), cache(MIN), JETZT, false, 60, 200_000)).toEqual([])
  })

  test('warnt kurz vor Cache-Ablauf, nicht während Claude arbeitet', async () => {
    expect(schluessel(messung(30), cache(56 * MIN))).toEqual(['cache-bald'])
    expect(schluessel(messung(30), cache(56 * MIN), true)).toEqual([])
    expect(schluessel(messung(30), cache(4.5 * MIN, '5m'))).toEqual(['cache-bald'])
  })

  test('meldet kalten Cache nur bei nennenswertem Kontext', async () => {
    expect(schluessel(messung(30), cache(61 * MIN))).toEqual(['cache-kalt'])
    expect(schluessel(messung(5), cache(61 * MIN))).toEqual([])
  })

  test('warnt beim 5-h-Limit ab 80 %', async () => {
    const m = messung(10, { limits: [{ kind: 'five_hour', percentUsed: 85 }] })
    expect(schluessel(m, null)).toEqual(['limit-five_hour'])
    expect(schluessel(messung(10, { limits: [{ kind: 'five_hour', percentUsed: 50 }] }), null)).toEqual([])
  })
})

describe('Zeile', () => {
  test('zeigt Modell, Kontext, Cache-Restzeit, Limits und Kosten', async () => {
    const m = messung(42, {
      usd: 3.5,
      autoCompactAb: 160_000,
      limits: [
        { kind: 'five_hour', percentUsed: 23 },
        { kind: 'seven_day', percentUsed: 61 },
      ],
    })
    const s = segmente(m, cache(12 * MIN), JETZT, false, 60, { id: 'claude-opus-5-5', effort: 'high' })
    const text = s.map(x => x.text).join(' │ ')
    expect(text).toContain('◆ Opus 5.5 high')
    expect(text).toContain('42 %')
    expect(text).toContain('Cache ● 48 min')
    expect(text).toContain('Compact in 76k')
    expect(text).toContain('5h ▰▱▱▱▱ 23 %')
    expect(text).toContain('Woche ▰▰▰▱▱ 61 %')
    expect(text).toContain('Cache-Treffer 90 %')
    expect(text).toContain('$3.50')
  })

  test('ohne Modell und Limits fehlen diese Teile', async () => {
    const text = segmente(messung(42), cache(MIN), JETZT, false, 60).map(x => x.text).join(' │ ')
    expect(text).not.toContain('◆')
    expect(text).not.toContain('Woche')
    expect(text).not.toContain('5h')
  })

  test('ohne Messwert steht „Kontext –“ statt 0 %', async () => {
    const m = messung(42, { autoCompactAb: 160_000 })
    const text = segmente({ ...m, percent: undefined, tokens: undefined }, cache(MIN), JETZT, false, 60).map(x => x.text).join(' │ ')
    expect(text).toContain('Kontext –')
    expect(text).not.toMatch(/Kontext[^│]*\d+ %/)
    expect(text).not.toContain('░')
    expect(text).not.toContain('Compact')
  })

  test('Modellnamen und Feinbalken', async () => {
    expect(modellName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modellName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
    expect(modellName('claude-sonnet-5-5-20260101')).toBe('Sonnet 5.5')
    expect(modellName('irgendwas')).toBe('irgendwas')
    const b = feinbalken(50, 12)
    expect(b.voll).toBe('██████')
    expect((b.voll + b.rest).length).toBe(12)
    expect(feinbalken(4, 12).voll).toBe('▌')
    expect(feinbalken(0, 12).voll).toBe('')
    expect(feinbalken(100, 12).rest).toBe('')
  })

  test('lässt bei schmalem Terminal Nebensachen weg, Kontext bleibt', async () => {
    const s = segmente(messung(42, { usd: 3.5, autoCompactAb: 160_000 }), cache(MIN), JETZT, false, 60)
    const eng = einpassen(s, 30)
    expect(eng.length).toBeGreaterThan(0)
    expect(eng[0]?.text).toContain('Kontext')
    expect(eng.map(x => x.text).join(' · ').length).toBeLessThanOrEqual(30)
  })

  test('kürzt Tokenzahlen', async () => {
    expect(k(950)).toBe('950')
    expect(k(4200)).toBe('4,2k')
    expect(k(124_400)).toBe('124k')
  })
})
