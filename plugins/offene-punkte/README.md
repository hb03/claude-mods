# offene-punkte

Mod für Claude Code: führt, was in einer Sitzung noch offen ist – Entscheidungen, Freigaben und Aufgaben, die der Nutzer selbst erledigen muss –, fragt es über der Eingabe ab und gibt die Liste je Projekt in die nächste Sitzung mit.

## Wie es läuft

- **Claude trägt ein.** Braucht Claude etwas vom Nutzer, schreibt er einen Block ```` ```offen ```` ans Ende seiner Antwort (Titel, Art, Stufe, Frage, bis zu zwei Möglichkeiten, bei Aufgaben eine Anleitung). Der Mod liest den Block, vergibt eine Nummer je Projekt und stellt die Frage über der Eingabe – immer auch mit „Eigene Antwort …“, „Später“, „Erledigt“, „Nicht relevant“.
- **Haiku fasst nach.** Endet eine Antwort mit einer Frage oder Bitte, ohne dass Claude einen Block geschrieben hat, liest Haiku die Antwort mit einem kurzen, strengen Auftrag (`NACHFASSEN_AUFTRAG`) und legt nur an, was sonst verloren ginge.
- **Antworten gehen gesammelt.** Gewählte Antworten gehen als eine Nachricht an Claude, spätestens 30 s nach der letzten Wahl; ist keine Frage mehr offen, liegen sie in der leeren Eingabe und gehen nach 5 s von selbst (Enter sofort, Tippen hält an). Ein Punkt schließt sich erst, wenn die Antwort bei Claude ist.
- **Claude schließt selbst.** „erledigt: #3“, „überholt: #4 – Grund“ oder „erledigt: Titel“ in einer Antwort schließt den Punkt sofort; die offene Liste bekommt Claude still mit jeder Nachricht, sobald sie sich geändert hat, und nach jeder Compaction erneut.
- **Alterndes schließt sich.** Punkte, die Claude über viele Antworten nicht mehr erwähnt, und nicht aufgegriffene Angebote schließen sich ohne Frage; beim Start und dann stündlich gleicht Haiku Punkte, die seit sechs Stunden liegen, mit den Commits und Entscheidungen seither ab (einmal je Projekt, nicht je Sitzung).
- **Überblick.** Alle acht Antworten, nach jeder Compaction und bei `/zusammenfassung` schreibt Haiku einen Überblick der Sitzung fort (alter Überblick plus neue Nachrichten; nach drei Fortschreibungen einmal ganz neu).
- **Übergabe.** `/offen übergabe` lässt das Hauptmodell aufschreiben, was die nächste Sitzung braucht, legt es in `uebergaben/` ab und führt `/clear` aus; die nächste neue Unterhaltung bekommt es mit der ersten Nachricht, sonst den Überblick der letzten Sitzung.
- **Gedanken.** `/offen gedanke <Text>` notiert einen Einfall in `gedanken.md` (wie claude-web es führt); senden, ins Planungsinterview geben, als Punkt übernehmen, prüfen lassen. Claude vermerkt per „gedanke erledigt: G3 – Commit abc1234“.

## Befehle

| Befehl | Wirkung |
|---|---|
| `/offen` | Liste mit Überblick; steht das Pane, nur eine Zeile |
| `/offen 2 a` · `/offen 2 a c` | Antwort(en) wählen |
| `/offen 2 <Text>` · `/offen 2 antwort <Text>` | freie Antwort, geht sofort |
| `/offen 2 erledigt|weg|aktuell` · `/erledigt 2 3` · `/weg 2` | schließen, verwerfen, zurückholen |
| `/offen 2 später [sitzung|morgen|drei|woche]` | zurücklegen (ohne Zusatz: ans Ende) |
| `/offen alle weg|erledigt [Grund]` | alles auf einmal |
| `/offen klären [alle]` | Claude geht die offenen Punkte per Marke durch |
| `/offen neu <Text>` | eigenen Punkt anlegen |
| `/offen überblick` | Überblick ganz neu schreiben |
| `/offen übergabe [nur]` · `/offen übergaben` · `/offen übergabe 2` | Übergabe schreiben (ohne `/clear` mit „nur“), Archiv, ältere zeigen |
| `/offen gedanke <Text>` · `/offen gedanken` · `/offen gedanke 3 senden|interview|punkt|erledigt|weg` · `/offen gedanken prüfen` | Gedanken |
| `/offen kosten [Tage]` | Haiku-Kosten je Art, Kontext fürs Hauptmodell, Nutzung je Befehl |
| `/offen senden` · `/offen leeren` | gesammelte Antworten jetzt senden; Liste leeren |
| `/zusammenfassung` | die ganze Sitzung zusammenfassen (Fork des Hauptmodells) |

Eine selbst geschriebene Antwort „Zum offenen Punkt „Titel“: …“ schließt den Punkt mit der Nachricht.

## Dateien im Projektordner

Im Git-Repo `<projekt>/offene-punkte/` (in `.git/info/exclude` eingetragen), sonst `~/.claude/offene-punkte/<projektpfad>/`.

| Datei | Inhalt |
|---|---|
| `offen.md` | lesbare Liste mit Datenblock im HTML-Kommentar (für ältere Sitzungen) |
| `offen.json` | dieselben Daten als JSON – Schnittstelle für claude-web; Feld `geschlossen` führt Geschlossenes 14 Tage als Grabstein |
| `antworten-JJJJ-MM-TT.md` | Entscheidungen mit Gründen; älter als 30 Tage in `antworten-JJJJ-MM.md` |
| `uebergaben/` | Übergaben (`JJJJ-MM-TT-HHMM.md`, `index.md`, `wartet.txt`) |
| `gedanken.md` | Gedanken (`### G3 · 14.10.2026 09:12 · Vermerk`) |
| `eingang.txt` | Befehle von außen, je Zeile ein `/offen`-Befehl ohne das „/offen“; alle 15 s gelesen, nur von einer Sitzung ausgeführt |
| `kosten.jsonl` | je Haiku-Aufruf eine Zeile mit Tokens; `art: "kontext"` schätzt, was Claude mitbekommt; `art: "nutzung"` zählt Befehle, Wahlen, Blöcke und Marken |
| `.sperre/` | Sperrordner beim Schreiben (siehe unten) |
| `.sitzungen/<id>` | Lebenszeichen der laufenden Sitzungen (jede Minute) |
| `abgleich.txt` | wann der stündliche Abgleich zuletzt lief und von wem |

## Mehrere Sitzungen in einem Projekt

- Jede Sitzung schreibt `offen.md`, `offen.json`, Tagesverlauf und `gedanken.md` unter einer **Sperre**: `mkdir offene-punkte/.sperre` gelingt genau einer; ist sie älter als 15 s, gilt sie als verwaist und wird aufgehoben; nach rund 3 s Warten wird ohne Sperre geschrieben. Wer die Sperre hält, hebt sie per `rmdir` wieder auf. claude-web beachtet dieselbe Sperre beim Schreiben von `gedanken.md`.
- **Grabsteine:** geschlossene Punkte stehen 14 Tage in `offen.json` (`geschlossen`), auch wenn sie aus der Liste gefallen sind. Eine Sitzung, die einen Punkt noch offen kennt, schreibt ihn nicht wieder auf.
- **Nachladen:** ändert eine andere Sitzung `offen.md`, kommt der Stand per Änderungszeit im Eingangstakt und vor jeder Nachricht herein.
- **Lebenszeichen:** beim Start übernimmt eine Sitzung nur Punkte von Sitzungen ohne frisches Zeichen (5 Minuten); Punkte laufender Sitzungen stehen in `/offen`, werden dort aber nicht gefragt.

## Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `modell` | `haiku` | Modell für Nachfassen, Abgleich und Überblick |
| `haikuBisProzent` | 85 | darüber (5-Stunden-Fenster) kein Haiku mehr |
| `fragenAnzeigen` | true | aus: nur Statuszeile und `/offen` |

Ohne Menschen davor (`claude -p`, SDK) bleibt der Mod still; Antworten auf Maschinen-Eingaben (Peer-Nachrichten, Zeitpläne, claude-webs Klärung) werden nicht ausgewertet.

## Aufbau

- `hooks/register.tsx` verdrahtet die Hooks; `zustand.ts` hält den geteilten Zustand (`z`) und die Marken der Auswahl.
- `dateien.ts` (Sperre, Schreiben, Speichern, Nachladen, Lebenszeichen), `haiku.ts` (Nachfassen, Abgleich, Überblick), `antworten.ts` (Wahl, Sammeln, Senden), `kommandos.ts` (`/offen`, Block, Gedanken, Übergabe, `eingang.txt`), `oberflaeche.tsx` (Bausteine für Band und Pane).
- `hooks/logik.ts` ist die Sammeldatei der reinen Funktionen aus `hooks/logik/` – und hält `AUFTRAG` wörtlich, weil claude-webs `remote_punkte.py` sie als Text liest.
- Zwei Regeln des Laders: `$` wandert über Dateigrenzen nur in Funktionsdeklarationen (`function f($)`), und `read`/`update` nehmen nur Zustandsreferenzen (`atom(...)`), die in derselben Datei stehen.
- `claude plugin test plugins/offene-punkte` führt die Tests aus, `claude plugin validate plugins/offene-punkte` prüft den Mod. Entwickelt wird in einer eigenen Arbeitskopie, nicht im Marketplace-Ordner unter `~/.claude/plugins/marketplaces/` – den klont das Auto-Update neu und verwirft lokale Commits.
