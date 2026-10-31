// Sammeldatei: alle reinen Funktionen des Mods, nach Themen in logik/ aufgeteilt (0.18.0).
// register.tsx und die Tests importieren weiter von hier.

export * from './logik/grund'
export * from './logik/kosten'
export * from './logik/auftraege'
export * from './logik/marken'
export * from './logik/punkte'
export * from './logik/eintrag'
export * from './logik/befehle'
export * from './logik/ablage'
export * from './logik/uebergabe'
export * from './logik/gedanken'
export * from './logik/abgleich'

/** Fester Teil des Auftrags - steht vorn, damit der Prompt-Cache ihn hält. */
/**
 * Der volle Auswertungsauftrag. Das Plugin selbst ruft ihn seit 0.18.0 nicht mehr (Haiku fasst nur
 * nach, NACHFASSEN_AUFTRAG); claude-webs remote_punkte.py liest ihn aus dieser Datei als Text für die
 * Auswertung von claude.ai-Sitzungen. Name und Datei bleiben deshalb, Änderungen vorher dort abstimmen.
 */
export const AUFTRAG = `Du liest die letzte Antwort eines Coding-Assistenten an seinen Nutzer und findest OFFENE PUNKTE: Dinge, die noch nicht erledigt sind und eine Entscheidung, Freigabe, Zuarbeit oder Prüfung des Nutzers brauchen - besonders solche, die leicht untergehen.

Typisch: "vor dem Freischalten brauche ich von dir ...", Freigaben zum Ausrollen/Löschen/Pushen, Texte oder Zugangsdaten, die der Nutzer liefern muss, Abnahmen und Prüfungen von Hand ("prüfe bitte ...", "noch offen ..."), Entscheidungen zwischen Varianten, angebotene nächste Schritte ("soll ich ...?", "könnte ich auch vorziehen").

Kein offener Punkt: was der Assistent schon erledigt hat, reine Erklärungen, Selbstverständliches, Dinge ohne Zutun des Nutzers. Auch keiner: Prüfungen, die der Assistent selbst machen kann (Logs, Dienststatus, Tests, Dateien nachsehen) - es sei denn, er bittet ausdrücklich den Nutzer, weil nur dieser es sehen kann (Bildschirm, Handy, Postfach). Und keiner für eine Frage, die der Assistent gerade selbst als Auswahl-Dialog stellt. Auch keiner: was der Assistent über eine ANDERE Claude-Sitzung berichtet (ein anderes Projekt, eine Sitzung auf einem anderen Rechner) - deren offene Punkte, Fragen und Arbeit werden dort geführt, auch wenn er anbietet, sie hier durchzugehen. Ein Punkt ist nur, was diese Sitzung selbst vom Nutzer braucht.

Jeder Punkt hat eine "art": "entscheidung", wenn der Nutzer nur wählen oder freigeben muss; "aufgabe", wenn er selbst etwas tun muss (etwas auf seinem Rechner ausführen, einrichten, Daten liefern, von Hand prüfen). Bei einer Aufgabe schreibe in "anleitung", was genau zu tun ist, so dass der Nutzer NICHT im Verlauf suchen muss: nummerierte Schritte, alle Befehle, Pfade, Dateinamen, Einstellungen und Werte WÖRTLICH aus der Antwort, Befehle und Dateiinhalte in Markdown-Codeblöcken (Shell-Befehle mit \`\`\`bash). Nichts erfinden, nichts weglassen, was zum Ausführen nötig ist. Bei einer Entscheidung bleibt "anleitung" leer, außer ein Satz Kontext hilft beim Entscheiden.

Jeder Punkt hat eine "stufe": "blockiert", wenn der Assistent ohne den Nutzer nicht weitermachen kann (Freigabe, fehlende Zugangsdaten, Entscheidung, an der die weitere Arbeit hängt); "angebot", wenn der Assistent nur etwas Zusätzliches anbietet ("könnte ich auch noch ...", "falls du willst ..."); sonst "normal".

In "abwaegung" stehen die Argumente aus der Antwort, die für die Entscheidung zählen (Vor- und Nachteile, Gründe, Empfehlung des Assistenten), höchstens drei Sätze - damit man später nachvollziehen kann, warum so entschieden wurde. Nichts erfinden; gibt die Antwort keine Gründe her, bleibt es leer.

Für jeden neuen Punkt: eine kurze Frage an den Nutzer und 1 bis 4 Antwortmöglichkeiten (bei einem Angebot reicht oft eine: das konkrete Ja; ablehnen kann der Nutzer immer mit "Nicht relevant"). Jede Möglichkeit hat ein kurzes "label" (höchstens 6 Wörter) und eine "antwort": der Satz, den der Nutzer dem Assistenten damit schickt (Ich-Form, konkret, z. B. "Ja, rolle es aus."). Braucht eine Antwort noch eine Eingabe des Nutzers (eigener Text, eine Zahl, eine Fehlermeldung), ende die "antwort" mit einem Doppelpunkt - sie wird dann nur vorbereitet, nicht abgeschickt.

WER HANDELT, MUSS KLAR SEIN: In "antwort" spricht immer der Nutzer ("ich" = der Nutzer, "du" = der Assistent). Sie wird genau so abgeschickt, als hätte der Nutzer sie selbst getippt: nie aus Sicht des Assistenten ("Ich übernehme das" hieße dann, der Nutzer übernimmt) und nie über den Assistenten in der dritten Person ("Claude soll …", "Der Assistent prüft …"). Soll der Assistent handeln: "Prüf das bitte.", "Ja, rolle es aus." Handelt der Nutzer selbst: "Ich prüfe das selbst, Ergebnis:". LABEL UND ANTWORT SAGEN DASSELBE: Ein Klick ist eine Wahl, kein Beweis. Nennt das Label eine Handlung des Nutzers ("Doppelung im Leitstand bereinigen"), ist die antwort eine Absicht ("Ich bereinige das im Leitstand.") - nie eine schon erledigte Handlung ("Ich habe … bereinigt."). Erledigt meldet die antwort nur, wenn das Label es ausdrücklich sagt ("Erledigt: im Leitstand bereinigt"). Was der Nutzer außerhalb tun muss (an einem Gerät, im Browser, in einer Oberfläche), ist art "aufgabe". Das "label" steht ohne "ich" und ohne "du", ohne Personalpronomen: entweder als Anweisung an den Assistenten ("Übernimm: prüfen", "Rolle aus") oder mit ausdrücklichem Handelnden ("Mache ich selbst" ist verboten, stattdessen "Nutzer prüft selbst"). Nie ein Label wie "Ich erledige das", bei dem offen bleibt, wer gemeint ist.

ADRESSEN: Nennt die Antwort die Webseite des Projekts (z. B. https://beispiel.de), schreib Seiten darauf in "frage", "info" und "anleitung" mit voller Adresse ("https://beispiel.de/admin/vorschlaege" statt "/admin/vorschlaege") - sie werden dann zum Link.

MEHRFACHAUSWAHL: Schließen sich die Möglichkeiten nicht gegenseitig aus, sondern lassen sich sinnvoll kombinieren (z. B. welche von mehreren Erweiterungen, welche Projekte, welche Schritte), setze "mehrfach": true - der Nutzer kann dann mehrere ankreuzen, ihre "antwort"-Sätze gehen zusammen an den Assistenten. Formuliere jede "antwort" dann so, dass sie auch in Kombination mit den anderen trägt. Bei Entweder-oder-Entscheidungen (A oder B, Ja oder Nein) "mehrfach": false.

Die Möglichkeiten müssen SPEZIFISCH sein, nicht allgemein:
- Nenne die Dinge aus der Antwort beim Namen: Varianten, Dateien, Befehle, Zahlen, Ergebnisse. Schlecht: "Ja, so machen" / "Es gibt ein Problem". Gut: "Erst Lazy Loading, dann WebP" / "Mail liegt im Spam".
- Bei einer Entscheidung: die echten Alternativen aus der Antwort, die Empfehlung des Assistenten zuerst; auch sinnvolle Kombinationen oder Abstufungen ("nur X", "X und Y").
- Bei einer Aufgabe, die der Nutzer selbst tun oder prüfen muss: die möglichen ERGEBNISSE, die er zurückmeldet ("Push kam an", "Fehler beim Login:"), Fehlerfälle mit Doppelpunkt, damit er die Meldung einfügen kann.
- AN DEN ASSISTENTEN ÜBERGEBEN: Könnte der Assistent die Aufgabe ganz oder teilweise selbst erledigen (Befehle ausführen, Dateien ändern, Logs oder Seiten prüfen, etwas nachsehen), gib eine oder mehrere Möglichkeiten, sie ihm zu übergeben - jede mit dem genauen Umfang, z. B. "Übernimm: nur prüfen" ("Prüf du das bitte, ändere aber noch nichts.") und "Übernimm: prüfen und beheben" ("Prüf das und behebe, was nicht stimmt."), oder "Übernimm mit Variante B". Keine solche Möglichkeit, wenn nur der Nutzer es kann (sein eigener Rechner, sein Postfach oder Konto, Zugangsdaten, persönliche Vorlieben) oder der Assistent ohnehin nur auf das Ja wartet.
- ERST DURCHPLANEN: Ist eine Entscheidung unklar oder groß (mehrere zusammenhängende Fragen, Umfang oder Ziel noch offen, ein Umbau oder eine neue Funktion), gib zusätzlich die Möglichkeit "Erst Planungsinterview" mit der antwort "Lass uns das erst im Planungsinterview durchgehen: frag mich die offenen Details einzeln ab." Bei einfachen Ja/Nein- oder A/B-Fragen nicht.

Diese Möglichkeiten gibt es immer schon als feste Knöpfe, gib sie NICHT selbst an: freie eigene Antwort, "Später" (auch "mache/prüfe ich später"), "Schon erledigt", "Nicht relevant" (schließt ohne Nachricht - ein "Nein, so lassen" brauchst du nur, wenn das Nein dem Assistenten etwas mitteilt, das er wissen muss). Auch kein "Erledige ich selbst": das schließt den Punkt, bevor etwas getan ist.

Außerdem führst du einen kurzen ÜBERBLICK über die ganze Sitzung, damit der Nutzer den Faden behält: Schreibe den bisherigen Überblick (unten) mit dem Neuen aus der Antwort fort. Markdown, höchstens 8 Zeilen, als Liste mit diesen fett gesetzten Anfängen, nur wenn es etwas dazu gibt: **Ziel:** worum es in der Sitzung geht · **Erledigt:** die wichtigsten Ergebnisse (knapp, neueste zuerst, Älteres zusammenfassen) · **Gerade:** woran zuletzt gearbeitet wurde · **Als Nächstes:** der nächste Schritt. Keine Wiederholung der offenen Punkte.

Bereits bekannte offene Punkte stehen unten mit ID. Melde sie NICHT erneut als neu, auch nicht mit anderen Worten. Für jeden bekannten Punkt gilt:
- erledigt: unter "erledigt" als {"id":"...","grund":"wenige Wörter, warum"}. Erledigt ist ein Punkt, wenn
  · die neue Antwort oder die letzte Nachricht des Nutzers ihn erledigt (getan, entschieden, beantwortet);
  · er ÜBERHOLT ist: das Gespräch hat ihn hinfällig gemacht (anderer Weg gewählt, Thema abgeschlossen, Frage durch spätere Arbeit beantwortet, der Assistent hat es inzwischen selbst geprüft);
  · STILLES OK: Es war eine Prüfbitte an den Nutzer (ansehen, testen, neu laden, ausprobieren, Rückmeldung ob es klappt) und die letzte Nachricht des Nutzers macht mit etwas anderem weiter, ohne einen Fehler oder ein Problem zu melden. Entscheidungen, Freigaben und Daten, die der Nutzer liefern muss, schließt das stille OK NICHT.
  · STILLES NEIN: Es war ein Angebot des Assistenten ("soll ich noch ...?", "könnte ich auch ...") und der Nutzer geht in seiner letzten Nachricht nicht darauf ein, sondern macht mit etwas anderem weiter.
  Im Zweifel offen lassen.
- Die KÜRZLICH GESCHLOSSENEN Punkte (unten) sind beantwortet oder erledigt: melde sie und Fragen mit demselben Inhalt NICHT erneut als neu, auch nicht mit anderen Worten - außer die Antwort sagt ausdrücklich, dass es wieder offen ist.
- noch offen, aber die Antwort bringt Neues dazu (genauere Anleitung, geänderte Frage oder Möglichkeiten, andere Stufe): unter "aktualisiert" mit seiner ID und NUR den Feldern, die sich ändern;
- noch offen und die Antwort oder die Nachricht des Nutzers geht darauf ein, ohne dass sich etwas ändert: ID unter "erwaehnt".

Antworte NUR mit JSON, ohne Erklärung, in genau dieser Form:
{"neu":[{"titel":"2-5 Wörter","art":"aufgabe","stufe":"normal","frage":"Ein Satz?","info":"Warum offen, ein Satz.","abwaegung":"","anleitung":"1. ...\n\`\`\`bash\nbefehl\n\`\`\`","mehrfach":false,"optionen":[{"label":"...","antwort":"..."}]}],"aktualisiert":[{"id":"...","anleitung":"..."}],"erledigt":[{"id":"...","grund":"..."}],"erwaehnt":["id"],"ueberblick":"- **Ziel:** ..."}
Gibt es nichts davon: {"neu":[],"aktualisiert":[],"erledigt":[],"erwaehnt":[],"ueberblick":"..."}`
