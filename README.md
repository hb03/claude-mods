# claude-mods

Mods für [Claude Code](https://claude.com/claude-code) (deutschsprachig), als Plugin-Marktplatz.

| Mod | Was er tut |
|---|---|
| `kontext-anzeige` | Hinweise zur richtigen Zeit: `/compact` vorschlagen, bevor der Auto-Compact zuschlägt; warnen, kurz bevor der Prompt-Cache abläuft; 5-h- und Wochenlimit im Blick. `/kontext` zeigt Kontext, Cache und Verbrauch im Detail. Schreibt Cache-Restzeit und Trefferquote nach `~/.claude/kontext-anzeige/` für die Statuszeile. |
| `offene-punkte` | Liest nach jeder Antwort (über Haiku) heraus, was noch offen ist – Entscheidungen und Aufgaben – und fragt es über der Eingabe ab. Aufgaben bringen ihre Anleitung mit (Befehle, Pfade, Schritte). Führt einen kurzen Überblick über die Sitzung. `/offen` zeigt alles, `/zusammenfassung` fasst die ganze Sitzung zusammen. |

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
- `offene-punkte` schickt längere Antworten an Haiku (Option `modell`); das kostet ein paar Tokens je Antwort.

## Entwickeln

`claude plugin test plugins/<mod>` führt die Tests aus, `claude plugin validate .` prüft Marktplatz und Mods.
Version in `plugins/<mod>/.claude-plugin/plugin.json` und `.claude-plugin/marketplace.json` erhöhen, committen, pushen.

## Lizenz

MIT
