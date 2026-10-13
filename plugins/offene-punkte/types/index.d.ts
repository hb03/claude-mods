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

/**
 * Eine gewählte Antwort, die noch nicht bei Claude ist. Der Punkt bleibt so lange
 * offen (nur nicht mehr gefragt) und schließt sich erst, wenn die Nachricht raus ist.
 */
export type Ausstehend = {
  /** So schließt sich der Punkt, wenn die Antwort angekommen ist. */
  status: 'erledigt' | 'verworfen'
  /** Fürs Ergebnis; bei "eingabe" kommt, was der Nutzer ergänzt hat, dahinter. */
  ergebnis: string
  /** Was Claude bekommt. */
  text: string
  /** sammlung: geht gesammelt los; eingabe: steht in der Eingabe, geht mit der Nachricht des Nutzers. */
  wo: 'sammlung' | 'eingabe'
  /** Reihenfolge der Antworten. */
  reihe: number
}

/** Ein offener Punkt, wie Haiku ihn aus einer Antwort gelesen hat. */
export type Punkt = {
  id: string
  /**
   * Feste Nummer, je Projekt fortlaufend und nie wiederverwendet; bleibt auch nach dem
   * Schließen (Verlauf, Rückbezug). Fehlt bei älteren Fassungen.
   */
  nr?: number
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
  /** Mehrere Antworten passen zusammen (keine Entweder-oder-Wahl): die Oberflaeche bietet Kaestchen. */
  mehrfach?: boolean
  /** So viele Auswertungen in Folge ohne Bezug auf den Punkt; ab VERALTET_NACH gilt er als veraltet. */
  ohneBezug?: number
  status: Status
  /** Später: rutscht in der Reihenfolge der Fragen nach hinten. */
  zurueckgestellt: number
  erstellt: number
  /** Gewählte Antwort oder wodurch erledigt. */
  ergebnis?: string
  /** Beantwortet, aber noch nicht bei Claude. */
  ausstehend?: Ausstehend
  /**
   * Die Sitzung, die den Punkt führt. Punkte einer anderen Sitzung im selben Projekt
   * stehen in /offen, werden aber nicht gefragt. Fehlt bei älteren Fassungen: eigene.
   */
  sitzung?: string
  /** Wann der Punkt zuletzt geschlossen oder wieder geöffnet wurde (für den Abgleich zwischen Sitzungen). */
  geaendert?: number
  /** Wann der Startabgleich den Punkt zuletzt geprüft und offen gelassen hat (erst nach ABGLEICH_NACH_MS wieder). */
  geprueft?: number
  /** Zurückgelegt: wird bis dahin nicht gefragt (bis: Zeitpunkt; sitzung: bis zur nächsten Sitzung). */
  ruht?: Ruhe
  /** Vom Nutzer selbst angelegt (/offen neu): die Auswertung schließt, ändert und altert ihn nicht. */
  vonNutzer?: boolean
  /**
   * Ohne Zutun des Nutzers geschlossen (Auswertung oder „erledigt: #N“ von Claude): warum und wann.
   * /offen und claude-web zeigen solche Punkte eine Weile mit eigenem Zeichen und „wieder öffnen“.
   */
  auto?: { grund: string; zeit: number }
}

export type Ruhe = { bis?: number; sitzung?: string }

/** Eine Warnung, die kontext-anzeige in seinem State führt. */
export type Warnung = { schluessel: string; stufe: 'info' | 'warn'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'offene-punkte': {
      punkte: Punkt[]
      /** Höchste je vergebene Nummer im Projekt; neue Punkte zählen von hier weiter. */
      hoechsteNr: number
      /** Läuft gerade eine Auswertung? */
      prueft: boolean
      /** Fragen über der Eingabe für diese Sitzung ausgeblendet. */
      ausgeblendet: boolean
      /** Laufender Überblick über die Sitzung (Markdown), bei jeder Auswertung fortgeschrieben. */
      ueberblick: string
      /** Punkt, zu dem gerade eine eigene Antwort getippt wird (leer: keiner). */
      eigene: string
      /** Punkt, zu dem gerade gewählt wird, wie lange er zurückgelegt wird (leer: keiner). */
      spaeter: string
      /** Warnungen von kontext-anzeige, die der Nutzer ausgeblendet hat (Schlüssel). */
      warnungenAus: string[]
      /**
       * Alle Fragen beantwortet: Sekunden, bis die Antworten von selbst abgehen (0: kein
       * Countdown). Mit `inEingabe` stehen sie in der Eingabe, und Enter schickt sofort.
       */
      abschicken: { sekunden: number; inEingabe: boolean }
    }
    /** Gelesen, nicht geschrieben: die aktuellen Hinweise von kontext-anzeige (ab 0.4.0). */
    'kontext-anzeige': {
      warnungen: Warnung[]
    }
  }
}
