#!/usr/bin/env bash
# SessionStart hook — auto-load PMO sprint state + verify-log tail + in-progress
# story IDs so the AgenticOS orchestrator does not re-grep these on fresh sessions.
#
# Output goes to stdout — Claude Code attaches as a system reminder.

set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/marcinkokott/Projects/personal/202605_AgenticOS}"
PMO_ROOT="${PMO_ROOT:-$REPO_ROOT/../202605_AgenticOS_PMO}"

echo "## AgenticOS session context (auto-injected)"
echo ""

# Current sprint from sibling PMO
CURRENT_SPRINT=$(ls -t "$PMO_ROOT"/ceremonies/sprints/*.md 2>/dev/null | head -1)
if [ -n "$CURRENT_SPRINT" ]; then
  echo "**PMO sprint:** $(basename "$CURRENT_SPRINT") · sprint_status=$(awk '/^sprint_status:/ {print $2; exit}' "$CURRENT_SPRINT")"
else
  echo "**PMO sprint:** none found"
fi

# In-progress story IDs from PMO export
IN_PROGRESS=$(jq -c '.columns.in_progress // []' "$PMO_ROOT/exports/public-board.json" 2>/dev/null || echo "[]")
echo "**In-progress (PMO):** $IN_PROGRESS"

# Last 5 verify-log rows
echo ""
echo "**Last 5 verify-log rows:**"
if [ -f "$REPO_ROOT/docs/verify-log.md" ]; then
  tail -5 "$REPO_ROOT/docs/verify-log.md"
else
  echo "(docs/verify-log.md not found)"
fi

# Snapshot last-built tally
if [ -f "$REPO_ROOT/data/snapshots/public.json" ]; then
  echo ""
  echo "**public.json totals:** $(jq -c '.totals' "$REPO_ROOT/data/snapshots/public.json" 2>/dev/null || echo 'parse-error')"
fi

exit 0
