#!/usr/bin/env bash
# PostToolUse hook — fires after Edit|Write on data/pipeline/*.ts files.
# Rebuilds data/snapshots/public.json + validates schema.
#
# CLAUDE_TOOL_INPUT_FILE_PATH is the edited path (set by Claude Code harness).
# Non-blocking on rebuild — logs to /tmp/agenticos-pipeline.log.
# Blocks turn (exit 2) ONLY on jq schema failure (per CLAUDE.md "public.json must parse with jq" rule).

set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/marcinkokott/Projects/personal/202605_AgenticOS}"
TARGET="${CLAUDE_TOOL_INPUT_FILE_PATH:-}"

# Only act on data/pipeline/*.ts edits
case "$TARGET" in
  *data/pipeline/*.ts) ;;
  *) exit 0 ;;
esac

cd "$REPO_ROOT" || exit 0

# Best-effort rebuild — script name may vary; fall back to common bun invocations
LOG=/tmp/agenticos-pipeline.log
{
  echo "=== post-pipeline-edit @ $(date -Iseconds) ==="
  echo "Trigger: $TARGET"
  if bun run pipeline:rebuild 2>&1; then
    :
  elif bun run pipeline 2>&1; then
    :
  else
    echo "WARN: no pipeline:rebuild or pipeline script in package.json — skipping"
  fi
} > "$LOG" 2>&1

# Validate snapshot regardless of rebuild outcome
if [ -f "$REPO_ROOT/data/snapshots/public.json" ]; then
  if ! jq -e '.totals and .counts and .daily' "$REPO_ROOT/data/snapshots/public.json" > /dev/null 2>&1; then
    cat <<EOF >&2
{"continue": false, "reason": "data/snapshots/public.json missing required fields (.totals .counts .daily) after pipeline edit. See /tmp/agenticos-pipeline.log for rebuild output."}
EOF
    exit 2
  fi
fi

exit 0
