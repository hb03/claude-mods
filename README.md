# claude-mods

Mods für [Claude Code](https://claude.com/claude-code) (deutschsprachig), als Plugin-Marktplatz.

| Mod | Was er tut |
|---|---|
| `kontext-anzeige` | Hinweise zur richtigen Zeit: `/compact` vorschlagen, bevor der Auto-Compact zuschlägt; warnen, kurz bevor der Prompt-Cache abläuft; 5-h- und Wochenlimit im Blick. `/kontext` zeigt Kontext, Cache und Verbrauch im Detail; `/kontext warn 300k` setzt die Token-Schwelle für den Hinweis (Option `warnTokens`, gilt für alle Sitzungen des Rechners, `aus` schaltet ab, `standard` nimmt wieder die Option); `/kontext test` probiert aus, welche Einblendungen auf der verbundenen Oberfläche (Handy, Fernsteuerung) ankommen. Die Warnungen stehen mit `offene-punkte` über der Eingabe. Schreibt Cache-Restzeit und Trefferquote nach `~/.claude/kontext-anzeige/` für die Statuszeile. |
| `offene-punkte` | Führt, was noch offen ist – Entscheidungen und Aufgaben, blockierende zuerst – und fragt es über der Eingabe ab, immer auch mit „Eigene Antwort …“. Claude trägt die Punkte als Block ```` ```offen ```` am Ende seiner Antwort ein und schließt Erledigtes per „erledigt: #3“; Haiku fasst nur nach, wenn eine Antwort fragt und nichts eingetragen wurde, gleicht stündlich mit Commits ab und schreibt den Überblick der Sitzung fort. Die Liste liegt je Projekt in `offene-punkte/offen.md` und `offen.json` (claude-web) und geht in die nächste Sitzung mit; `/offen übergabe` schreibt eine Übergabe und leert den Verlauf. Gedanken (`/offen gedanke`), Befehle von außen (`eingang.txt`), Kosten und Nutzung (`/offen kosten`). Mehrere Sitzungen in einem Projekt schreiben unter einer Sperre und halten Geschlossenes als Grabstein. Alles Weitere in [plugins/offene-punkte/README.md](plugins/offene-punkte/README.md). |
| `push-wache` | Prüft vor jedem `git push`, den Claude in ein öffentliches Repo macht (GitHub, GitLab, Bitbucket, Codeberg), die neuen Commits: eigene Muster wie Namen, Servernamen oder Pfade (Option `muster`, ein regulärer Ausdruck), Autor- und Committer-Mails (Option `mails`, Standard: GitHub-noreply) und typische Geheimnisse (API-Schlüssel, Tokens, private Schlüssel, Passwörter). Bei einem Fund fragt der eingebaute Frage-Dialog mit den Fundstellen: abbrechen oder trotzdem pushen. Pushes von Hand im Terminal sieht sie nicht. |
| `commit-erinnerung` | Läuft ein Testbefehl grün durch (phpunit, pest, npm/pnpm/yarn test, pytest, vitest, jest, cargo/go/make test, `claude plugin test` u. a.; weitere per Option `testbefehle`) und liegen danach uncommittete Änderungen im Repo, bekommt Claude still einen Hinweis, den Arbeitsschritt zu committen – für denselben Stand nur einmal. Fehlschläge erkennt er auch hinter einer Pipe (`npm test \| tail`). |
| `haiku-helfer` | Drei Subagenten auf Haiku für Fleißarbeit: `log-sucher` sichtet Logs und lange Ausgaben und meldet nur den Befund, `datei-finder` findet Dateien und Stellen (`pfad:zeile`), `status-abfrage` fragt Geräte und Dienste nur lesend ab. Ihre Beschreibung sagt „use proactively“, so gibt Claude solche Aufgaben von selbst an das günstige Modell ab, statt sie mit dem Hauptmodell zu erledigen. |
| `hintergrund-befehle` | Gibt jeder Sitzung (auch nach einer Compaction) als eigenen Abschnitt im Systemprompt die Regel mit, Shell-Befehle, die voraussichtlich länger als etwa eine Minute brauchen – `git clone`, Installationen (winget, apt, pip, npm), Builds, große Downloads, Einrichtungsskripte, lange Tests –, selbst mit `run_in_background` zu starten und danach nicht zu pollen; kurze Befehle, deren Ergebnis sofort gebraucht wird, bleiben im Vordergrund. Muss der Nutzer trotzdem einen Bash- oder PowerShell-Befehl per Strg+B wegschieben, bekommt Claude still einen Hinweis am Ergebnis. |

Dazu `statusline.sh`: eine Statuszeile unter der Eingabe mit Repo, Zweig, Modell und Aufwand, Kontextbalken,
Cache (Restzeit und Treffer, mit `kontext-anzeige`), 5-h- und Wochenlimit, Kosten und geänderten Zeilen.
Läuft unter Linux, macOS und Windows (Git-Bash); braucht `jq` und `gawk`. Am besten mit einer Schrift, die Emojis zeigt
(z. B. im Windows Terminal).

## Installieren

Unter Windows alles auf einmal (git, jq, Claude Code, Marketplace mit Auto-Update, alle Plugins, Hook,
Statuszeile), in PowerShell:

```
irm https://raw.githubusercontent.com/hb03/claude-mods/main/einrichten.ps1 | iex
```

Von Hand, in Claude Code:

```
/plugin marketplace add hb03/claude-mods
/plugin install kontext-anzeige@eigene-plugins
/plugin install offene-punkte@eigene-plugins
/plugin install push-wache@eigene-plugins
/plugin install commit-erinnerung@eigene-plugins
/plugin install haiku-helfer@eigene-plugins
/plugin install hintergrund-befehle@eigene-plugins
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

Neue Plugins automatisch installieren: `plugins-abgleich.sh` als SessionStart-Hook. Er installiert beim
Start jedes Plugin aus dem Marktplatz, das unter `enabledPlugins` noch keinen Eintrag hat; deaktivierte
bleiben aus. Updates macht `autoUpdate`. Braucht `jq`.

```json
"hooks": {
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": "bash ~/.claude/plugins/marketplaces/eigene-plugins/plugins-abgleich.sh", "timeout": 120 } ] }
  ]
}
```

Alles zusammen richtet der Skill `skills/plugins-einrichten` ein (als ZIP auf claude.ai hochladen, dann steht er
auf jedem Rechner bereit): „Plugins einrichten“ genügt.

## Hinweise

- Die Mods nutzen die Plugin-Schnittstelle für Mods (Function Hooks) von Claude Code; sie ist noch als *early access*
  gekennzeichnet und kann sich zwischen Versionen ändern.
- `kontext-anzeige` zeichnet seit 0.4.0 keine eigene Zeile über der Eingabe mehr: die Werte stehen in der Statuszeile,
  die Warnungen zeigt `offene-punkte` (mit Knopf für `/compact`).
- `offene-punkte` ruft Haiku (Option `modell`) nur zum Nachfassen, zum stündlichen Abgleich und für den Überblick; was das kostet und was benutzt wird, steht in `offene-punkte/kosten.jsonl` und zeigt `/offen kosten`.
- `offene-punkte` legt im Git-Repo den Ordner `offene-punkte/` an und trägt ihn in `.git/info/exclude` ein (lokal, die `.gitignore` bleibt unberührt). Außerhalb eines Repos liegt er unter `~/.claude/offene-punkte/<projektpfad>/`. Die Dateien bleiben auf dem Rechner; der Tagesverlauf wird nicht aufgeräumt. Laufen zwei Sitzungen im selben Projekt, schreiben sie unter einer Sperre und laden den Stand der anderen nach; wer den Punkt einer anderen Sitzung beantworten will, übernimmt ihn in `/offen`. Beim Start übernimmt eine Sitzung, was offen ist und keiner laufenden Sitzung gehört.

## Entwickeln

`claude plugin test plugins/<mod>` führt die Tests aus, `claude plugin validate .` prüft Marktplatz und Mods.
Nicht im Marketplace-Ordner unter `~/.claude/plugins/marketplaces/` arbeiten: das Auto-Update klont ihn neu und verwirft lokale Commits – in einer eigenen Arbeitskopie entwickeln und pushen.
Version in `plugins/<mod>/.claude-plugin/plugin.json` und `.claude-plugin/marketplace.json` erhöhen, committen, pushen.

## Lizenz

MIT
