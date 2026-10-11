/** Was die Wache in einem Push gefunden hat. */
export type Fund = {
  art: 'muster' | 'mail' | 'geheimnis'
  /** Datei:Zeile oder Commit. */
  wo: string
  /** Was gefunden wurde, Geheimnisse gekürzt. */
  was: string
}

/** Ein git push in einem Shell-Befehl. */
export type Push = {
  /** Aus `git -C <pfad>` oder einem `cd <pfad>` davor; fehlt: das Arbeitsverzeichnis. */
  verzeichnis?: string
  /** Name oder URL; fehlt: origin. */
  remote?: string
}
