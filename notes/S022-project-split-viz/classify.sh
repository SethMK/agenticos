#!/usr/bin/env bash
# S022 — Project work/personal classifier
# ----------------------------------------------------------------------
# Filter reconciliation:
#   The dashboard's PROJECTS stat (33) is `new Set(priced.project_hash).size`
#   in data/pipeline/snapshot.ts. It counts project directories that produced
#   at least one billable assistant turn — i.e. an assistant record with
#   model != "<synthetic>" and a usage object. Raw `ls ~/.claude/projects`
#   yields 35 dirs at the time of writing (2026-05-11); two dirs exist on
#   disk but contributed zero billable assistant turns and are dropped at
#   aggregate-time. To match the dashboard exactly we read the snapshot's
#   own project list (ops.json) rather than re-walking the filesystem —
#   that way the classifier is in lockstep with what the page renders.
#
# Classification rule (per S022 brief):
#   Path containing the substring "-Users-marcinkokott-Projects-personal-"
#   → PERSONAL. Anything else → WORK.
#
# Output: prints PERSONAL <n> / WORK <n> / TOTAL <n>, and (with -v) the
# project list per bucket. Exit code 1 if total != 33 (drift detector).
#
# Usage:
#   ./classify.sh           # summary only
#   ./classify.sh -v        # verbose, list each project per bucket
# ----------------------------------------------------------------------

set -euo pipefail

VERBOSE=0
if [[ "${1:-}" == "-v" ]]; then VERBOSE=1; fi

REPO_ROOT="$(cd "$(dirname "$0")"/../.. && pwd)"
OPS="${REPO_ROOT}/data/snapshots/ops.json"

if [[ ! -f "$OPS" ]]; then
  echo "fatal: ${OPS} not found — run \`bun data/pipeline/snapshot.ts\` first" >&2
  exit 2
fi

# Pull the raw project names. ops.json is the version with un-redacted paths.
# Use a while-read loop so we stay compatible with macOS's bash 3.2 (no mapfile).
PERSONAL=()
WORK=()
while IFS= read -r n; do
  [[ -z "$n" ]] && continue
  if [[ "$n" == *"-Users-marcinkokott-Projects-personal-"* ]]; then
    PERSONAL+=("$n")
  else
    WORK+=("$n")
  fi
done < <(
  python3 -c "
import json, sys
with open('${OPS}') as f:
    data = json.load(f)
for p in data['projects']:
    print(p['name'])
"
)

TOTAL=$(( ${#PERSONAL[@]} + ${#WORK[@]} ))

echo "PERSONAL ${#PERSONAL[@]}"
echo "WORK     ${#WORK[@]}"
echo "TOTAL    ${TOTAL}"

if [[ $VERBOSE -eq 1 ]]; then
  echo
  echo "--- personal ---"
  for n in "${PERSONAL[@]}"; do echo "  $n"; done
  echo
  echo "--- work ---"
  for n in "${WORK[@]}"; do echo "  $n"; done
fi

# Drift guard: the PROJECTS stat card shows 33. If reconciliation breaks
# (e.g. the synthetic-filter changes, or a new path pattern shows up),
# fail loudly rather than silently shipping a wrong split.
if [[ $TOTAL -ne 33 ]]; then
  echo "WARN: total=${TOTAL} but PROJECTS stat card expects 33 — investigate." >&2
  exit 1
fi
