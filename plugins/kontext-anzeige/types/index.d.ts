export type Ttl = '5m' | '1h'

export type Messung = {
  tokens?: number
  window: number
  percent?: number
  usd?: number
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  autoCompactAb?: number
}

export type CacheStand = {
  letzteAntwortAm: number
  gelesen: number
  geschrieben: number
  ungecacht: number
  summeGelesen: number
  summeGesamt: number
  fehlgriffe: number
  ttl: Ttl
  ttlQuelle: 'einstellung' | 'erkannt' | 'vermutet'
}

export type Modell = { id: string; effort?: string }

export type Kompaktierung = { am: number; ausloeser: string; vorher?: number; nachher?: number }

declare module 'claude-code' {
  interface PluginState {
    'kontext-anzeige': {
      messung: Messung | null
      cache: CacheStand | null
      verlauf: Kompaktierung[]
      jetzt: number
      arbeitet: boolean
      modell: Modell | null
      /** Die aktuellen Hinweise (leer, solange Claude arbeitet); offene-punkte zeigt die Warnungen. */
      warnungen: { schluessel: string; stufe: 'info' | 'warn'; text: string }[]
    }
  }
}
