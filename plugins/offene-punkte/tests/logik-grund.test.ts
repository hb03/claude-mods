// Reine Funktionen aus hooks/logik/grund.ts: Grundwerte, Version, Maschinen-Eingaben
import { describe, expect, test } from 'claude-code/testing'

import { istMaschinenEingabe } from '../hooks/logik'

describe('istMaschinenEingabe', () => {
  test('Klärung und Cache-Hinweis sind Maschinen-Eingaben', () => {
    expect(istMaschinenEingabe('Automatische Klärung: Punkte #1 und #2 durchgehen')).toBe(true)
    expect(istMaschinenEingabe('Automatische Klaerung der offenen Punkte')).toBe(true)
    expect(istMaschinenEingabe('Vor Ablauf des Caches: bitte kurz antworten')).toBe(true)
    expect(istMaschinenEingabe('  automatische klärung der offenen punkte')).toBe(true)
  })

  test('normale Nachrichten nicht', () => {
    expect(istMaschinenEingabe('weiter')).toBe(false)
    expect(istMaschinenEingabe('')).toBe(false)
    expect(istMaschinenEingabe('Zum offenen Punkt „Freigabe Push“: Ja')).toBe(false)
    expect(istMaschinenEingabe('Bitte mach eine Automatische Klärung der Punkte')).toBe(false)
    expect(istMaschinenEingabe('Klärung der offenen Punkte')).toBe(false)
    expect(istMaschinenEingabe('Vor dem Ablauf des Caches')).toBe(false)
  })
})
