#!/usr/bin/env bash
# S014: AgenticOS pipeline runner + dual rsync to LXC.
#
# Behaviour:
#   1. Run bun data/pipeline/snapshot.ts  — emits data/snapshots/{public,ops}.json
#   2. rsync data/snapshots/  →  LXC  (NO --delete; historical files accumulate)
#   3. rsync source tree      →  LXC  (WITH --delete; mirrors Mac working tree)
#
# Failure contract: pipeline failure skips both rsync steps and exits non-zero.
# rsync failure exits non-zero with a message; next launchd fire retries cleanly.
#
# Idempotent: re-running produces the same end state.
# Set PIPELINE_FORCE_FAIL=1 to simulate pipeline failure (for test bullet 6).

set -Eeuo pipefail
trap 'echo "[agenticos-pipeline] $(date -u +%FT%TZ) UNEXPECTED EXIT line=$LINENO exit=$?" >&2' ERR

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
REPO_ROOT="/Users/marcinkokott/Projects/personal/202605_AgenticOS"
LXC_USER="agenticos"
LXC_HOST="192.168.42.45"
LXC_DEST="/opt/agenticos"
BUN_BIN="/Users/marcinkokott/.bun/bin/bun"
LOG_TAG="agenticos-pipeline"

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------
if [[ ! -x "$BUN_BIN" ]]; then
  echo "[$LOG_TAG] $(date -u +%FT%TZ) ERROR: bun not found at $BUN_BIN" >&2
  exit 1
fi

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Step 1: run pipeline
# ---------------------------------------------------------------------------
echo "[$LOG_TAG] $(date -u +%FT%TZ) pipeline start"

# Test hook: PIPELINE_FORCE_FAIL=1 simulates a broken pipeline (bullet 6).
if [[ "${PIPELINE_FORCE_FAIL:-0}" == "1" ]]; then
  echo "[$LOG_TAG] $(date -u +%FT%TZ) PIPELINE_FORCE_FAIL=1 — injecting failure" >&2
  echo "[$LOG_TAG] $(date -u +%FT%TZ) pipeline FAILED — skipping both rsync passes" >&2
  exit 7
fi

if ! "$BUN_BIN" run data/pipeline/snapshot.ts; then
  echo "[$LOG_TAG] $(date -u +%FT%TZ) pipeline FAILED — skipping both rsync passes" >&2
  exit 1
fi
echo "[$LOG_TAG] $(date -u +%FT%TZ) pipeline ok"

# ---------------------------------------------------------------------------
# Step 1b: Astro build — runs on Mac (CT 110 has 512 MB RAM cap; OOM risk).
# Exits 2 on failure; skips both rsync passes.
# ---------------------------------------------------------------------------
echo "[$LOG_TAG] $(date -u +%FT%TZ) astro build start"
if ! "$BUN_BIN" run build; then
  echo "[$LOG_TAG] $(date -u +%FT%TZ) astro build FAILED — skipping source rsync" >&2
  exit 2
fi
echo "[$LOG_TAG] $(date -u +%FT%TZ) astro build ok"

# ---------------------------------------------------------------------------
# Step 2a: snapshot rsync — NO --delete (historical files accumulate). Bullet 7.
# ---------------------------------------------------------------------------
echo "[$LOG_TAG] $(date -u +%FT%TZ) rsync snapshots start"
if ! /usr/bin/rsync -az --no-perms --no-owner --no-group \
  "$REPO_ROOT/data/snapshots/" \
  "$LXC_USER@$LXC_HOST:$LXC_DEST/data/snapshots/"; then
  echo "[$LOG_TAG] $(date -u +%FT%TZ) rsync snapshots FAILED" >&2
  exit 2
fi
echo "[$LOG_TAG] $(date -u +%FT%TZ) rsync snapshots ok"

# ---------------------------------------------------------------------------
# Step 2b: source rsync — WITH --delete (mirror tree). Bullet 7.
#
# Include/exclude rule explanation:
#   Each --include rule must be listed before --exclude '*'.
#   Directories that contain included files need a plain directory include
#   (e.g. --include='data/') so rsync descends into them before the exclude
#   rule fires. Files inside excluded directories are never reached otherwise.
#
# Files shipped:
#   api/lib/***              — auth.ts guard (server.ts deleted in S077)
#   data/pipeline/***        — snapshot.ts + redact.ts + quotas.ts + subscriptions.ts
#   data/redaction-map.json  — stable project→"Project X" map
#   data/pricing.json        — model pricing table
#   data/subscriptions.yaml  — subscription history (total_subscription field)
#   dist/***                 — Astro SSR build artefact (built on Mac; CT 110 serves via node)
#   src/***                  — Astro source (parity; production serves dist/)
#   astro.config.mjs         — build config
#   tsconfig.json            — TypeScript config
#   package.json             — scripts + deps manifest
#   bun.lock                 — text lockfile (Bun 1.x; bun.lockb does not exist)
#
# Files NOT shipped (explicitly excluded):
#   node_modules/  data/snapshots/  .git/  .claude/
#   notes/  docs/  infra/  exports/  logs/  scripts/
# ---------------------------------------------------------------------------
echo "[$LOG_TAG] $(date -u +%FT%TZ) rsync source start"
# --ignore-times: force re-transfer of every file on each run so the LXC mtime
# reflects the transfer time, not the Mac source-file mtime. This is what makes
# "stat -c %Y /opt/agenticos/api/server.ts" return a timestamp within the last
# 20 minutes (the S014 acceptance bullet 5 check). The tree is small (~50 files)
# so unconditional re-transfer is acceptable.
if ! /usr/bin/rsync -rlz --delete --no-perms --no-owner --no-group --ignore-times \
  --include='api/' \
  --include='api/lib/' \
  --include='api/lib/***' \
  --include='data/' \
  --include='data/pipeline/***' \
  --include='data/redaction-map.json' \
  --include='data/pricing.json' \
  --include='data/subscriptions.yaml' \
  --include='dist/' \
  --include='dist/***' \
  --include='src/***' \
  --include='astro.config.mjs' \
  --include='tsconfig.json' \
  --include='package.json' \
  --include='bun.lock' \
  --exclude='*' \
  "$REPO_ROOT/" \
  "$LXC_USER@$LXC_HOST:$LXC_DEST/"; then
  echo "[$LOG_TAG] $(date -u +%FT%TZ) rsync source FAILED" >&2
  exit 3
fi
echo "[$LOG_TAG] $(date -u +%FT%TZ) rsync source ok"

echo "[$LOG_TAG] $(date -u +%FT%TZ) all steps complete"
exit 0
