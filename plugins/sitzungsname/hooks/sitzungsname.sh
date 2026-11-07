#!/usr/bin/env bash
# Hook für SessionStart und UserPromptSubmit: Der Sitzungsname beginnt immer mit dem Repo-Namen.
#   ohne Namen            -> Claudes automatischer Titel als "repo · Titel", bis dahin nur im Fenster "repo"
#   /rename test          -> beim nächsten Prompt "repo · test" (ersetzt also nichts)
#   schon "repo · test"   -> bleibt
# Läuft zweimal, siehe hooks.json: ohne Argument wartet Claude auf das Ergebnis und setzt den Namen,
# mit "fenster" läuft der Hook im Hintergrund und setzt den Fenstertitel ("Claude · <Name>").
# Das geht getrennt, weil terminaltitel.ps1 sonst jeden geänderten Titel lang den Prompt aufhielte.
#
# Jeder Prozess und jede Subshell kostet unter Git Bash auf Windows bei Last Sekunden, und auf einen
# UserPromptSubmit-Hook wartet die Eingabe: Hier deshalb nur eingebaute Mittel, wo es irgend geht
# (kein cat, tr, sed, git), im Normalfall ist jq der einzige Prozess. Braucht jq.
IFS= read -r -d '' in
if ! command -v jq >/dev/null 2>&1; then
    for d in "${LOCALAPPDATA:-}/Microsoft/WinGet/Links" "$HOME/AppData/Local/Microsoft/WinGet/Links"; do
        [ -x "$d/jq.exe" ] && { PATH="$PATH:$d"; break; }
    done
fi
command -v jq >/dev/null 2>&1 || exit 0

IFS=$'\x1f' read -r ereignis alt cwd sitzung verlauf < <(
    jq -r '[.hook_event_name // "", .session_title // "", .cwd // "", .session_id // "", .transcript_path // ""] | join("\u001f")' <<<"$in"
)
verlauf=${verlauf%$'\r'}
ordner=${CLAUDE_PROJECT_DIR:-$cwd}
[ -n "$ordner" ] || exit 0

# Wurzel des Repos: der nächste Ordner aufwärts mit .git (bei Worktrees eine Datei), sonst der Ordner selbst
d=${ordner//\\//}
d=${d%/}
top=$d
while [ -n "$d" ]; do
    if [ -e "$d/.git" ]; then top=$d; break; fi
    case "$d" in */*) d=${d%/*} ;; *) d= ;; esac
done
repo=${top##*/}
[ -n "$repo" ] || exit 0

case "$alt" in
    '')
        # Noch kein eigener Name: Claudes automatischen Titel übernehmen. Der entsteht aus dem
        # ersten Prompt und steht danach im Verlauf, greift hier also ab dem zweiten Prompt.
        # Beim Start darf der Hook keinen Namen setzen, sonst erzeugt Claude gar keinen Titel.
        ki=""
        zeilen=""
        [ -f "$verlauf" ] && zeilen=$(grep -a '"type":"ai-title"' "$verlauf")
        if [ -n "$zeilen" ]; then
            ki=$(jq -r '.aiTitle // empty' <<<"${zeilen##*$'\n'}" 2>/dev/null)
            ki=${ki%$'\r'}
        fi
        if [ -n "$ki" ]; then neu="$repo · $ki"; else neu=$repo; fi ;;
    "$repo"|"$repo · "*) neu=$alt ;;
    *)                 neu="$repo · $alt" ;;
esac

if [ "${1:-}" = fenster ]; then
    # Fenstertitel, nur unter Windows; beim Start immer, sonst nur, wenn er sich geändert hat.
    # cygpath, weil MSYS_NO_PATHCONV=1 /c/... sonst unübersetzt durchlässt.
    command -v cygpath >/dev/null 2>&1 || exit 0
    if command -v pwsh >/dev/null 2>&1; then ps=pwsh
    elif command -v powershell >/dev/null 2>&1; then ps=powershell
    else exit 0
    fi
    marke_dir="$HOME/.claude/sitzungsname"
    marke="$marke_dir/$sitzung.titel"
    vorher=""
    [ -f "$marke" ] && IFS= read -r vorher < "$marke"
    if [ "$ereignis" = SessionStart ] || [ "$vorher" != "$neu" ]; then
        [ -d "$marke_dir" ] || mkdir -p "$marke_dir" 2>/dev/null
        "$ps" -NoProfile -File "$(cygpath -m "${0%/*}/terminaltitel.ps1")" -Titel "Claude · $neu" </dev/null >/dev/null 2>&1
        printf '%s' "$neu" > "$marke" 2>/dev/null
        [ $((RANDOM % 200)) -eq 0 ] && find "$marke_dir" -name '*.titel' -mtime +14 -delete 2>/dev/null
    fi
    exit 0
fi

# Der blanke Repo-Name wird nie gesetzt: Er würde Claudes automatischen Titel verhindern.
{ [ "$neu" = "$alt" ] || [ "$neu" = "$repo" ]; } && exit 0
jq -n --arg e "$ereignis" --arg t "$neu" '{hookSpecificOutput:{hookEventName:$e,sessionTitle:$t}}'
