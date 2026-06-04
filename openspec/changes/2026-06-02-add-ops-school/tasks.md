# Tasks — Ops School Dashboard (v1)

> PMO mapping: 1.x → S150 · 2.x → S151 · 3.x → S155 · 4.x → S156 + S152 (snapshot route) ·
> 5.x → S157 · 6.x → S158 · 7.x → S152 · 8.x → S153 · 9.x → S159 · 10.x → S154.
> Epics: E20 (data pipeline) = S150–S151 · E21 (page) = S152–S154 · E22 (skill bridge) = S155–S159.
> **Spike-gated: 5.1 (reverse-rsync dry-run + creds-isolation) must pass before the rest of 5.x and before 6.x ship.**

## 1. Parser + schema (S150)
- [ ] 1.1 `data/pipeline/school-parse.ts` parses all 9 `05_school/{grades,schedule,messages}-{magda,marta,piotr}.md` into the `school.json` shape (per-child `subjects[]`/`schedule[]`/`messages[]` + `last_synced`)
- [ ] 1.2 Attribution-coverage: every emitted subject/grade/exam/message maps to a real source-markdown row (no synthetic buckets); Piotr emits both `1-6` (average) and `pkt` (percent) subjects
- [ ] 1.3 Tolerant parse — unknown section ignored, missing table → empty array, malformed row skipped + logged, never throws; modifiers normalized (`5+`→5.5, `4-`→3.75, non-numeric skipped)

## 2. Pipeline stage + leak guard + rsync (S151)
- [ ] 2.1 Third `writeAtomic` stage in `data/pipeline/snapshot.ts` emits `data/snapshots/school.json` (missing `SCHOOL_DIR` = skip, not fail); NOT merged into `public.json`
- [ ] 2.2 Build-time leak-guard assertion: fail if any child name/grade string appears in `public.json`
- [ ] 2.3 `scripts/run-pipeline-and-sync.sh` verified — `school.json` rides the snapshot rsync; `data/jobs/***` added to includes for status push-back; `05_school/` + creds never synced

## 3. Shared validator + job format (S155)
- [ ] 3.1 `api/lib/schoolJobs.ts` exports `JOB_TYPES` (v1: refresh-grades/schedule/messages), `CHILDREN`, `validateJob(type, params)`
- [ ] 3.2 `validateJob` rejects unknown type + out-of-allowlist `child`; job-file JSON shape + status states (`queued|running|done|failed`) defined

## 4. Gated routes (S156 enqueue + jobs.json; S152 snapshot.json)
- [ ] 4.1 `src/pages/api/school/enqueue.ts` — POST, `requireAuth`, validate via `schoolJobs`, `writeAtomic` `data/jobs/queued/<id>.json`, return `{job_id}`; dedupe identical in-flight job; bad input → 400
- [ ] 4.2 `src/pages/api/school/jobs.json.ts` — GET, `requireAuth`, merged `{queued,running,done,failed}` array sorted desc (last ~30), `no-store`
- [ ] 4.3 `src/pages/api/school/snapshot.json.ts` — GET, `requireAuth`, reads `school.json`, `no-store`, 503 if missing (mirrors `ops.json.ts`)

## 5. Mac worker — deterministic [SPIKE-GATE] (S157)
- [ ] 5.1 **Spike**: reverse-rsync pull `agenticos@LXC:data/jobs/queued/` read-only dry-run succeeds; creds-isolation confirmed (no `librus-config`/passwords on LXC). GATES 5.2–5.5 + section 6
- [ ] 5.2 `scripts/school-job-worker.ts` (Bun): pull `queued/`, re-validate each job via `schoolJobs`, run deterministic refresh (`.venv/bin/python3 librus.py <child> <kind>` array-spawn, no shell)
- [ ] 5.3 Rebuild `school.json` via `school-parse.ts` after each job; `mv` job → `done/` (result summary) or `failed/` (sanitized error); push `running/done/failed/` + `school.json` to LXC
- [ ] 5.4 Single-flight lockfile `data/jobs/.worker.lock` prevents double-run on overlapping ticks
- [ ] 5.5 Per-job timeout; `enqueued_by`/`enqueued_at` preserved through transitions

## 6. launchd watcher (S158)
- [ ] 6.1 `~/Library/LaunchAgents/com.agenticos.school-watcher.plist` — `StartInterval 60`, `RunAtLoad true`, own logs
- [ ] 6.2 `scripts/run-school-worker.sh` wrapper sets full env (PATH); watcher runs the worker on tick, lock honored

## 7. Page shell + risk strip (S152)
- [ ] 7.1 `src/pages/ops/school.astro` — `requireAuth`, reads `school.json` (503 fallback); per-child sections + grade tables (reuse `.projects-table` styling)
- [ ] 7.2 `RiskStrip.astro` — chips for subjects `< 4.0` (pkt `< 60%`), `--danger`/`--warn` tokens
- [ ] 7.3 403 without `cf-access-authenticated-user-email`; renders for the whitelisted email

## 8. Sparkline + timeline + actions (S153)
- [ ] 8.1 `SubjectSparkline.astro` — per-subject grade trend SVG (Y 1–6, reuse `UsageChart` grammar, no JS)
- [ ] 8.2 Upcoming-exams timeline (adapt `SpineTimeline`) + message action-items list per child; at-risk exams flagged; 0 new `tokens.css` custom props

## 9. Trigger panel island (S159)
- [ ] 9.1 `SchoolTriggerPanel.astro` — per-child refresh buttons POST `enqueue`; poll `jobs.json` every 3s while non-terminal
- [ ] 9.2 Button state machine idle→queued(disabled)→running(timer)→done(auto-reset 5s)/failed(msg); disables the exact in-flight job; `last synced` shown

## 10. States + e2e (S154)
- [ ] 10.1 Empty-child placeholder + stale-feed amber badge (`last_synced` > N days) + styled 503
- [ ] 10.2 `tests/e2e/ops-school.spec.ts` — asserts risk strip + a sparkline + exam timeline + trigger panel render; 403 unauth

### Experiment metrics (H-openspec-adoption)

| Change | Implementer | QA | Spec-Gate FAILs |
|---|---|---|---|
| add-ops-school | TBD | TBD | TBD |

The **fourth** OpenSpec change (H-openspec-adoption GO at n=2). Record the outcome at close to extend the evidence base.
