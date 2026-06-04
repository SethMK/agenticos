# Design — Ops School Dashboard (v1)

## Context

- Source data + Librus creds + Python venv + `claude` CLI live on the **Mac** (`202604_Personal`).
- The site (Astro `output: 'server'`, Node adapter) runs on a remote **LXC** (`192.168.42.45:3000`)
  behind Cloudflare Tunnel + Access. Public pages prerender; `/ops` routes are SSR + auth-gated.
- The only existing cross-machine channel is **Mac→LXC rsync** (launchd, 15 min), Mac-initiated.
- Threat: a web button that runs a shell/`claude` command is RCE-equivalent over private school data
  and plaintext Librus credentials. The design treats the LXC as **untrusted for command content**.

## Architecture — async cross-machine job loop

**Transport: reverse-rsync queue.** The LXC web endpoint only writes a job *file* to its local disk.
The Mac, on a fast launchd tick, **pulls** the queue, executes locally, rebuilds `school.json`, and
**pushes** results + statuses back. No inbound listener on the Mac → security posture identical to
today. (Rejected alternatives: an inbound Cloudflare-Tunnel→Mac HTTP listener — new RCE-adjacent
surface; a cloud-synced shared dir — opaque timing + drags school data through a third party.)

**Job state = which subdir the JSON file lives in** (atomic `rename` = transition, mirroring
`snapshot.ts`'s tmp+rename discipline):

```
data/jobs/{queued,running,done,failed}/<job_id>.json
```

Job file — the ONLY thing crossing machines as a "command" — carries a typed enum + structured params,
never a command/prompt string:

```jsonc
{ "job_id":"2026-06-02T14-03-12Z_a1b2c3", "type":"refresh-grades",
  "params":{"child":"magda","subject":null}, "enqueued_at":"...",
  "enqueued_by":"kokott.marcin@gmail.com", "status":"queued",
  "started_at":null,"finished_at":null,"result":null,"error":null,"attempts":0 }
```

```
LXC (web only, NO creds)                          Mac (creds, venv, librus.py, claude CLI)
─────────────────────────                         ────────────────────────────────────────
browser (CF Access / Google SSO, owner-only)
  │ click "Refresh grades — Magda"
  ▼
POST /api/school/enqueue  (SSR, requireAuth)
  • validate type∈ENUM, params∈allowlist
  • writeAtomic data/jobs/queued/<id>.json
  │
  ├─────────────────── launchd com.agenticos.school-watcher (StartInterval 60s)
  │                       scripts/school-job-worker.ts (bun):
  │  (Mac PULLS queued/) ◀── 1. rsync agenticos@LXC:data/jobs/queued/ → local
  │                       2. for each job (oldest, single-flight lock):
  │                            • RE-validate via shared schoolJobs.ts
  │                            • mv→running/, push
  │                            • Bun.spawn (array-form, no shell):
  │                                refresh-*  → .venv/bin/python3 librus.py <child> <kind>   (NO model)
  │                            • run school-parse.ts → rebuild data/snapshots/school.json
  │                            • mv→done/ (or failed/) + result/error summary
  │ (Mac PUSHES back) ◀──── 3. rsync running/done/failed/ + school.json → LXC
  ▼
browser polls GET /api/school/jobs.json   (every 3s while non-terminal)
browser GET /api/school/snapshot.json     (gated; reads data/snapshots/school.json)
```

**Latency:** ≤ watcher interval (60s) + job runtime (refresh ~5–15s) + 1 rsync RTT → within ~1–2 min.

## Security model

1. **Fixed job-type enum, never a command string.** `type ∈ {refresh-grades, refresh-schedule,
   refresh-messages}` (v1). Params are structured. No web input becomes shell or prompt text.
2. **Param allowlist, validated twice** — in `enqueue` AND again in the Mac worker before dispatch
   (`child ∈ {magda,marta,piotr}`). Unknown → straight to `failed/`, nothing executed.
3. **Array-form spawn only** (`Bun.spawn([...])`, no `sh -c`). Injected values can't escape an argv slot.
4. **Deterministic refresh never touches the model** — calls `librus.py` directly. Zero tokens.
5. **Creds never leave the Mac.** `05_school/librus-config.md` is never rsynced, never read by the
   parser; `school.json` holds only derived data; the rsync include-list is allowlist-based.
6. **School data is private-only.** `school.json` is a sibling of `ops.json`; all routes call
   `requireAuth(request)` first. Never merged into `public.json` or any prerendered page.
7. **Audit + single-flight.** Every enqueue records `enqueued_by`/`enqueued_at`; the worker holds
   `data/jobs/.worker.lock`; `failed/` carries a sanitized message (no stack/paths).

## Data pipeline + schema

`data/snapshots/school.json` (gated): `children[]` → `{ id, name, level, grade_scale, last_synced,
subjects[{ name, type:"1-6"|"pkt", average|percent, at_risk, grades[{value,numeric,category,date,counts}] }],
schedule[{date,subject,type,topic,teacher,at_risk}], messages[{date,from,subject,action,deadline,status}] }`.
Piotr (LO) carries both `1-6` (average) and `pkt` (percent, `at_risk = <60%`) subjects.

`data/pipeline/school-parse.ts` — heading-anchored markdown-table extraction (the `.md` files are
stable GFM tables emitted by the deterministic skills): split on `^##`/`^###`, extract pipe-tables,
pull per-subject average from `### Subject (śr. 3.25)`, normalize grade modifiers (`5+`→5.5, `4-`→3.75,
skip non-numeric), reusing the conversion table documented in `librus-grades/SKILL.md`. **Tolerant**:
unknown section ignored, missing table → empty array, malformed row skipped with a logged warning,
never throws. Plugs into `snapshot.ts` as a third `writeAtomic` stage after public + ops, guarded so a
missing `SCHOOL_DIR` skips rather than fails, plus a leak-guard assertion (fail build if any child
name/grade appears in `public.json`).

## API routes + executor

Three SSR routes mirror `src/pages/api/ops.json.ts` (`prerender=false`, `requireAuth` first):
`snapshot.json.ts` (GET school.json, `no-store`, 503 if missing), `jobs.json.ts` (GET merged
`{queued,running,done,failed}` array sorted desc, last ~30 — the poll target), `enqueue.ts` (POST
`{type,params}` → validate → `writeAtomic` queued file → 201 `{job_id}`; dedupe identical in-flight job).
Shared `api/lib/schoolJobs.ts` (`JOB_TYPES`, `CHILDREN`, `validateJob`) is the single source of truth,
imported by both the route and the Mac worker. `scripts/school-job-worker.ts` (Bun, reuses
`writeAtomic` + `schoolJobs` + `school-parse`) does the pull → validate → spawn → rebuild → push loop
behind a lockfile; `scripts/run-school-worker.sh` sets a full env for launchd; the
`com.agenticos.school-watcher.plist` runs it every 60s.

## Page / components

`src/pages/ops/school.astro` (gated, SSR; reads `school.json` like `ops/index.astro` reads `ops.json`).
Styling via `tokens.css` only (dark terminal, `--accent #FF6A00`, 1px borders, no radius, tabular-nums).
Layout: a **trigger panel** (the only client-JS island — per-child refresh buttons that POST `enqueue`
then poll `jobs.json` every 3s; state machine idle→queued→running(timer)→done/failed; `last synced`
strip) over **per-child sections** (at-risk chip strip, grade table, per-subject `SubjectSparkline`
reusing the `UsageChart` SVG grammar, exam timeline adapting `SpineTimeline`, message action-items).
States: no-snapshot 503, empty-child placeholder, stale-feed amber badge, failed-job `AlertBanner`.

## Spike gate

S157 (reverse-rsync pull/push + creds-isolation) is validated read-only **before** the worker and
routes go live: a dry-run confirms the Mac→LXC SSH key can also pull `data/jobs/queued/`, and a grep of
the LXC snapshot dir + rsync include-list confirms `librus-config.md`/passwords are absent.
