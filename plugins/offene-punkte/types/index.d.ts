/** Eine Antwortmöglichkeit auf die Frage eines offenen Punkts. */
export type Option = {
  /** Kurz, steht in der Auswahl. */
  label: string
  /**
   * Was Claude als Antwort bekommt, wenn man sie wählt. Leer: die Option
   * erledigt den Punkt nur (z. B. "habe ich selbst gemacht").
   */
  antwort: string
}

export type Status = 'offen' | 'erledigt' | 'verworfen'

/** Entscheidung: der Nutzer wählt eine Antwort. Aufgabe: er muss selbst etwas tun (ausführen, liefern, prüfen). */
export type Art = 'entscheidung' | 'aufgabe'

/** Blockiert: ohne den Nutzer geht es nicht weiter. Angebot: "könnte ich auch noch …". */
export type Stufe = 'blockiert' | 'normal' | 'angebot'

/** Ein offener Punkt, wie Haiku ihn aus einer Antwort gelesen hat. */
export type Punkt = {
  id: string
  /** Wenige Worte, für Liste und Statuszeile. */
  titel: string
  /** Die Frage an den Nutzer, ein Satz. */
  frage: string
  /** Warum das offen ist, ein Satz (für /offen). */
  info: string
  art: Art
  /**
   * Bei Aufgaben: was genau zu tun ist, mit Befehlen, Pfaden und Schritten wörtlich
   * aus der Antwort (Markdown), damit niemand im Verlauf suchen muss. Sonst leer.
   */
  anleitung: string
  optionen: Option[]
  /** Fehlt bei Punkten aus älteren Fassungen: dann normal. */
  stufe?: Stufe
  /** Die Argumente aus der Antwort, die für die Entscheidung zählen – für den Verlauf. */
  abwaegung?: string
  /** So viele Auswertungen in Folge ohne Bezug auf den Punkt; ab VERALTET_NACH gilt er als veraltet. */
  ohneBezug?: number
  status: Status
  /** Später: rutscht in der Reihenfolge der Fragen nach hinten. */
  zurueckgestellt: number
  erstellt: number
  /** Gewählte Antwort oder wodurch erledigt. */
  ergebnis?: string
}

declare module 'claude-code' {
  interface PluginState {
    'offene-punkte': {
      punkte: Punkt[]
      /** Läuft gerade eine Auswertung? */
      prueft: boolean
      /** Fragen über der Eingabe für diese Sitzung ausgeblendet. */
      ausgeblendet: boolean
      /** Laufender Überblick über die Sitzung (Markdown), bei jeder Auswertung fortgeschrieben. */
      ueberblick: string
      /** Punkt, zu dem gerade eine eigene Antwort getippt wird (leer: keiner). */
      eigene: string
      /** So viele Antworten warten darauf, gesammelt an Claude zu gehen. */
      wartend: number
    }
  }
}
