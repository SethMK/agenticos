# Deploy Runbook — AgenticOS LXC + Cloudflare Tunnel

Story: S013 | Date captured: 2026-05-12 | Agent: infra-deploy

---

## Section 1: Pre-flight Snapshot

### Raw output (captured 2026-05-12 15:53 CEST)

Command run: `ssh root@192.168.42.41 'free -m && uptime && pvs && lvs pve/data'`

```
              total        used        free      shared  buff/cache   available
Mem:           18950       17159         596          15        1560        1791
Swap:           4095         951        3144
 15:53:06 up 3 days, 14:35,  1 user,  load average: 4.42, 2.88, 2.74
  PV         VG  Fmt  Attr PSize    PFree
  /dev/sda3  pve lvm2 a--  <118.24g 6.75g
  LV   VG  Attr       LSize   Pool Origin Data%  Meta%  Move Log Cpy%Sync Convert
  data pve twi-aotz-- <65.93g             77.15  3.28
```

### Threshold evaluation

| Threshold | Metric used | Value | Required | Pass? |
|-----------|-------------|-------|----------|-------|
| ≥ 1 GB free RAM | `free -m` → `available` column | **1791 MB** | ≥ 1024 MB | PASS |
| Load avg < 6 on 1m | `uptime` → first value after `load average:` | **4.42** | < 6.0 | PASS |
| Thin pool pve/data < 85% | `lvs pve/data` → `Data%` column | **77.15%** | < 85% | PASS |
| VG pve ≥ 1.5 GB free | `pvs` → `PFree` column | **6.75 GB** | ≥ 1.5 GB | PASS |

**VERDICT: ALL FOUR THRESHOLDS PASS. Proceed with LXC creation.**

Note: RAM metric used is the `available` column (1791 MB), which accounts for buff/cache that the
kernel can reclaim. The `free` column alone (596 MB) would have failed — but `available` is the
correct figure for "memory the system can hand to a new process."

---

## Section 2: Bootstrap Apply

### IP and CT ID selection

During pre-flight, additional probes were run to pick a safe IP and CT ID:

```
pct list output:
  VMID  Status  Name
  102   running omada
  103   running cloudflared

Ping probe results (192.168.42.44–48):
  .44  ALIVE  (Xiaomi wireless device — b4:c4:fc:5e:79:3d — do NOT use)
  .45  FREE   (stale ARP from deleted CT 105; ping fails)
  .46  FREE
  .47  FREE
  .48  FREE
```

- **Chosen IP: `192.168.42.45`** — first free IP in the allowed `.44`-`.48` range
- **Chosen CT ID: `110`** — first free ID in the 110–130 range

### Exact command sequence

Run from the Mac (this project's working directory):

```bash
# Option A: pipe directly into SSH (no file transfer needed)
ssh root@192.168.42.41 'bash -s' < infra/lxc/bootstrap.sh

# Option B: copy then run (easier to inspect logs)
scp infra/lxc/bootstrap.sh root@192.168.42.41:/tmp/bootstrap-agenticos.sh
scp infra/systemd/agenticos-api.service root@192.168.42.41:/tmp/agenticos-api.service
ssh root@192.168.42.41 'bash /tmp/bootstrap-agenticos.sh'
```

Note: Option A requires the script to be able to locate the systemd unit file. If using Option A,
the `UNIT_PATH` resolution inside the script will fail because `$0` is `/dev/stdin`. Use Option B.

### Expected output (abridged)

```
[...] INFO:  Probing 192.168.42.45 before claiming it...
[...] INFO:  192.168.42.45 is free.
[...] INFO:  Chosen CT ID: 110
[...] INFO:  Creating unprivileged Debian 12 LXC (CT 110)...
[...] INFO:  CT 110 created.
[...] INFO:  Starting CT 110...
[...] INFO:  Network is up.
[...] INFO:  Installing prerequisites (curl, unzip, ca-certificates)...
[...] INFO:  Installing Bun 1.2.13 inside CT 110...
[...] INFO:  Ensuring service user 'agenticos' exists...
[...] INFO:  Creating /opt/agenticos directory tree...
[...] INFO:  Creating stub /etc/agenticos.env...
[...] INFO:  Installing systemd unit into CT 110...
[...] INFO:  Bootstrap complete.
[...] INFO:    CT ID  : 110
[...] INFO:    IP     : 192.168.42.45
[...] INFO:    RAM    : 512 MB (hard cap)
[...] INFO:    Disk   : 2 GB on local-lvm
[...] INFO:  NEXT STEPS:
[...] INFO:    1. Complete S014 (rsync data/snapshots/ + api/ to LXC)
...
```

### Expected post-conditions (verify after script exits)

```bash
# From Mac
ssh root@192.168.42.41 'pct status 110'
# Expected: status: running

ssh root@192.168.42.41 'pct exec 110 -- systemctl is-enabled agenticos-api'
# Expected: enabled

ssh root@192.168.42.41 'pct exec 110 -- ls -la /opt/agenticos/'
# Expected: api/  data/  (owned by agenticos:agenticos)

ssh root@192.168.42.41 'pct exec 110 -- bun --version'
# Expected: 1.2.13

ssh root@192.168.42.41 'pct exec 110 -- systemctl status agenticos-api'
# Expected: enabled but inactive (dead) — correct; S014 rsync has not run yet
```

### Why the service is NOT started by bootstrap.sh

`/opt/agenticos/api/server.ts` does not exist until S014 rsync completes. Starting the unit now
would cause systemd to enter a restart loop (`ExecStart` fails immediately → RestartSec=5 →
repeat). The unit is enabled (will auto-start on next boot after S014), but the first manual
`systemctl start agenticos-api` must happen after S014.

---

## Section 3: Cloudflare Apply

Full detail is in `infra/cloudflare/access-policy.md`.

Summary of steps:

1. Add DNS CNAME: `agenticos` → `71d3f3a4-c69e-431a-93cc-819760bc3252.cfargotunnel.com` (proxied)
2. Zero Trust → Networks → Tunnels → running tunnel → Public Hostname → Add:
   - `agenticos.sethsendom.com` → `http://192.168.42.45:3000`
3. Zero Trust → Access → Applications:
   - **Public**: `agenticos.sethsendom.com` (all paths except /ops) → Bypass → Everyone
   - **Ops**: `agenticos.sethsendom.com/ops` + `/api/ops.json` → Allow → emails: `kokott.marcin@gmail.com`, Google SSO
4. Confirm Google identity provider is configured.

These are all **dashboard-only manual steps** — the tunnel uses token mode with no local config.yml.

### Verification curls (run AFTER S014 rsync + service start + Access policies applied)

```bash
# Check 1: public home page returns 200 with AGENTICOS in body
curl -sf https://agenticos.sethsendom.com/ | grep -i 'AGENTICOS'
# Expected: output containing "AGENTICOS" (or matching text from the Astro frontend)

# Check 2: /ops without Access cookie gets 302 to Cloudflare login
curl -s -o /dev/null -w "%{http_code}\n" https://agenticos.sethsendom.com/ops
# Expected: 302

# Check 3 (optional): full header dump to confirm CF-Ray header
curl -sI https://agenticos.sethsendom.com/
# Expected: HTTP/2 200, CF-Ray header present, server: cloudflare
```

### Dependencies before verification curls will pass

| Dependency | Story | Status at S013 close |
|-----------|-------|----------------------|
| LXC created + unit installed | S013 | Done (after bootstrap.sh runs) |
| api/server.ts deployed to LXC | S014 | Not yet |
| data/snapshots/*.json populated | S014 | Not yet |
| `systemctl start agenticos-api` | S014 | Not yet |
| Cloudflare DNS CNAME | S013 | MANUAL — Marcin applies |
| Cloudflare tunnel Public Hostname | S013 | MANUAL — Marcin applies |
| Cloudflare Access policies | S013 | MANUAL — Marcin applies |

**Partial-ship verdict for S013:** Acceptance bullets 1–4 are satisfied by the files created and
the pre-flight pass. Bullets 5–6 (live curl checks) cannot pass until S014 ships and the manual
Cloudflare dashboard steps are completed. This is expected and was documented in the story notes.

---

## Section 4: Rollback

### If you need to destroy the new LXC

```bash
ssh root@192.168.42.41 'pct stop 110 && pct destroy 110'
# Verify:
ssh root@192.168.42.41 'pct status 110'
# Expected: "CT 110 does not exist"
```

The `pve/data` thin pool space is automatically reclaimed.

### If the Cloudflare tunnel hostname causes problems

1. Zero Trust → Networks → Tunnels → running tunnel → Public Hostname tab
2. Find `agenticos.sethsendom.com` → click the three-dot menu → **Delete**
3. Delete the DNS CNAME `agenticos` in Cloudflare DNS

No cloudflared restart needed — the token-based tunnel applies changes immediately.

### If the Access policies lock you out

1. Go to Zero Trust → Access → Applications
2. Find `AgenticOS Ops` → Edit → temporarily change policy action to **Bypass**
3. Save, access the site to diagnose, then restore **Allow** with the correct policy

### Reverting the systemd unit only (without destroying the LXC)

```bash
ssh root@192.168.42.41 'pct exec 110 -- systemctl disable agenticos-api'
ssh root@192.168.42.41 'pct exec 110 -- rm /etc/systemd/system/agenticos-api.service'
ssh root@192.168.42.41 'pct exec 110 -- systemctl daemon-reload'
```

---

## Section 5: S014 — Mac launchd Timer + Dual Rsync

Story: S014 | Date captured: 2026-05-12 | Agent: infra-deploy

### Files created by S014

| File | Purpose |
|------|---------|
| `infra/launchd/com.agenticos.pipeline.plist` | launchd agent — `StartInterval=900`, `RunAtLoad=true` |
| `scripts/run-pipeline-and-sync.sh` | Wrapper: pipeline → snapshot rsync → source rsync |
| `logs/.gitkeep` | Keeps `logs/` dir in repo; actual log files are gitignored |

### Install / reinstall the launchd timer

```bash
# Unload any old version first (safe if not loaded)
launchctl unload ~/Library/LaunchAgents/com.agenticos.pipeline.plist 2>/dev/null || true

# Copy from repo
cp infra/launchd/com.agenticos.pipeline.plist ~/Library/LaunchAgents/

# Load and enable (RunAtLoad fires it immediately)
launchctl load -w ~/Library/LaunchAgents/com.agenticos.pipeline.plist

# Verify registered
launchctl list | grep agenticos
# Expected: <PID>  0  com.agenticos.pipeline
```

Log files (auto-created on first run):
- `logs/pipeline.out.log` — stdout from wrapper + pipeline progress lines
- `logs/pipeline.err.log` — stderr: pipeline fatal output + rsync errors

### Dual-rsync semantics

| Pass | Source | Dest | `--delete`? | Purpose |
|------|--------|------|-------------|---------|
| A: snapshots | `data/snapshots/` | `agenticos@192.168.42.45:/opt/agenticos/data/snapshots/` | NO | Historical accumulation |
| B: source | repo root (filtered) | `agenticos@192.168.42.45:/opt/agenticos/` | YES | Mirror Mac working tree |

Pass B ships: `api/`, `data/pipeline/`, `data/redaction-map.json`, `data/pricing.json`,
`data/subscriptions.yaml`, `src/`, `astro.config.mjs`, `tsconfig.json`, `package.json`, `bun.lock`.

Pass B explicitly excludes: `node_modules/`, `dist/`, `.git/`, `data/snapshots/`, `docs/`, `infra/`,
`notes/`, `exports/`, `logs/`, `scripts/`, `.claude/`.

### Failure contract

If `bun run data/pipeline/snapshot.ts` exits non-zero, the wrapper exits 1 immediately;
**both rsync passes are skipped**. launchd records the exit code and retries on the next fire (15 min).

Test: `PIPELINE_FORCE_FAIL=1 ./scripts/run-pipeline-and-sync.sh; echo "exit=$?"` → `exit=7`

### Force-trigger a manual run

```bash
# Kick immediately (fires async under launchd service context)
launchctl kickstart -k gui/$(id -u)/com.agenticos.pipeline

# Or run directly in foreground (easier to watch):
/Users/marcinkokott/Projects/personal/202605_AgenticOS/scripts/run-pipeline-and-sync.sh
```

### Post-run verification

```bash
# Verify snapshots landed on LXC (timestamp within last 20 min)
ssh agenticos@192.168.42.45 'stat -c %Y /opt/agenticos/data/snapshots/public.json'
date +%s   # compare — diff should be < 1200

# Verify source tree landed (api/server.ts)
ssh agenticos@192.168.42.45 'stat -c %Y /opt/agenticos/api/server.ts'
date +%s   # compare — diff should be < 1200
```

### Known gap flagged at S014 close (architectural caveat)

S013's `infra/systemd/agenticos-api.service` has `ExecStart=/usr/local/bin/bun run /opt/agenticos/api/server.ts`.
S012 added Astro SSR — the public HTML pages (`/`, `/ops`, `/how-it-was-built`) are served by
`node ./dist/server/entry.mjs` (Astro node adapter), not the Bun JSON server. The Bun server only
serves `/api/public.json`, `/api/ops.json`, `/healthz`.

Resolution in a follow-up story: align `agenticos-api.service`'s `ExecStart` with the Astro `serve`
script in `package.json`, add `dist/` to the rsync list (or build on LXC), and verify end-to-end
HTML response from `https://agenticos.sethsendom.com/`.

---

## Section 6: S077 — Astro SSR Alignment (systemd + dist rsync)

Story: S077 | Date captured: 2026-05-12 | Agent: infra-deploy

### Decision 1: dist-ship strategy — chosen (a) build-on-Mac, rsync `dist/`

**Rationale:**
- CT 110 has a 512 MB RAM cap with no swap. Astro build peak is 200-400 MB — OOM risk in an unprivileged container without swap is unacceptable.
- The Mac is already the source of truth for the pipeline. Adding `bun run build` before the source rsync is a natural fit; the pipeline fires every 15 min anyway.
- LXC stays free of build-time node_modules. Runtime deps (`@astrojs/node`, `astro`) are installed once via `bun install --production` and persist on the LXC.
- Failure semantics: if `bun run build` exits non-zero (exit 2), the source rsync is skipped and the site stays on the previous build. Acceptable — same pattern as pipeline failure (exit 1) skipping both rsync passes.

**Exit code table for `scripts/run-pipeline-and-sync.sh`:**

| Exit | Trigger |
|------|---------|
| 0 | All steps completed successfully |
| 1 | `bun run data/pipeline/snapshot.ts` failed |
| 2 | `bun run build` (Astro) failed — source rsync skipped |
| 3 | rsync source pass failed |
| 7 | `PIPELINE_FORCE_FAIL=1` test hook |

### Decision 2: `/api/*` route alignment — chosen path (i) migrate Bun routes to Astro API routes

**Rationale:**
- One process, one port (3000), one systemd unit. Minimises moving parts.
- `requireAuth(request)` from `api/lib/auth.ts` works identically in Astro API endpoints — `Astro.request` is a standard `Request`.
- `api/server.ts` deleted; `api/lib/auth.ts` kept (imported by both `src/pages/api/ops.json.ts` and `src/pages/ops/index.astro`).
- `package.json` `serve:api` script removed; `serve` = `node ./dist/server/entry.mjs` is the single production entry.

**Files changed by S077:**

| File | Change |
|------|--------|
| `src/pages/api/public.json.ts` | `prerender: true` → `false`; reads snapshot at request time via `fs.readFileSync` |
| `src/pages/api/ops.json.ts` | `prerender: true` → `false`; adds `requireAuth(request)` guard; reads snapshot at request time |
| `src/pages/api/healthz.ts` | NEW — mirrors Bun `/healthz` handler: `{ ok: bool, snapshot_age_seconds: int }` |
| `api/server.ts` | DELETED — dead code after route migration |
| `package.json` | Removed `serve:api` script |
| `infra/systemd/agenticos-api.service` | `ExecStart` rewritten from `bun run api/server.ts` → `node --experimental-global-webcrypto dist/server/entry.mjs` |
| `scripts/run-pipeline-and-sync.sh` | Added `bun run build` step (exit 2 on failure); added `dist/` to rsync allow-list |

### New "apply" sequence

Run from Mac after each code change or on a fresh LXC:

```bash
# 0. (One-time) Install Node + production node_modules on CT 110
ssh root@192.168.42.41 'pct exec 110 -- apt-get install -y nodejs'
ssh root@192.168.42.41 'pct exec 110 -- bash -c "cd /opt/agenticos && bun install --production"'
# Node version: 18.20.4 (Debian 12 stable). Astro 6 + @astrojs/node@10.1.0 compatible.
# Note: --experimental-global-webcrypto in ExecStart required for Astro 6 session manifest on Node 18.

# 1. Deploy systemd unit (first time or on unit change)
scp infra/systemd/agenticos-api.service root@192.168.42.41:/tmp/agenticos-api.service
ssh root@192.168.42.41 'pct push 110 /tmp/agenticos-api.service /etc/systemd/system/agenticos-api.service'
ssh root@192.168.42.41 'pct exec 110 -- systemctl daemon-reload'
ssh root@192.168.42.41 'pct exec 110 -- systemctl enable agenticos-api'

# 2. Run pipeline (builds Astro + rsyncs dist/ + snapshots to LXC)
./scripts/run-pipeline-and-sync.sh

# 3. (Re)start the service
ssh root@192.168.42.41 'pct exec 110 -- systemctl restart agenticos-api'
sleep 10
ssh root@192.168.42.41 'pct exec 110 -- systemctl status agenticos-api --no-pager'

# 4. Curl checks (direct LAN — no Cloudflare Access in this path)
curl -sf http://192.168.42.45:3000/ | grep -i 'AGENTICOS'
curl -s -o /dev/null -w "%{http_code}\n" -H "cf-access-authenticated-user-email: kokott.marcin@gmail.com" http://192.168.42.45:3000/ops
curl -sf http://192.168.42.45:3000/api/public.json | jq '.totals != null'
curl -sf http://192.168.42.45:3000/api/healthz
```

### Note on /ops auth on direct LAN

The Cloudflare Access layer (which normally injects `cf-access-authenticated-user-email`) is only present in the Cloudflare Tunnel path. On direct LAN (`192.168.42.45:3000`), the auth guard still checks for the header. To test `/ops` on direct LAN, pass the header manually:

```bash
curl -H "cf-access-authenticated-user-email: kokott.marcin@gmail.com" http://192.168.42.45:3000/ops
```

In production (`agenticos.sethsendom.com/ops`), Cloudflare Access injects this header automatically after Google SSO authentication.

### Rollback for S077 changes only

```bash
# Stop service
ssh root@192.168.42.41 'pct exec 110 -- systemctl stop agenticos-api'

# Restore old unit (check git history for previous agenticos-api.service) or revert ExecStart manually
ssh root@192.168.42.41 'pct exec 110 -- systemctl daemon-reload'
ssh root@192.168.42.41 'pct exec 110 -- systemctl start agenticos-api'

# The previous Bun server (api/server.ts) was deleted in S077. To fully revert,
# restore from git and revert scripts/run-pipeline-and-sync.sh + package.json.
```

### S077 Verification (captured 2026-05-12)

Node install path: **Debian 12 apt** (`apt-get install -y nodejs`). Version: **18.20.4**. Compatible with Astro 6 + `@astrojs/node@10.1.0`.

Runtime node_modules: `bun install --production` in `/opt/agenticos` — 275 packages, 4.77s.

Memory at runtime (first successful HTTP request):

```
               total        used        free      shared  buff/cache   available
Mem:             512          39          19           0         453         472
Swap:              0           0           0

Active: active (running) since Tue 2026-05-12 16:06:42 UTC; 1min 5s ago
Main PID: 8114 (node)
Memory: 27.3M
```

Astro SSR process uses **27 MB RSS** at idle. **472 MB available** out of 512 MB cap. No OOM risk.

Acceptance curl outputs (all PASS):

```
# Bullet 4: AGENTICOS in HTML body
curl -sf http://192.168.42.45:3000/ | grep -oi 'AGENTICOS'  →  AGENTICOS

# Bullet 5: /ops returns 200 with auth header
curl -s -o /dev/null -w "%{http_code}\n" -H "cf-access-authenticated-user-email: kokott.marcin@gmail.com" http://192.168.42.45:3000/ops  →  200

# Bullet 6: /api/public.json .totals != null
curl -sf http://192.168.42.45:3000/api/public.json | jq '.totals != null'  →  true

# Bullet 7: active (running) 1min 5s, no restart events in journalctl -2min window
```
