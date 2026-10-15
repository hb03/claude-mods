#!/usr/bin/env bash
# SessionStart-Hook: installiert Plugins aus dem Marketplace eigene-plugins, die auf diesem Rechner
# noch nie installiert waren (neu im Marketplace). Updates installierter Plugins macht Claude Code
# selbst, weil der Marketplace mit "autoUpdate": true eingetragen ist.
#
# Neu heißt: kein Eintrag unter "enabledPlugins" in ~/.claude/settings.json. Ein Plugin, das du mit
# /plugin deaktivierst, steht dort mit false und bleibt aus. Wer ein Plugin dauerhaft nicht will,
# deaktiviert es, statt es zu deinstallieren.
#
# Eingerichtet vom Skill plugins-einrichten in ~/.claude/settings.json unter hooks.SessionStart.
# Braucht jq; läuft unter Windows mit Git-Bash.

cat >/dev/null # das Hook-JSON auf stdin wird nicht gebraucht

mp=eigene-plugins
liste="$HOME/.claude/plugins/marketplaces/$mp/.claude-plugin/marketplace.json"
settings="$HOME/.claude/settings.json"

# Unter Windows liegt jq nach "winget install" nur im PowerShell-PATH (WinGet\Links), nicht im PATH
# der Git-Bash, mit der Claude Code dieses Skript startet. Den Ordner hier anhängen.
if ! command -v jq >/dev/null 2>&1; then
    for d in "${LOCALAPPDATA:-}/Microsoft/WinGet/Links" "$HOME/AppData/Local/Microsoft/WinGet/Links"; do
        [ -x "$d/jq.exe" ] && { PATH="$PATH:$d"; break; }
    done
fi

[ -f "$liste" ] || exit 0
if ! command -v jq >/dev/null 2>&1; then
  echo '{"systemMessage":"plugins-abgleich: jq fehlt, neue Plugins aus eigene-plugins werden nicht installiert."}'
  exit 0
fi

# Dateien über stdin an jq: unter Windows ist jq ein natives Programm, und mit MSYS_NO_PATHCONV=1
# kommen /c/...-Pfade dort nicht an.
bekannt=$( { jq -r '.enabledPlugins // {} | keys[]' <"$settings" 2>/dev/null || true; } | tr -d '\r')
neu=()
while IFS= read -r name; do
  [ -n "$name" ] || continue
  grep -qxF "$name@$mp" <<<"$bekannt" || neu+=("$name")
done < <(jq -r '.plugins[].name' <"$liste" | tr -d '\r')

[ ${#neu[@]} -gt 0 ] || exit 0

ok=()
fehler=()
for name in "${neu[@]}"; do
  if claude plugin install "$name@$mp" -s user -y >/dev/null 2>&1; then
    ok+=("$name")
  else
    fehler+=("$name")
  fi
done

text=""
[ ${#ok[@]} -gt 0 ] && text="Neu installiert: ${ok[*]} (wirkt nach /reload-plugins oder Neustart)."
[ ${#fehler[@]} -gt 0 ] && text="$text Installation fehlgeschlagen: ${fehler[*]} (claude plugin install <name>@$mp)."
jq -cn --arg t "plugins-abgleich: ${text# }" '{systemMessage: $t}'
