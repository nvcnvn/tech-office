#!/usr/bin/env bash
# Run a sequence of claude prompts over every task listed in a YAML file,
# unattended. Defaults to the speckit workflow (specify -> plan -> tasks ->
# implement); any other sequence works:
#
#   steps:
#     - "/speckit-specify {}"          # {} is replaced by the task text
#     - "/speckit-implement"
#   tasks:
#     - "the first thing to build"
#
# A file with no `steps:`/`tasks:` keys is read as a plain list of tasks run
# through the default speckit steps, which is the original format.
#
#   scripts/speckit-auto.sh [features.yaml] [--dry-run|--status]
#   scripts/speckit-auto.sh --done=9:specs/009-foo   # adopt work done by hand
#
# --status prints a tick per finished step, and is safe to run while a run is
# in progress. Progress lives in .specify/auto/, keyed by position in the file:
# never comment out or delete a finished task, append new ones at the end.
#
# Follow a running step:
#   tail -f .specify/auto/logs/2-implement.log |
#     jq -r --unbuffered '.message.content[]? | .text // ("· " + (.name // ""))'
#
# Resumable: each finished step drops a marker in .specify/auto/, so re-running
# skips what already completed. On a quota block the script sleeps until the
# reset time printed by the CLI and retries the same step, so it can be left
# running overnight.
set -uo pipefail

# Server-side hiccups worth sitting out. Anchored on "API Error:" so that a
# step merely writing about error handling cannot look like one.
TRANSIENT_RE='API Error: (429|5[0-9]{2})|ECONNRESET|ETIMEDOUT|fetch failed'

# Epoch at which a blocked window reopens, or empty when the step was not
# blocked. Read ONLY from the structured rate_limit_event: this repo's own
# domain language is "storage quota exceeded", so any prose match turns a
# successful step into a fake block. The one text fallback is the CLI's exact
# product string, which prose does not produce.
quota_reset() {
    local log="$1" reset
    reset=$(jq -r 'select(.type == "rate_limit_event")
                   | .rate_limit_info
                   | select(.status != "allowed")
                   | .resetsAt // empty' "$log" 2>/dev/null | tail -1)
    [ -z "$reset" ] && reset=$(grep -oE 'usage limit reached\|[0-9]{10,13}' "$log" |
                               tail -1 | grep -oE '[0-9]{10,13}')
    printf '%s' "${reset:0:10}"
}

# Seconds to sleep before retrying, given that reset epoch and the current one.
# Clamped: a garbage timestamp must not park the run for years.
quota_wait() {
    local reset="${1:0:10}" now="$2" wait=1800
    case "$reset" in ''|*[!0-9]*) reset="" ;; esac
    [ -n "$reset" ] && [ "$reset" -gt "$now" ] && wait=$((reset - now + 60))
    [ "$wait" -gt 21600 ] && wait=1800    # more than six hours is not a real window
    [ "$wait" -lt 60 ] && wait=60
    echo "$wait"
}

# Items under `key:` in a YAML file, quotes stripped. An empty key means every
# top-level `- item` in the file, which is the original single-list format.
yaml_list() {
    awk -v key="$1:" '
        /^[^[:space:]#-]/ { inblock = (key != ":" && $1 == key); next }
        /^[[:space:]]*-/  { if (inblock || key == ":") {
                                sub(/^[[:space:]]*-[[:space:]]*/, ""); print } }
    ' "$2" 2>/dev/null | sed 's/^"\(.*\)"$/\1/; s/^'\''\(.*\)'\''$/\1/'
}

# Marker filename for a step prompt. `/speckit-plan` keeps its historical name
# so runs started before steps became free-form still resume.
step_name() {
    local n
    n=$(printf '%s' "$1" | tr -cs 'A-Za-z0-9' '-' | cut -c1-60)
    n="${n#-}"; n="${n%-}"
    printf '%s' "${n#speckit-}"
}

# scripts/speckit-auto.sh --self-test
if [ "${1:-}" = "--self-test" ]; then
    now=1700000000
    tmp=$(mktemp)
    [ "$(quota_wait 1700003600 $now)" = 3660 ]        || { echo "FAIL epoch"; exit 1; }
    [ "$(quota_wait 1700003600000 $now)" = 3660 ]     || { echo "FAIL millis"; exit 1; }
    [ "$(quota_wait '' $now)" = 1800 ]                || { echo "FAIL no stamp"; exit 1; }
    [ "$(quota_wait 1699000000 $now)" = 1800 ]        || { echo "FAIL stale"; exit 1; }
    [ "$(quota_wait 2026082409 $now)" = 1800 ]        || { echo "FAIL absurd window not clamped"; exit 1; }

    # A successful step whose output talks about storage quota, and whose text
    # carries a migration timestamp, is not a block.
    cat > "$tmp" <<'FIX'
{"type":"assistant","message":{"content":[{"type":"text","text":"storage quota exceeded for tenant; see 20260824090000_creator_billing.up.sql"}]}}
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1700003600,"overageStatus":"rejected"}}
{"type":"result","subtype":"success","is_error":false}
FIX
    [ -z "$(quota_reset "$tmp")" ] || { echo "FAIL healthy run read as a block"; exit 1; }

    printf '%s\n' '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1700003600}}' > "$tmp"
    [ "$(quota_reset "$tmp")" = 1700003600 ] || { echo "FAIL blocked event not detected"; exit 1; }

    printf '%s\n' 'Claude AI usage limit reached|1700003600' > "$tmp"
    [ "$(quota_reset "$tmp")" = 1700003600 ] || { echo "FAIL text fallback"; exit 1; }
    printf '%s\n' 'API Error: 529 Overloaded. This is a server-side issue' > "$tmp"
    grep -qE "$TRANSIENT_RE" "$tmp" || { echo "FAIL 529 not treated as transient"; exit 1; }
    printf '%s\n' 'the handler returns a 500 error when the upload fails' > "$tmp"
    grep -qE "$TRANSIENT_RE" "$tmp" && { echo "FAIL prose read as transient"; exit 1; }

    [ "$(step_name '/speckit-plan')" = plan ]            || { echo "FAIL step name compat"; exit 1; }
    [ "$(step_name '/speckit-specify {}')" = specify ]   || { echo "FAIL step name arg"; exit 1; }
    [ "$(step_name 'review the diff')" = review-the-diff ] || { echo "FAIL step name prose"; exit 1; }

    cat > "$tmp" <<'YML'
steps:
  - "/speckit-specify {}"
  - /speckit-implement
tasks:
  - "first task"
  - 'second task'
YML
    [ "$(yaml_list steps "$tmp" | wc -l)" -eq 2 ]        || { echo "FAIL steps block"; exit 1; }
    [ "$(yaml_list tasks "$tmp" | head -1)" = "first task" ] || { echo "FAIL tasks block"; exit 1; }
    [ "$(yaml_list '' "$tmp" | wc -l)" -eq 4 ]           || { echo "FAIL flat list"; exit 1; }
    printf -- '- "only task"\n' > "$tmp"
    [ -z "$(yaml_list steps "$tmp")" ]                   || { echo "FAIL old format has no steps"; exit 1; }
    [ "$(yaml_list '' "$tmp")" = "only task" ]           || { echo "FAIL old format tasks"; exit 1; }
    rm -f "$tmp"
    echo "self-test ok"
    exit 0
fi

FEATURES_FILE="features.yaml"
DRY_RUN=false
STATUS=false
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --status)  STATUS=true; DRY_RUN=true ;;
        --done=*)  DONE="${arg#--done=}" ;;
        *) FEATURES_FILE="$arg" ;;
    esac
done

ROOT="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Markers are keyed by position, so a second job file would collide with the
# first one's progress. Give every job file but the original its own state dir.
STATE="$ROOT/.specify/auto"
[ "$(basename "$FEATURES_FILE")" = features.yaml ] ||
    STATE="$STATE-$(printf '%s' "$(basename "$FEATURES_FILE")" | tr -cs 'A-Za-z0-9' '-')"
mkdir -p "$STATE/logs"

# Two concurrent runs would race on .specify/feature.json and hand a step the
# wrong feature. mkdir is atomic, so it makes a usable lock.
if [ "$DRY_RUN" = false ]; then
    mkdir "$STATE/lock" 2>/dev/null || {
        echo "[auto] another run holds $STATE/lock — wait for it, or rmdir the lock if it is stale" >&2
        exit 1
    }
    trap 'rmdir "$STATE/lock" 2>/dev/null' EXIT

    # Each task ends in `git add -A`, so anything already uncommitted here would
    # be swept into that task's commit. Start clean, or say ALLOW_DIRTY=1.
    if [ "${ALLOW_DIRTY:-0}" != 1 ] && [ -z "${DONE:-}" ] &&
       [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
        echo "[auto] the working tree has uncommitted changes; they would land in the" >&2
        echo "       first task's commit. Commit or stash them, or set ALLOW_DIRTY=1." >&2
        exit 1
    fi
fi

# One prompt per line, `{}` replaced by the task text. From `steps:` in the job
# file, or from $STEPS to run part of a workflow (STEPS=specify still works: a
# bare word is shorthand for /speckit-<word>). Markers are per step, so a later
# full run picks up whatever was skipped.
STEPS="${STEPS:-$(yaml_list steps "$FEATURES_FILE")}"
[ -n "$STEPS" ] || STEPS='/speckit-specify {}
/speckit-plan
/speckit-tasks
/speckit-implement'
case "$STEPS" in */*) ;; *) STEPS=$(printf '%s\n' $STEPS) ;; esac      # old word-list form

# Markers are named after the step, so two steps that reduce to the same name
# would silently skip each other.
if [ "$(printf '%s\n' "$STEPS" | while IFS= read -r p; do step_name "$p"; echo; done | sort -u | wc -l)" \
     -ne "$(printf '%s\n' "$STEPS" | grep -c .)" ]; then
    echo "[auto] two steps share a marker name — make their first 60 characters differ" >&2
    exit 1
fi

# Nobody is at the keyboard: decide instead of asking, and leave the decision
# in writing so it can be reviewed in the morning.
AUTONOMY="This is an unattended overnight run. Never stop to ask the user a \
question and never wait for input or approval. When something is ambiguous or \
underspecified, pick the option a senior engineer following the project's \
existing conventions and industry best practice would pick, and keep going. \
Resolve every [NEEDS CLARIFICATION] marker yourself with that default instead \
of presenting options; record each choice in the artifact you are writing as \
'[ASSUMPTION: <what you assumed and why>]' so it can be reviewed later. Only \
stop if continuing would destroy data or the task is literally impossible, and \
say plainly what blocked you."

# Task list: `tasks:` if the file uses keys, else every top-level `- item`.
FEATURES=()
while IFS= read -r line; do
    case "$line" in ""|-*) continue ;; esac        # skip blanks and `---`
    FEATURES+=("$line")
done < <(yaml_list tasks "$FEATURES_FILE" | grep . || yaml_list '' "$FEATURES_FILE")

[ ${#FEATURES[@]} -gt 0 ] || { echo "No tasks found in $FEATURES_FILE" >&2; exit 1; }

# Adopt work done by hand: --done=9 marks every step of task 9 finished, and
# --done=9:specs/009-foo also pins the directory later steps resume into. Pair
# it with STEPS to adopt part of a workflow, e.g.
#   STEPS="specify plan tasks" scripts/speckit-auto.sh --done=9:specs/009-foo
# leaves implement to the next ordinary run.
if [ -n "${DONE:-}" ]; then
    n="${DONE%%:*}"
    dir=""; case "$DONE" in *:*) dir="${DONE#*:}" ;; esac
    case "$n" in ''|*[!0-9]*) echo "[auto] --done needs a task number" >&2; exit 1 ;; esac
    [ "$n" -ge 1 ] && [ "$n" -le "${#FEATURES[@]}" ] ||
        { echo "[auto] $FEATURES_FILE has no task $n" >&2; exit 1; }
    [ -z "$dir" ] || [ -d "$ROOT/$dir" ] || [ -d "$dir" ] ||
        { echo "[auto] no such directory: $dir" >&2; exit 1; }
    slot="$STATE/$(printf '%02d' "$n")"
    printf '%s' "${FEATURES[$((n - 1))]}" > "$slot.desc"
    [ -n "$dir" ] && printf '%s\n' "$dir" > "$slot.dir"
    while IFS= read -r p <&3; do
        [ -n "$p" ] && touch "$slot.$(step_name "$p").done"
    done 3<<< "$STEPS"
    echo "[auto] task $n marked done for: $(printf '%s\n' "$STEPS" |
        while IFS= read -r p; do printf '%s ' "$(step_name "$p")"; done)"
    [ -n "$dir" ] && echo "[auto] task $n pinned to $dir"
    exit 0
fi

# Run one claude prompt, waiting out quota blocks until it gets through.
# The log is overwritten (not appended) on every attempt, so the quota check
# below only ever sees the current attempt's output.
run_claude() {
    local prompt="$1" log="$2" rc limit now wait tries=0 soft=0
    while :; do
        echo "[auto] $prompt"
        $DRY_RUN && return 0
        # stream-json + --verbose is the only combination that writes as it
        # goes; with the default text format a step that runs for an hour
        # produces nothing until it exits. The stream lands in the step log,
        # leaving run.log a clean timeline of steps.
        claude -p "$prompt" \
            --output-format stream-json --verbose \
            --dangerously-skip-permissions \
            --append-system-prompt "$AUTONOMY" \
            --disallowed-tools AskUserQuestion \
            > "$log" 2>&1
        rc=$?

        # Checked regardless of exit code: a blocked window is sometimes
        # delivered as an ordinary result rather than an error.
        limit=$(quota_reset "$log")
        if [ -z "$limit" ]; then
            # A 529/500 or a dropped connection is the server having a bad
            # minute, not a reason to abandon a step that is hours deep.
            if [ "$rc" -ne 0 ] && grep -qE "$TRANSIENT_RE" "$log"; then
                soft=$((soft + 1))
                if [ "$soft" -gt 5 ]; then
                    echo "[auto] $soft transient API failures in a row, giving up" >&2
                    return "$rc"
                fi
                wait=$((soft * 120))
                echo "[auto] transient API error, retrying in ${wait}s (attempt $soft)" >&2
                sleep "$wait"
                continue
            fi
            return "$rc"
        fi

        tries=$((tries + 1))
        if [ "$tries" -gt 12 ]; then
            echo "[auto] still quota-blocked after $tries waits, giving up" >&2
            return 1
        fi

        now=$(date +%s)
        wait=$(quota_wait "$limit" "$now")
        echo "[auto] quota reached, sleeping ${wait}s (until $(date -r $((now + wait)) 2>/dev/null))" >&2
        sleep "$wait"
    done
}

i=0
for desc in "${FEATURES[@]}"; do
    i=$((i + 1))
    # ONLY=3 runs just the third feature, e.g. to watch one epic all the way
    # through before turning the rest loose.
    [ -n "${ONLY:-}" ] && [ "$i" != "$ONLY" ] && continue
    slot="$STATE/$(printf '%02d' "$i")"
    marks=""
    $STATUS || echo "=== [$i/${#FEATURES[@]}] $desc"
    # Markers are keyed by position, so inserting or reordering a line would
    # silently attach one feature's progress to another. Fail loudly instead.
    if [ -f "$slot.desc" ] && [ "$(cat "$slot.desc")" != "$desc" ]; then
        echo "[auto] feature $i is not the one that ran before — append new features to the end of" >&2
        echo "       $FEATURES_FILE, or delete $slot.* to run this line from scratch." >&2
        exit 1
    fi
    $DRY_RUN || printf '%s' "$desc" > "$slot.desc"
    # fd 3, so the step list is not sitting on claude's stdin.
    while IFS= read -r prompt <&3; do
        [ -n "$prompt" ] || continue
        case "$prompt" in
            specify)  prompt='/speckit-specify {}' ;;   # shorthand carries the task text
            /*|*\ *) ;;
            *)        prompt="/speckit-$prompt" ;;
        esac
        step=$(step_name "$prompt")
        if $STATUS; then
            [ -f "$slot.$step.done" ] && marks="$marks[x]" || marks="$marks[ ]"
            continue
        fi
        [ -f "$slot.$step.done" ] && continue
        prompt="${prompt//\{\}/$desc}"
        case "$prompt" in
            /*specify*) unset SPECIFY_FEATURE_DIRECTORY ;;   # any spelling of the specify command
            # Pin later speckit steps to the directory specify created, so a
            # resume never picks up whatever feature.json happens to hold —
            # which, with no specify step in the run, is some other feature.
            *) if [ -s "$slot.dir" ]; then
                   export SPECIFY_FEATURE_DIRECTORY="$(cat "$slot.dir")"
               else
                   unset SPECIFY_FEATURE_DIRECTORY
                   echo "[auto] no feature directory recorded for task $i: '$step' will use" >&2
                   echo "       .specify/feature.json ($(jq -r .feature_directory "$ROOT/.specify/feature.json" 2>/dev/null))" >&2
               fi ;;
        esac
        run_claude "$prompt" "$STATE/logs/$i-$step.log" || {
            echo "[auto] step '$step' failed for task $i, see $STATE/logs/$i-$step.log" >&2
            exit 1
        }
        $DRY_RUN && continue
        case "$prompt" in /*specify*)
            [ -f "$ROOT/.specify/feature.json" ] &&
                jq -r .feature_directory "$ROOT/.specify/feature.json" > "$slot.dir" ;;
        esac
        touch "$slot.$step.done"
    done 3<<< "$STEPS"
    $STATUS && { printf '%2d %s %.60s\n' "$i" "$marks" "$desc"; continue; }

    # One commit per epic, so an overnight run leaves a history that can be
    # reviewed and reverted epic by epic instead of one undifferentiated pile.
    # Steps sometimes commit their own work, in which case there is nothing
    # left here and this is a no-op.
    if [ "$DRY_RUN" = false ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
        git -C "$ROOT" add -A
        git -C "$ROOT" commit -q -F - <<COMMIT
Epic $i: $(printf '%s' "${desc%%:*}" | cut -c1-60)

$desc

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
COMMIT
        echo "[auto] committed epic $i: $(git -C "$ROOT" log --oneline -1)"
    fi
done
$STATUS && printf '   %s\n' "$(printf '%s\n' "$STEPS" | while IFS= read -r p; do
    printf '%s ' "$(step_name "$p")"; done)"
$STATUS || echo "[auto] all tasks done"
