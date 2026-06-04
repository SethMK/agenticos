#!/usr/bin/env bash
# Stop hook (S103) — validate data/snapshots/public.json schema when touched this session.
# Touched detection: compares file mtime to session-start epoch (from transcript first entry).
# Falls back to always-check if transcript unavailable.
# Coexists with S102 stop-cross-window-qa.sh.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${REPO_ROOT}/data/snapshots/public.json"

# Get session-start epoch from transcript (first JSONL entry's timestamp field)
INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

SESSION_START_EPOCH=0
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  # Extract earliest timestamp from transcript (first line with a ts field)
  TS_VAL=$(jq -r '.timestamp // empty' "$TRANSCRIPT" 2>/dev/null | head -1)
  if [ -n "$TS_VAL" ]; then
    SESSION_START_EPOCH=$(date -jf '%Y-%m-%dT%H:%M:%S' "${TS_VAL%.*}" '+%s' 2>/dev/null \
      || date -d "$TS_VAL" '+%s' 2>/dev/null || echo 0)
  fi
  # Fallback: use transcript file birth/modification time as session-start proxy
  if [ "$SESSION_START_EPOCH" -eq 0 ]; then
    SESSION_START_EPOCH=$(stat -f '%m' "$TRANSCRIPT" 2>/dev/null \
      || stat -c '%Y' "$TRANSCRIPT" 2>/dev/null || echo 0)
  fi
fi

# Check if public.json exists at all
if [ ! -f "$TARGET" ]; then
  # File doesn't exist — only fail if we expected it (session_start known, skip otherwise)
  exit 0
fi

# Compare file mtime to session start
FILE_MTIME=$(stat -f '%m' "$TARGET" 2>/dev/null || stat -c '%Y' "$TARGET" 2>/dev/null || echo 0)

if [ "$SESSION_START_EPOCH" -gt 0 ] && [ "$FILE_MTIME" -le "$SESSION_START_EPOCH" ]; then
  # File not touched this session — skip
  exit 0
fi

# File was touched (or session-start unknown → always validate)

# (a) valid JSON
if ! jq . "$TARGET" > /dev/null 2>&1; then
  echo "STOP HOOK FAIL: public.json schema invalid — not valid JSON. File state: ${TARGET}. Fix before next pipeline run." >&2
  exit 1
fi

# (b) required top-level keys present and non-null
if ! jq -e '.totals and .daily and .generated_at' "$TARGET" > /dev/null 2>&1; then
  MISSING=$(jq -r '
    [ if (.totals | not) or .totals == null then "totals" else empty end,
      if (.daily | not) or .daily == null then "daily" else empty end,
      if (.generated_at | not) or .generated_at == null then "generated_at" else empty end
    ] | join(", ")
  ' "$TARGET" 2>/dev/null || echo "totals/daily/generated_at")
  echo "STOP HOOK FAIL: public.json schema invalid — missing/null key(s): ${MISSING}. File state: ${TARGET}. Fix before next pipeline run." >&2
  exit 1
fi

# (c) totals.total_tokens is a positive number
if ! jq -e '.totals.total_tokens > 0' "$TARGET" > /dev/null 2>&1; then
  echo "STOP HOOK FAIL: public.json schema invalid — totals.total_tokens not a positive number. File state: ${TARGET}. Fix before next pipeline run." >&2
  exit 1
fi

exit 0
