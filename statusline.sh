#!/usr/bin/env bash
# Claude Code Statuszeile (unter der Eingabe): Repo, Zweig, Modell, Kontext, Cache, Limits, Kosten.
#
#   📁 repo │ 🌿 zweig │ 🤖 Modell · Aufwand │ ████████░░ ⚡ 42% 84k/200k ⇢763k │ 💾 ● 48m 99% │ 🕔 8% 📅 2% │ 💰 $3.21 │ +120 -30
#   ▲ Hinweis des Mods kontext-anzeige (nur wenn gerade etwas sinnvoll ist)
#
# Eingabe: das JSON, das Claude Code auf stdin gibt. Cache-Restzeit, Trefferquote, Compact-Schwelle
# und Hinweis kommen aus ~/.claude/kontext-anzeige/<session_id>.json (Mod kontext-anzeige); fehlt
# die Datei, zeigt die Zeile die Cache-Quote der letzten Anfrage aus dem JSON.
# Eingerichtet in ~/.claude/settings.json unter "statusLine" (refreshInterval 30 s).
# Läuft auch unter Windows mit Git-Bash (jq und gawk nötig); dort heißt die Datei statusline-command.sh.

input=$(cat)

# ---------- alle Felder mit einem jq-Aufruf ----------
IFS=$'\x1f' read -r cwd project_dir model effort used_pct window in_tok cache_read cache_write \
    cost added removed five five_reset week week_reset session_id < <(
    printf '%s' "$input" | jq -r '[
        (.workspace.current_dir // .cwd // ""),
        (.workspace.project_dir // ""),
        (.model.display_name // .model.id // "Claude"),
        (.effort.level // ""),
        (.context_window.used_percentage // 0),
        (.context_window.context_window_size // 0),
        (.context_window.current_usage.input_tokens // 0),
        (.context_window.current_usage.cache_read_input_tokens // 0),
        (.context_window.current_usage.cache_creation_input_tokens // 0),
        (.cost.total_cost_usd // 0),
        (.cost.total_lines_added // 0),
        (.cost.total_lines_removed // 0),
        (.rate_limits.five_hour.used_percentage // ""),
        (.rate_limits.five_hour.resets_at // ""),
        (.rate_limits.seven_day.used_percentage // ""),
        (.rate_limits.seven_day.resets_at // ""),
        (.session_id // "")
    ] | map(tostring) | join("\u001f")' | tr -d '\r'
)

now=$(date +%s)
[ -z "$cwd" ] && cwd=$PWD
[ -z "$project_dir" ] && project_dir=$cwd

# ---------- Limits merken: eine neue Sitzung kennt sie erst nach der ersten Antwort ----------
limits_cache="$HOME/.claude/statusline-limits.cache"
if [ -n "$five$week" ]; then
    printf '%s\n%s\n%s\n%s\n' "$five" "$five_reset" "$week" "$week_reset" > "$limits_cache" 2>/dev/null
elif [ -f "$limits_cache" ]; then
    { read -r five; read -r five_reset; read -r week; read -r week_reset; } < "$limits_cache"
    case "$five_reset" in ''|*[!0-9]*) ;; *) [ "$five_reset" -le "$now" ] && five=0 ;; esac
    case "$week_reset" in ''|*[!0-9]*) ;; *) [ "$week_reset" -le "$now" ] && week=0 ;; esac
fi

# ---------- Werte des Mods ----------
mod_datei="$HOME/.claude/kontext-anzeige/$session_id.json"
mod_letzte="" mod_ttl="" mod_treffer="" mod_ac="" mod_arbeitet="" hint_stufe="" hint_text=""
if [ -n "$session_id" ] && [ -f "$mod_datei" ]; then
    IFS=$'\x1f' read -r mod_letzte mod_ttl mod_treffer mod_ac mod_arbeitet hint_stufe hint_text < <(
        jq -r '[
            (.cache.letzteAntwortAm // ""), (.cache.ttlSek // ""), (.cache.treffer // ""),
            (.autoCompactAb // ""), (.arbeitet // false), (.hinweis.stufe // ""), (.hinweis.text // "")
        ] | map(tostring) | join("\u001f")' "$mod_datei" 2>/dev/null | tr -d '\r'
    )
fi
# alte Dateien des Mods gelegentlich wegräumen
[ $((RANDOM % 200)) -eq 0 ] && find "$HOME/.claude/kontext-anzeige" -name '*.json' -mtime +3 -delete 2>/dev/null

# ---------- Git ----------
repo=$(basename "$project_dir")
branch=""
if top=$(git -C "$cwd" --no-optional-locks rev-parse --show-toplevel 2>/dev/null); then
    repo=$(basename "$top")
    branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null \
        || git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
fi

# ---------- Zusammenbau in einem awk-Lauf ----------
awk -v repo="$repo" -v branch="$branch" -v model="$model" -v effort="$effort" \
    -v pct="$used_pct" -v window="$window" -v in_tok="$in_tok" -v cread="$cache_read" -v cwrite="$cache_write" \
    -v cost="$cost" -v added="$added" -v removed="$removed" \
    -v five="$five" -v five_reset="$five_reset" -v week="$week" -v week_reset="$week_reset" \
    -v now="$now" -v letzte="$mod_letzte" -v ttl="$mod_ttl" -v treffer="$mod_treffer" -v ac="$mod_ac" \
    -v arbeitet="$mod_arbeitet" -v hstufe="$hint_stufe" -v htext="$hint_text" '
function rgb(p,   t, r, g, b) {          # 0..100 -> grün (0,200,80) -> gelb (220,200,0) -> rot (220,40,20)
    if (p < 0) p = 0; if (p > 100) p = 100
    if (p <= 50) { t = p / 50; r = t * 220; g = 200; b = 80 - t * 80 }
    else         { t = (p - 50) / 50; r = 220; g = 200 - t * 160; b = t * 20 }
    return sprintf("\033[38;2;%d;%d;%dm", r, g, b)
}
function kurz(n) {                        # 950, 4.2k, 124k, 1M
    if (n >= 1000000) return sprintf("%gM", int(n / 100000) / 10)
    if (n >= 10000)   return sprintf("%dk", n / 1000 + 0.5)
    if (n >= 1000)    return sprintf("%.1fk", n / 1000)
    return n
}
function dauer(s) { return s >= 60 ? sprintf("%dm", s / 60 + 0.5) : sprintf("%ds", s) }
function uhr(e) { return e ~ /^[0-9]+$/ ? strftime("%H:%M", e) : "" }
BEGIN {
    R = "\033[0m"; DIM = "\033[38;2;110;110;110m"; DUNKEL = "\033[38;2;60;60;60m"
    GELB = "\033[1;38;2;255;215;0m"; CYAN = "\033[1;38;2;0;255;255m"; MAG = "\033[1;38;2;200;0;200m"
    GRUEN = "\033[38;2;0;200;80m"; ROT = "\033[38;2;220;40;20m"; WARN = "\033[1;38;2;255;170;0m"
    SEP = " " DIM "│" R " "

    line = GELB "📁 " repo R
    if (branch != "") line = line SEP CYAN "🌿 " branch R
    line = line SEP MAG "🤖 " model R (effort != "" ? DIM " · " effort R : "")

    # Kontext: 20 Blöcke mit Farbverlauf, Emoji nach Füllstand
    p = int(pct + 0.5); voll = int(pct / 100 * 20 + 0.5); bar = ""
    for (i = 1; i <= 20; i++) bar = bar (i <= voll ? rgb(i * 5) "█" : DUNKEL "█") R
    emoji = p < 20 ? "🟢" : p < 70 ? "⚡" : p < 90 ? "🔥" : "🚨"
    tok = in_tok + cread + cwrite
    ctx = bar " " emoji " \033[1m" rgb(p) p "%" R
    if (window > 0 && tok > 0) ctx = ctx DIM " " kurz(tok) "/" kurz(window) R
    if (ac != "" && tok > 0) { bis = ac - tok; ctx = ctx (bis > ac * 0.15 ? DIM " ⇢" kurz(bis) R : WARN " ⇢" (bis > 0 ? kurz(bis) : "Compact!") R) }
    line = line SEP ctx

    # Cache: Restzeit und Quote vom Mod, sonst die Quote der letzten Anfrage
    if (arbeitet == "true") cache = GRUEN "●" R " aktiv"
    else if (letzte != "" && ttl != "") {
        rest = letzte + ttl - now
        if (rest > 0) cache = (rest <= (ttl >= 3600 ? 300 : 60) ? WARN "● " dauer(rest) R : GRUEN "●" R " " dauer(rest))
        else cache = (tok >= 20000 ? WARN "○ kalt" R : DIM "○ kalt" R)
    }
    q = treffer != "" ? treffer : (tok > 0 ? int(100 * cread / tok + 0.5) : "")
    if (q != "") cache = cache (cache != "" ? " " : "") (q < 80 ? WARN : DIM) q "%" R
    if (cache != "") line = line SEP "💾 " cache

    # Limits: Sitzung (5 h) und Woche, Rücksetzzeit erst ab 80 %
    lim = ""
    if (five != "") { f = int(five + 0.5); lim = "🕔" "\033[1m" rgb(f) f "%" R (f >= 80 ? DIM " ↻" uhr(five_reset) R : "") }
    if (week != "") { w = int(week + 0.5); lim = lim (lim != "" ? " " : "") "📅" "\033[1m" rgb(w) w "%" R (w >= 80 ? DIM " ↻" uhr(week_reset) R : "") }
    if (lim != "") line = line SEP lim

    line = line SEP "\033[38;2;255;215;0m💰 " sprintf("$%.2f", cost) R
    if (added + removed > 0) line = line SEP GRUEN "+" added R " " ROT "-" removed R
    print line

    if (htext != "") print (hstufe == "warn" ? WARN "▲ " htext R : DIM "› " htext R)
}'
