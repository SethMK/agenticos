# Add Ops School Dashboard

## Why

Marcin keeps three children's school data — Librus grades, schedule, and messages for Magda, Marta,
and Piotr — as markdown in the `202604_Personal` family-hub repo on the Mac, refreshed by deterministic
skills (`/librus-grades`, `/librus-schedule`, `/librus-messages`). There is no way to *see* it at a
glance or *refresh* it without opening a terminal. This change surfaces that data as a private dashboard
on the AgenticOS site and lets him trigger a refresh from the browser.

The hard constraint: the data, the Librus credentials (plaintext), the Python venv, and the `claude`
CLI all live on the **Mac**, but the site runs on a remote **LXC** behind Cloudflare Tunnel + Access.
The only existing channel is Mac→LXC rsync (launchd, every 15 min). So "run a refresh from the web" is a
cross-machine async-job problem, and a naive web→shell button would be **RCE-equivalent** over private
data + plaintext creds. This change solves it with a **reverse-rsync job queue** (the Mac pulls jobs,
runs them locally, pushes results back) and an **enum-only command allowlist** (no command or prompt
string ever crosses from the web — only a typed job + validated params).

Scope is **v1: visualization + deterministic refresh only** (zero model tokens). Model-heavy skills
(`/school-weekly`, `/study-prep`) are deferred to the sibling change `add-school-model-triggers`.

## What Changes

- Add a pipeline parser `data/pipeline/school-parse.ts` that turns the `05_school/*.md` files into a
  structured snapshot, and a **third snapshot stage** in `snapshot.ts` emitting
  `data/snapshots/school.json` — gated exactly like `ops.json`, **never merged into `public.json`**
  (build-time leak guard).
- Add an async **cross-machine job bridge**: a job-file queue (`data/jobs/{queued,running,done,failed}/`),
  a shared validator `api/lib/schoolJobs.ts` (fixed job-type enum + param allowlist), three gated SSR
  routes (`enqueue`, `jobs.json`, `snapshot.json`), a Mac worker `scripts/school-job-worker.ts` that
  reverse-rsync-pulls the queue and runs deterministic refreshes (`librus.py`), and a launchd watcher.
- Add the gated **`/ops/school`** page: per-child risk strip, grade tables, per-subject trend
  sparklines, an upcoming-exams timeline, message action-items, and a trigger panel (refresh buttons +
  poll-driven status).
- Reuse `requireAuth`, the `ops.json.ts` route shape, `writeAtomic`, `tokens.css`, and the existing
  chart/component grammar (UsageChart / StatCard / SpineTimeline / AlertBanner).

## Impact

- New capabilities: `school-pipeline`, `school-dashboard`, `school-jobs`.
- Affected code (AgenticOS repo): `data/pipeline/snapshot.ts` (+third stage, +leak guard), new
  `data/pipeline/school-parse.ts`, new `api/lib/schoolJobs.ts`,
  `src/pages/api/school/{enqueue,jobs.json,snapshot.json}.ts`, `src/pages/ops/school.astro`,
  `src/components/{SubjectSparkline,RiskStrip,SchoolTriggerPanel}.astro`,
  `scripts/school-job-worker.ts`, `scripts/run-school-worker.sh`,
  `scripts/run-pipeline-and-sync.sh` (rsync includes), `tests/e2e/ops-school.spec.ts`, and
  `~/Library/LaunchAgents/com.agenticos.school-watcher.plist` (outside repo).
- Source data (`202604_Personal/05_school/*`, `scripts/librus.py`): read-only consumer, never modified,
  never rsynced. **Librus credentials stay on the Mac and never appear in any snapshot.**
- PMO mapping: milestone **M4**, epics **E20–E22**, stories **S150–S159**.
- Security: private-only (Cloudflare Access owner gate); enum-only command surface; deterministic
  refresh = no model invocation. **Spike-gated** — the reverse-rsync transport + creds-isolation (S157)
  must be validated before the worker/routes ship.
- Depends on the existing pipeline + `ops.json` auth pattern. The v2 model triggers
  (`add-school-model-triggers`) depend on this change.
