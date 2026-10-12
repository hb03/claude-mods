# claude-mods

Mods für [Claude Code](https://claude.com/claude-code) (deutschsprachig), als Plugin-Marktplatz.

| Mod | Was er tut |
|---|---|
| `kontext-anzeige` | Hinweise zur richtigen Zeit: `/compact` vorschlagen, bevor der Auto-Compact zuschlägt; warnen, kurz bevor der Prompt-Cache abläuft; 5-h- und Wochenlimit im Blick. `/kontext` zeigt Kontext, Cache und Verbrauch im Detail, `/kontext test` probiert aus, welche Einblendungen auf der verbundenen Oberfläche (Handy, Fernsteuerung) ankommen. Die Warnungen stehen mit `offene-punkte` über der Eingabe. Schreibt Cache-Restzeit und Trefferquote nach `~/.claude/kontext-anzeige/` für die Statuszeile. |
| `offene-punkte` | Liest nach jeder Antwort (über Haiku) heraus, was noch offen ist – Entscheidungen und Aufgaben, blockierende zuerst – und fragt es über der Eingabe ab, immer auch mit „Eigene Antwort …“. Aufgaben bringen ihre Anleitung mit (Befehle, Pfade, Schritte), Shell-Befehle lassen sich per „Ausführen“ als Bitte an Claude in die Eingabe legen. Führt einen kurzen Überblick über die Sitzung. Die Liste liegt je Projekt in `offene-punkte/offen.md` und geht in die nächste Sitzung mit; Entscheidungen landen mit ihren Gründen in `offene-punkte/antworten-JJJJ-MM-TT.md`. Gewählte Antworten gehen gesammelt als eine Nachricht los, spätestens 30 s nach der letzten Wahl. Ist keine aktuelle Frage mehr offen, legt der Mod die Antworten in die leere Eingabe: Enter schickt sofort, sonst gehen sie nach 5 s von selbst (Tippen hält an; ist die Eingabe belegt, bleibt sie unberührt); geschlossen wird ein Punkt erst, wenn die Antwort bei Claude ist (sonst wird er wieder gefragt). Antworten, die ergänzt werden müssen, kommen unter angefangenen Text in die Eingabe. Die Nummern sind je Projekt fortlaufend und werden nie wiederverwendet; sie bleiben auch nach dem Schließen am Punkt und stehen im Verlauf (`## 09:12 · #12 Titel – entschieden`), so dass man sich später auf „#12“ beziehen kann. „Später“ fragt, wie lange: ans Ende, bis zur nächsten Sitzung, morgen, in 3 Tagen oder nächste Woche – per Befehl `/offen <Nr> später sitzung|morgen|drei|woche` (ohne Zusatz: ans Ende). `/offen neu <Text>` legt selbst einen Punkt an (ohne feste Antworten, beantwortet wird frei); die Auswertung schließt, ändert und altert solche Punkte nicht. Zurückgelegte Punkte stehen in `/offen` gedämpft unten und kommen zur gewählten Zeit von selbst wieder; die Statuszeile sagt, wann der nächste dran ist („2 zurückgelegt – nächster Mo 12.10.“). Früher zurückholen: `/offen <Nr> aktuell` – das hebt Ruhe und Zurückstellen auf. Beantworten oder schließen lässt sich ein zurückgelegter Punkt auch direkt (`/offen <Nr> a`, `/offen <Nr> erledigt`). Laufen zwei Sitzungen im selben Projekt, gleicht jede vor dem Schreiben mit `offen.md` ab: Geschlossenes bleibt zu, Punkte der anderen Sitzung stehen in `/offen`, gefragt werden sie dort nicht. Tagesverläufe, die älter als 30 Tage sind, kommen in eine Monatsdatei. Erledigtes schließt sich auch ohne Zutun (ab 0.11.0): die Auswertung erkennt, was getan, entschieden oder überholt ist, und Prüfbitten („klappt es jetzt?“), auf die der Nutzer ohne Fehlermeldung weiterarbeitet (stilles OK) – Entscheidungen und Freigaben nie still. Claude kann einen Punkt selbst schließen, indem er „erledigt: #3“ in seine Antwort schreibt (der Mod sagt ihm das einmal je Unterhaltung). Solche Punkte stehen 24 h mit 🤖 und Grund unter „Automatisch erledigt“ in `/offen`, `/offen <Nr> aktuell` öffnet sie wieder. Für Prüfungen, die Claude selbst machen kann, legt die Auswertung keine Punkte an. Warnungen von `kontext-anzeige` (ab 0.4.0) stehen über der Frage, mit Knopf für `/compact`. `/offen` zeigt alles (`/offen 2 a`, `/offen 2 erledigt|weg|später|aktuell`, `/offen 2 später morgen`, `/offen neu <Text>`, `/offen senden`), `/zusammenfassung` fasst die ganze Sitzung zusammen und schreibt dabei den Überblick neu (vom Hauptmodell, aus dem ganzen Verlauf statt fortgeschrieben). |
| `push-wache` | Prüft vor jedem `git push`, den Claude in ein öffentliches Repo macht (GitHub, GitLab, Bitbucket, Codeberg), die neuen Commits: eigene Muster wie Namen, Servernamen oder Pfade (Option `muster`, ein regulärer Ausdruck), Autor- und Committer-Mails (Option `mails`, Standard: GitHub-noreply) und typische Geheimnisse (API-Schlüssel, Tokens, private Schlüssel, Passwörter). Bei einem Fund fragt der eingebaute Frage-Dialog mit den Fundstellen: abbrechen oder trotzdem pushen. Pushes von Hand im Terminal sieht sie nicht. |
| `commit-erinnerung` | Läuft ein Testbefehl grün durch (phpunit, pest, npm/pnpm/yarn test, pytest, vitest, jest, cargo/go/make test, `claude plugin test` u. a.; weitere per Option `testbefehle`) und liegen danach uncommittete Änderungen im Repo, bekommt Claude still einen Hinweis, den Arbeitsschritt zu committen – für denselben Stand nur einmal. Fehlschläge erkennt er auch hinter einer Pipe (`npm test \| tail`). |

Dazu `statusline.sh`: eine Statuszeile unter der Eingabe mit Repo, Zweig, Modell und Aufwand, Kontextbalken,
Cache (Restzeit und Treffer, mit `kontext-anzeige`), 5-h- und Wochenlimit, Kosten und geänderten Zeilen.
Läuft unter Linux, macOS und Windows (Git-Bash); braucht `jq` und `gawk`. Am besten mit einer Schrift, die Emojis zeigt
(z. B. im Windows Terminal).

## Installieren

In Claude Code:

```
/plugin marketplace add hb03/claude-mods
/plugin install kontext-anzeige@eigene-plugins
/plugin install offene-punkte@eigene-plugins
/plugin install push-wache@eigene-plugins
/plugin install commit-erinnerung@eigene-plugins
```

Automatisch aktuell halten – in `~/.claude/settings.json`:

```json
"extraKnownMarketplaces": {
  "eigene-plugins": {
    "source": { "source": "github", "repo": "hb03/claude-mods" },
    "autoUpdate": true
  }
}
```

Statuszeile – ebenfalls in `~/.claude/settings.json`; der Pfad ist der, unter dem Claude Code den Marktplatz ablegt:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/plugins/marketplaces/eigene-plugins/statusline.sh",
  "refreshInterval": 30
}
```

Unter Windows: `"command": "\"C:/Program Files/Git/bin/bash.exe\" C:/Users/<name>/.claude/plugins/marketplaces/eigene-plugins/statusline.sh"`.

## Hinweise

- Die Mods nutzen die Plugin-Schnittstelle für Mods (Function Hooks) von Claude Code; sie ist noch als *early access*
  gekennzeichnet und kann sich zwischen Versionen ändern.
- `kontext-anzeige` zeichnet seit 0.4.0 keine eigene Zeile über der Eingabe mehr: die Werte stehen in der Statuszeile,
  die Warnungen zeigt `offene-punkte` (mit Knopf für `/compact`).
- `offene-punkte` schickt längere Antworten – und kurze, die etwas fragen – an Haiku (Option `modell`); das kostet ein paar Tokens je Antwort.
- `offene-punkte` legt im Git-Repo den Ordner `offene-punkte/` an und trägt ihn in `.git/info/exclude` ein (lokal, die `.gitignore` bleibt unberührt). Außerhalb eines Repos liegt er unter `~/.claude/offene-punkte/<projektpfad>/`. Die Dateien bleiben auf dem Rechner; der Tagesverlauf wird nicht aufgeräumt. Laufen zwei Sitzungen im selben Projekt, werden sie beim Schreiben abgeglichen; wer den Punkt einer anderen Sitzung beantworten will, übernimmt ihn in `/offen`. Beim Start übernimmt eine Sitzung alles, was offen ist.

## Entwickeln

`claude plugin test plugins/<mod>` führt die Tests aus, `claude plugin validate .` prüft Marktplatz und Mods.
Version in `plugins/<mod>/.claude-plugin/plugin.json` und `.claude-plugin/marketplace.json` erhöhen, committen, pushen.

## Lizenz

MIT
