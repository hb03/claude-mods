---
name: plugins-einrichten
description: "Richtet auf diesem Rechner alle eigenen Claude-Code-Plugins aus dem Marketplace eigene-plugins (GitHub hb03/claude-mods) ein und sorgt dafür, dass sie aktuell bleiben: Marketplace mit autoUpdate, alle Plugins installieren und aktualisieren, Hook für neu hinzukommende Plugins, Statuszeile. Verwenden, wenn der Nutzer sagt \"installier meine Plugins\", \"Plugins einrichten\", \"neuer Rechner\", \"Plugins aktualisieren\", \"sind meine Plugins aktuell?\", \"plugins-einrichten\", oder wenn eines der eigenen Plugins (offene-punkte, kontext-anzeige, haiku-helfer, push-wache, commit-erinnerung …) fehlt oder veraltet ist. Gilt auf jedem Rechner und in jedem Projekt."
---

# Eigene Plugins einrichten und aktuell halten

Quelle ist immer der Marketplace **eigene-plugins** = GitHub `hb03/claude-mods`.
Welche Plugins es gibt, steht in dessen `.claude-plugin/marketplace.json` –
nie eine Liste aus dem Gedächtnis nehmen, neue Plugins kommen dazu.

Danach hält sich alles selbst aktuell:
- **Updates** installierter Plugins: Claude Code, weil der Marketplace mit
  `"autoUpdate": true` eingetragen ist (läuft nach der ersten Nachricht einer
  Sitzung im Hintergrund; neue Versionen wirken ab dem nächsten Start oder nach
  `/reload-plugins`).
- **Neue Plugins** im Marketplace: der SessionStart-Hook `plugins-abgleich.sh`
  aus dem Marketplace-Clone. Er installiert jedes Plugin, das unter
  `enabledPlugins` noch gar keinen Eintrag hat. Deaktivierte Plugins (`false`)
  lässt er in Ruhe.

Der Skill ist idempotent: Auf einem eingerichteten Rechner prüft er nur und
holt Updates sofort, statt auf das Auto-Update zu warten.

## 0. Umgebung

- Pfade: `~/.claude/settings.json`, Clone `~/.claude/plugins/marketplaces/eigene-plugins`.
  Unter Windows ist `~` z. B. `C:/Users/<name>`; Befehle über Git-Bash oder
  PowerShell, `claude` muss im PATH sein.
- Nötig sind `git` und `jq` (Hook und Statuszeile). Fehlt `jq`, dem Nutzer den
  Installationsbefehl nennen (Windows: `winget install jqlang.jq`, Debian/Ubuntu:
  `sudo apt install jq`, macOS: `brew install jq`) und erst nach Zustimmung
  ausführen.
- Unter Windows den Pfad zu Git-Bash ermitteln (meist
  `C:/Program Files/Git/bin/bash.exe`); den braucht Schritt 4 und 5.

## 1. Marketplace

```
claude plugin marketplace list --json
```
- Fehlt `eigene-plugins`: `claude plugin marketplace add hb03/claude-mods`
- Sonst: `claude plugin marketplace update eigene-plugins`

In `~/.claude/settings.json` muss stehen (zusammenführen, nichts anderes
anfassen; Datei vorher lesen, mit Edit ändern, danach mit `jq . <datei>`
prüfen, dass sie gültiges JSON ist):
```json
"extraKnownMarketplaces": {
  "eigene-plugins": {
    "source": { "source": "github", "repo": "hb03/claude-mods" },
    "autoUpdate": true
  }
}
```

## 2. Plugins installieren und aktualisieren

Soll-Liste: `jq -r '.plugins[] | "\(.name) \(.version)"'` auf
`~/.claude/plugins/marketplaces/eigene-plugins/.claude-plugin/marketplace.json`.
Ist-Stand: `claude plugin list --json` (Liste mit `id` = `name@eigene-plugins`,
`version`, `enabled`). jq unter Windows Dateien immer über stdin geben
(`jq … < datei`), Git-Bash-Pfade wie `/c/...` kommen dort nicht an.

Für jedes Plugin der Soll-Liste:
- steht unter `enabledPlugins` mit `false` → **auslassen** (bewusst abgeschaltet),
  im Bericht nennen;
- nicht installiert → `claude plugin install <name>@eigene-plugins -s user -y`;
- installiert, Version älter als im Marketplace →
  `claude plugin update <name>@eigene-plugins -s user -y`;
- sonst nichts tun.

Unabhängige Installationen dürfen nacheinander in einem Befehl laufen; schlägt
eine fehl, die Fehlermeldung wörtlich festhalten und mit den übrigen weitermachen.

## 3. Plugin-Optionen

Für frisch installierte Plugins `claude plugin configure <name>@eigene-plugins`
aufrufen. Zeigt es Optionen ohne Wert, die nötig sind, den Nutzer danach fragen.
Die Voreinstellungen der Plugins sind sonst in Ordnung – nichts erfinden.

**push-wache, Option `mails`:** Ohne Einstellung erlaubt sie nur
`@users.noreply.github.com` und fragt dann bei jedem Push von Claude nach, der
mit einer anderen Mail committet. Ist `pluginConfigs["push-wache@eigene-plugins"].options.mails`
in `~/.claude/settings.json` leer oder nicht gesetzt:
- Die Commit-Mails dieses Rechners ermitteln: `git config --global user.email`
  und `GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_EMAIL` unter `env` in `settings.json`.
- Dem Nutzer vorschlagen, sie zu erlauben, und erst nach Zustimmung eintragen:
  `@users\.noreply\.github\.com$|^claude@hb03\.de$|^<mail mit \. statt .>$`.
  `claude@hb03.de` ist die Mail, mit der Claude bei Marc committet.
- Danach `claude plugin configure push-wache@eigene-plugins` aufrufen; dort muss `mails` als gesetzt erscheinen.

Ist `mails` schon gesetzt, nichts ändern.

Unter Windows erledigt `einrichten.ps1` aus dem Clone dasselbe ohne Rückfrage, auch
Schritt 1, 2, 4 und 5 (`irm https://raw.githubusercontent.com/hb03/claude-mods/main/einrichten.ps1 | iex`).

## 4. Hook für neue Plugins

In `~/.claude/settings.json` unter `hooks.SessionStart` genau **einen** Eintrag,
dessen Befehl `plugins-abgleich.sh` enthält (gibt es schon einen, Pfad prüfen
und sonst nichts tun):

- Linux/macOS: `bash ~/.claude/plugins/marketplaces/eigene-plugins/plugins-abgleich.sh`
- Windows: `"C:/Program Files/Git/bin/bash.exe" C:/Users/<name>/.claude/plugins/marketplaces/eigene-plugins/plugins-abgleich.sh`
  (Git-Bash-Pfad aus Schritt 0, Schrägstriche vorwärts)

```json
"hooks": {
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": "<Befehl von oben>", "timeout": 120 } ] }
  ]
}
```
Bestehende andere Hooks bleiben unverändert. Danach den Befehl einmal von Hand
ausführen (`echo '{}' | <Befehl>`): Ausgabe leer = nichts Neues, sonst ein
JSON mit `systemMessage`.

## 5. Statuszeile (gehört zu kontext-anzeige)

Ist `statusLine` in `~/.claude/settings.json` nicht gesetzt, eintragen:
```json
"statusLine": {
  "type": "command",
  "command": "bash ~/.claude/plugins/marketplaces/eigene-plugins/statusline.sh",
  "refreshInterval": 30
}
```
Unter Windows wieder mit vollem Git-Bash-Pfad und absolutem Pfad wie in
Schritt 4. Ist eine andere Statuszeile gesetzt, nicht überschreiben, sondern
den Nutzer fragen.

## 6. Bericht

Kurz, als Tabelle: Plugin · vorher · jetzt · was getan (installiert,
aktualisiert, aktuell, ausgelassen, Fehler mit Meldung). Darunter, was sich an
`settings.json` geändert hat (Marketplace, Hook, Statuszeile). Wurde etwas
installiert oder aktualisiert: Hinweis, dass es erst nach `/reload-plugins`
oder einem Neustart von Claude Code wirkt.
