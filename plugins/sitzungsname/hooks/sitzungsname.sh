#!/usr/bin/env bash
# Hook für SessionStart und UserPromptSubmit: Der Sitzungsname beginnt immer mit dem Repo-Namen.
#   ohne Namen            -> Claudes automatischer Titel als "repo · Titel", bis dahin nur im Fenster "repo"
#   /rename test          -> beim nächsten Prompt "repo · test" (ersetzt also nichts)
#   schon "repo · test"   -> bleibt
# Den Fenstertitel ("Claude · <Name>") setzt terminaltitel.ps1: beim Start immer, sonst nur,
# wenn er sich geändert hat, weil der Aufruf rund 4 Sekunden kostet. Braucht jq.
in=$(cat)
if ! command -v jq >/dev/null 2>&1; then
    for d in "${LOCALAPPDATA:-}/Microsoft/WinGet/Links" "$HOME/AppData/Local/Microsoft/WinGet/Links"; do
        [ -x "$d/jq.exe" ] && { PATH="$PATH:$d"; break; }
    done
fi
command -v jq >/dev/null 2>&1 || exit 0

IFS=$'\x1f' read -r ereignis alt cwd sitzung verlauf < <(
    printf '%s' "$in" | jq -r '[.hook_event_name // "", .session_title // "", .cwd // "", .session_id // "", .transcript_path // ""] | join("\u001f")' | tr -d '\r'
)
ordner=${CLAUDE_PROJECT_DIR:-$cwd}
[ -n "$ordner" ] || exit 0
top=$(git -C "$ordner" --no-optional-locks rev-parse --show-toplevel 2>/dev/null) || top=$ordner
repo=$(printf '%s' "$top" | tr '\134' '/' | sed 's#/*$##; s#.*/##')
[ -n "$repo" ] || exit 0

case "$alt" in
    '')
        # Noch kein eigener Name: Claudes automatischen Titel übernehmen. Der entsteht aus dem
        # ersten Prompt und steht danach im Verlauf, greift hier also ab dem zweiten Prompt.
        # Beim Start darf der Hook keinen Namen setzen, sonst erzeugt Claude gar keinen Titel.
        ki=""
        [ -f "$verlauf" ] && ki=$(grep -a '"type":"ai-title"' "$verlauf" | tail -1 | jq -r '.aiTitle // empty' 2>/dev/null | tr -d '\r')
        if [ -n "$ki" ]; then neu="$repo · $ki"; else neu=$repo; fi ;;
    "$repo"|"$repo · "*) neu=$alt ;;
    *)                 neu="$repo · $alt" ;;
esac

# Fenstertitel, nur unter Windows; cygpath, weil MSYS_NO_PATHCONV=1 /c/... sonst unübersetzt durchlässt
ps=$(command -v pwsh || command -v powershell)
if [ -n "$ps" ] && command -v cygpath >/dev/null 2>&1; then
    marke_dir="$HOME/.claude/sitzungsname"
    marke="$marke_dir/$sitzung.titel"
    mkdir -p "$marke_dir" 2>/dev/null
    if [ "$ereignis" = SessionStart ] || [ "$(cat "$marke" 2>/dev/null)" != "$neu" ]; then
        "$ps" -NoProfile -File "$(cygpath -m "$(dirname "$0")/terminaltitel.ps1")" -Titel "Claude · $neu" </dev/null >/dev/null 2>&1
        printf '%s' "$neu" > "$marke" 2>/dev/null
    fi
    [ $((RANDOM % 200)) -eq 0 ] && find "$marke_dir" -name '*.titel' -mtime +14 -delete 2>/dev/null
fi

# Der blanke Repo-Name wird nie gesetzt: Er würde Claudes automatischen Titel verhindern.
{ [ "$neu" = "$alt" ] || [ "$neu" = "$repo" ]; } && exit 0
jq -n --arg e "$ereignis" --arg t "$neu" '{hookSpecificOutput:{hookEventName:$e,sessionTitle:$t}}'
