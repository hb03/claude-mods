# claude-mods

Mods für [Claude Code](https://claude.com/claude-code) (deutschsprachig), als Plugin-Marktplatz.

| Mod | Was er tut |
|---|---|
| `kontext-anzeige` | Hinweise zur richtigen Zeit: `/compact` vorschlagen, bevor der Auto-Compact zuschlägt; warnen, kurz bevor der Prompt-Cache abläuft; 5-h- und Wochenlimit im Blick. `/kontext` zeigt Kontext, Cache und Verbrauch im Detail. Schreibt Cache-Restzeit und Trefferquote nach `~/.claude/kontext-anzeige/` für die Statuszeile. |
| `offene-punkte` | Liest nach jeder Antwort (über Haiku) heraus, was noch offen ist – Entscheidungen und Aufgaben, blockierende zuerst – und fragt es über der Eingabe ab, immer auch mit „Eigene Antwort …“. Aufgaben bringen ihre Anleitung mit (Befehle, Pfade, Schritte), Shell-Befehle lassen sich per „Ausführen“ als Bitte an Claude in die Eingabe legen. Führt einen kurzen Überblick über die Sitzung. Die Liste liegt je Projekt in `offene-punkte/offen.md` und geht in die nächste Sitzung mit; Entscheidungen landen mit ihren Gründen in `offene-punkte/antworten-JJJJ-MM-TT.md`. `/offen` zeigt alles (`/offen 2 a`, `/offen 2 erledigt|weg|später`), `/zusammenfassung` fasst die ganze Sitzung zusammen. |

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
- `kontext-anzeige` hat eine eigene Zeile über der Eingabe; sie ist standardmäßig aus (Option `zeileUeberEingabe`),
  weil dort `offene-punkte` seine Fragen stellt und die Werte in der Statuszeile stehen.
- `offene-punkte` schickt längere Antworten – und kurze, die etwas fragen – an Haiku (Option `modell`); das kostet ein paar Tokens je Antwort.
- `offene-punkte` legt im Git-Repo den Ordner `offene-punkte/` an und trägt ihn in `.git/info/exclude` ein (lokal, die `.gitignore` bleibt unberührt). Außerhalb eines Repos liegt er unter `~/.claude/offene-punkte/<projektpfad>/`. Die Dateien bleiben auf dem Rechner; der Tagesverlauf wird nicht aufgeräumt. Laufen zwei Sitzungen im selben Projekt, gewinnt in `offen.md` die zuletzt schreibende.

## Entwickeln

`claude plugin test plugins/<mod>` führt die Tests aus, `claude plugin validate .` prüft Marktplatz und Mods.
Version in `plugins/<mod>/.claude-plugin/plugin.json` und `.claude-plugin/marketplace.json` erhöhen, committen, pushen.

## Lizenz

MIT
