# Add School Model Triggers

## Why

`add-ops-school` (v1) ships the gated `/ops/school` dashboard plus deterministic refresh jobs that run
`librus.py` with zero model tokens. This change adds the **model-heavy** on-demand skills Marcin also
wants from the browser: `/school-weekly` (a digest) and `/study-prep` (generated study material). These
need the `claude` CLI, so they raise the security surface beyond v1 — which is why they are a separate,
later change that builds on v1's enum allowlist and reverse-rsync transport.

Two product decisions are locked into the spec: `/school-weekly` is invoked in **`status` mode only**
from the web (it builds the digest but **never sends the family email** — the email-sending `review`
mode stays terminal-only), and a finished `/study-prep` job exposes a **gated link** to the generated
material rather than leaving the user to find it on the Mac.

## What Changes

- Extend `api/lib/schoolJobs.ts` with two new job types — `weekly-digest` (mode forced to `status`) and
  `study-prep` (subject from a per-child allowlist) — and a `buildPrompt(type, params)` that constructs
  the `/skill ...` prompt Mac-side from validated params (the web still submits only enum + params).
- Extend the Mac worker to dispatch model jobs via `claude -p buildPrompt(...)` with
  `--permission-mode acceptEdits` (NOT `bypassPermissions`), scoped to the `05_school/**` working tree.
- Add a **per-job token cap + a daily model-job budget** (`data/jobs/budget-YYYY-MM-DD.json`);
  over-budget jobs go to `failed/` with a clear message, and model-job token cost is surfaced on the page.
- Add a gated `src/pages/api/school/artifact.ts` that serves a finished `study-prep` artifact by
  validated `job_id`, and an "open material" link in the trigger panel.
- Add the model buttons to `SchoolTriggerPanel` (with a `study-prep` subject `<select>` — never free text).

## Impact

- Modified capability: `school-jobs` (adds model dispatch, budget enforcement, artifact retrieval).
- Affected code (AgenticOS repo): `api/lib/schoolJobs.ts` (+`buildPrompt`, +2 job types),
  `scripts/school-job-worker.ts` (+model dispatch +budget), `src/pages/api/school/artifact.ts` (new),
  `src/components/SchoolTriggerPanel.astro` (+model buttons +subject select),
  `src/pages/ops/school.astro` (+cost surface), `tests/e2e/ops-school-model.spec.ts`.
- Source skills (`202604_Personal/.claude/skills/{school-weekly,study-prep}`): invoked in place,
  unmodified. The family email is never fired from the web.
- PMO mapping: epic **E23**, stories **S160–S162**.
- **Spike-gated**: S160 validates headless `claude` auth under the launchd env + `acceptEdits` scoping +
  no email in `status` mode **before** the model buttons are wired.
- **Depends on `add-ops-school`** (queue, validator, worker, page, transport).
