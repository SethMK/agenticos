#!/usr/bin/env bash
# Stop hook — enforce cross_window QA token self-report on AgenticOS done-messages.
#
# Per S102 acceptance: when the final assistant turn echoes a story ID
# (format `story: S<NNN>`) and the PMO story front-matter at
# ~/Projects/personal/202605_AgenticOS_PMO/stories/S<NNN>-*.md has
# `cross_window: true`, the turn MUST contain the token self-report line
# `implementer total_tokens_k: X · QA total_tokens_k: Y · wall_min: Z`.
# Missing → exit 2 + stderr message (blocking). Otherwise silent exit 0.
#
# Label-parity: `cross_window` (underscore) — matches PMO story YAML field.

set -u

INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# Extract last assistant turn text (concat of all text-type content blocks)
LAST_TURN=$(jq -rs '
  map(select(.type == "assistant"))
  | (last // {})
  | (.message.content // [])
  | map(select(.type == "text") | .text)
  | join("\n")
' "$TRANSCRIPT" 2>/dev/null)

if [ -z "$LAST_TURN" ]; then
  exit 0
fi

# Story ID inference — match `story: S<NNN>` (case-insensitive)
STORY_ID=$(printf '%s' "$LAST_TURN" \
  | grep -oEi 'story:[[:space:]]*S[0-9]{2,4}' \
  | head -1 \
  | grep -oE 'S[0-9]{2,4}')

if [ -z "$STORY_ID" ]; then
  exit 0
fi

# Locate PMO story file
PMO_STORIES="${HOME}/Projects/personal/202605_AgenticOS_PMO/stories"
STORY_FILE=$(ls "$PMO_STORIES"/"${STORY_ID}"-*.md 2>/dev/null | head -1)
if [ -z "$STORY_FILE" ] || [ ! -f "$STORY_FILE" ]; then
  exit 0
fi

# Parse YAML front-matter for cross_window field (between first and second `---`)
CROSS=$(awk '
  /^---[[:space:]]*$/ { f++; if (f==2) exit; next }
  f==1 && /^cross_window:[[:space:]]*/ {
    sub(/^cross_window:[[:space:]]*/, "", $0)
    sub(/[[:space:]]*$/, "", $0)
    print $0
    exit
  }
' "$STORY_FILE")

if [ "$CROSS" != "true" ]; then
  exit 0
fi

# cross_window=true — enforce self-report pattern
# Pattern: implementer total_tokens_k: <int> · QA total_tokens_k: <int> · wall_min: <int>
if printf '%s' "$LAST_TURN" | grep -qE 'implementer total_tokens_k: [0-9]+ · QA total_tokens_k: [0-9]+ · wall_min: [0-9]+'; then
  exit 0
fi

cat >&2 <<EOF
STOP HOOK FAIL: cross-window story ${STORY_ID} missing mandatory token self-report. Add: implementer total_tokens_k: X · QA total_tokens_k: Y · wall_min: Z
EOF
exit 2
