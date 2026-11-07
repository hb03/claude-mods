#!/usr/bin/env bash
# Claude Code Statuszeile (unter der Eingabe): Repo, Zweig, Modell, Kontext, Cache, Limits, Kosten.
#
#   📁 repo │ 🌿 zweig │ 🤖 Modell · Aufwand │ ████████░░ ⚡ 42% 84k/200k ⇢763k │ ⏱ 3m Bash │ 💾 ● 48m 99% │ 🕔 8% 📅 2% │ 💰 $3.21 │ +120 -30
#   ▲ Hinweis des Mods kontext-anzeige (nur wenn gerade etwas sinnvoll ist)
#
# ⏱ = Zeit seit dem letzten Lebenszeichen (Stück der Antwort oder Werkzeug), dahinter das laufende
# Werkzeug. Arbeitet Claude und bleibt es still, wird die Anzeige gelb und rot.
#
# Eingabe: das JSON, das Claude Code auf stdin gibt. Cache-Restzeit, Trefferquote, Compact-Schwelle,
# Lebenszeichen und Hinweis kommen aus ~/.claude/kontext-anzeige/<session_id>.json (Mod kontext-anzeige);
# fehlt die Datei, zeigt die Zeile die Cache-Quote der letzten Anfrage aus dem JSON.
# Eingerichtet in ~/.claude/settings.json unter "statusLine" (refreshInterval 30 s).
# Läuft auch unter Windows mit Git-Bash (jq und gawk nötig); dort heißt die Datei statusline-command.sh.
#
# Die Zeile läuft alle 30 s in jeder Sitzung, und unter Git Bash kostet jeder Prozess und jede Subshell
# bei Last Sekunden: Deshalb nur eingebaute Mittel, wo es irgend geht (kein cat, date, tr, basename, git).
# Prozesse bleiben ein jq, ein mv und das awk für die Ausgabe.

IFS= read -r -d '' input

# Unter Windows liegt jq nach "winget install" nur im PowerShell-PATH (WinGet\Links), nicht im PATH
# der Git-Bash, mit der Claude Code dieses Skript startet. Den Ordner hier anhängen.
if ! command -v jq >/dev/null 2>&1; then
    for d in "${LOCALAPPDATA:-}/Microsoft/WinGet/Links" "$HOME/AppData/Local/Microsoft/WinGet/Links"; do
        [ -x "$d/jq.exe" ] && { PATH="$PATH:$d"; break; }
    done
fi

# Ohne jq bleibt alles leer: das klar sagen, statt eine halbe Zeile zu zeigen.
if ! command -v jq >/dev/null 2>&1; then
    echo "⚠ jq fehlt – Statuszeile nicht möglich (Windows: winget install jqlang.jq, jq.exe in einen Ordner im Git-Bash-PATH, z. B. ~/bin)"
    exit 0
fi

# ---------- alle Felder in einem jq-Aufruf, auch die des Mods ----------
# Die Datei des Mods geht als Text mit hinein: Ein halb geschriebener Stand darf nur ihre Werte kosten.
muster='"session_id"[[:space:]]*:[[:space:]]*"([^"]+)"'
mod_id=""
[[ $input =~ $muster ]] && mod_id=${BASH_REMATCH[1]}
mod_datei="$HOME/.claude/kontext-anzeige/$mod_id.json"
mod=""
[ -n "$mod_id" ] && [ -f "$mod_datei" ] && IFS= read -r -d '' mod < "$mod_datei"

IFS=$'\x1f' read -r cwd project_dir model effort used_pct window in_tok cache_read cache_write \
    cost added removed five five_reset week week_reset session_id session_name \
    mod_letzte mod_ttl mod_treffer mod_ac mod_arbeitet mod_aktiv mod_werkzeug hint_stufe hint_text < <(
    jq -Rrs 'split("\u001e") as $t | ($t[0] | fromjson) as $e | (try ($t[1] | fromjson) catch {}) as $m | [
        ($e.workspace.current_dir // $e.cwd // ""),
        ($e.workspace.project_dir // ""),
        ($e.model.display_name // $e.model.id // "Claude"),
        ($e.effort.level // ""),
        ($e.context_window.used_percentage // ""),
        ($e.context_window.context_window_size // 0),
        ($e.context_window.current_usage.input_tokens // 0),
        ($e.context_window.current_usage.cache_read_input_tokens // 0),
        ($e.context_window.current_usage.cache_creation_input_tokens // 0),
        ($e.cost.total_cost_usd // ""),
        ($e.cost.total_lines_added // 0),
        ($e.cost.total_lines_removed // 0),
        ($e.rate_limits.five_hour.used_percentage // ""),
        ($e.rate_limits.five_hour.resets_at // ""),
        ($e.rate_limits.seven_day.used_percentage // ""),
        ($e.rate_limits.seven_day.resets_at // ""),
        ($e.session_id // ""),
        ($e.session_name // ""),
        ($m.cache.letzteAntwortAm // ""), ($m.cache.ttlSek // ""), ($m.cache.treffer // ""),
        ($m.autoCompactAb // ""), ($m.arbeitet // false), ($m.aktivAm // ""), ($m.werkzeug // ""),
        ($m.hinweis.stufe // ""), ($m.hinweis.text // "")
    ] | map(tostring) | join("\u001f")' <<<"$input"$'\x1e'"$mod"
)
hint_text=${hint_text%$'\r'}

now=${EPOCHSECONDS:-}
[ -n "$now" ] || now=$(date +%s)
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

# alte Dateien des Mods gelegentlich wegräumen
[ $((RANDOM % 200)) -eq 0 ] && find "$HOME/.claude/kontext-anzeige" -name '*.json' -mtime +3 -delete 2>/dev/null

# ---------- Eingabe für die Web-App ablegen (claude-web zeigt sie in der Arbeitsansicht) ----------
stand_dir="$HOME/.claude/statusline-stand"
[ -n "$session_id" ] && { [ -d "$stand_dir" ] || mkdir -p "$stand_dir" 2>/dev/null; }
if [ -n "$session_id" ] && [ -d "$stand_dir" ]; then
    printf '%s' "$input" > "$stand_dir/$session_id.json.tmp" && mv -f "$stand_dir/$session_id.json.tmp" "$stand_dir/$session_id.json"
    [ $((RANDOM % 200)) -eq 0 ] && find "$stand_dir" -name '*.json' -mtime +3 -delete 2>/dev/null
fi

# ---------- Git ----------
# Direkt aus .git/HEAD: nächster Ordner aufwärts mit .git (bei Worktrees eine Datei, die auf das
# eigentliche Git-Verzeichnis zeigt). Ein "ref:" ist ein Zweig, sonst steht dort der Commit.
d=${project_dir//\\//}
d=${d%/}
repo=${d##*/}
branch=""
d=${cwd//\\//}
d=${d%/}
while [ -n "$d" ]; do
    if [ -e "$d/.git" ]; then
        repo=${d##*/}
        gitdir=$d/.git
        if [ -f "$gitdir" ]; then
            zeile=""
            { IFS= read -r zeile < "$gitdir"; } 2>/dev/null
            zeile=${zeile%$'\r'}
            gitdir=${zeile#gitdir: }
            case "$gitdir" in /*|?:*) ;; *) gitdir=$d/$gitdir ;; esac
        fi
        kopf=""
        { IFS= read -r kopf < "$gitdir/HEAD"; } 2>/dev/null
        kopf=${kopf%$'\r'}
        case "$kopf" in
            'ref: refs/heads/'*) branch=${kopf#ref: refs/heads/} ;;
            'ref: '*)            branch=${kopf#ref: } ;;
            *)                   branch=${kopf:0:7} ;;
        esac
        break
    fi
    case "$d" in */*) d=${d%/*} ;; *) d= ;; esac
done

# Sitzungsname (/rename) hinter das Repo; "repo · name" schreibt der Hook sitzungsname.sh selbst.
case "$session_name" in
    ''|"$repo") ;;
    *" · "*) repo=$session_name ;;
    *) repo="$repo · $session_name" ;;
esac

# ---------- Zusammenbau in einem awk-Lauf ----------
awk -v repo="$repo" -v branch="$branch" -v model="$model" -v effort="$effort" \
    -v pct="$used_pct" -v window="$window" -v in_tok="$in_tok" -v cread="$cache_read" -v cwrite="$cache_write" \
    -v cost="$cost" -v added="$added" -v removed="$removed" \
    -v five="$five" -v five_reset="$five_reset" -v week="$week" -v week_reset="$week_reset" \
    -v now="$now" -v letzte="$mod_letzte" -v ttl="$mod_ttl" -v treffer="$mod_treffer" -v ac="$mod_ac" \
    -v arbeitet="$mod_arbeitet" -v aktiv="$mod_aktiv" -v werkzeug="$mod_werkzeug" \
    -v hstufe="$hint_stufe" -v htext="$hint_text" '
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
function seit(s) {                        # Stand ist bis zu 30 s alt, Sekunden täuschen nur vor
    if (s < 60) return "<1m"
    if (s < 3600) return sprintf("%dm", s / 60)
    return sprintf("%dh", s / 3600)
}
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
    if (pct == "") {                      # noch kein Messwert (frisch nach /clear): keinen Füllstand erfinden
        bar = ""; for (i = 1; i <= 20; i++) bar = bar DUNKEL "█" R
        ctx = bar " " DIM "Kontext –" R
    }
    line = line SEP ctx

    # Letztes Lebenszeichen. Grenzen großzügig, die Werte können bis zu 60 s nachlaufen; ein langer
    # Befehl ist normal, Stille ohne Werkzeug nicht.
    if (aktiv != "") {
        still = now - aktiv; if (still < 0) still = 0
        farbe = DIM
        if (arbeitet == "true") {
            if (werkzeug != "") farbe = still >= 900 ? WARN : DIM
            else farbe = still >= 300 ? ROT : still >= 120 ? WARN : DIM
        }
        line = line SEP "⏱ " farbe seit(still) (arbeitet == "true" && werkzeug != "" ? " " werkzeug : "") R
    }

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

    line = line SEP (cost == "" ? DIM "💰 –" R : "\033[38;2;255;215;0m💰 " sprintf("$%.2f", cost) R)
    if (added + removed > 0) line = line SEP GRUEN "+" added R " " ROT "-" removed R
    print line

    if (htext != "") print (hstufe == "warn" ? WARN "▲ " htext R : DIM "› " htext R)
}'
