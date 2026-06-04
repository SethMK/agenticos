# Tasks — School Model Triggers (v2)

> PMO mapping: 1.x → S160 · 2.x → S161 · 3.x → S162 (epic E23).
> Depends on `add-ops-school` (S150–S159): queue, validator, worker, page, transport.
> **Spike-gated: 1.1 (headless `claude` under launchd + `acceptEdits` scope + no email in `status` mode) must pass before 1.2–3.x ship.**

## 1. buildPrompt + model dispatch (S160)
- [ ] 1.1 **Spike**: run one `claude -p "/school-weekly status magda"` under the launchd env; confirm headless auth works, `acceptEdits` confines edits to `05_school/**`, and NO email fires in `status` mode. GATES the rest
- [ ] 1.2 Extend `api/lib/schoolJobs.ts`: add `weekly-digest` (no web-settable mode; worker forces `status`) + `study-prep` (subject ∈ `KNOWN_SUBJECTS[child]`) to `JOB_TYPES`; add `buildPrompt(type, params)` constant templates
- [ ] 1.3 Worker dispatches model jobs via `Bun.spawn(["claude","-p",buildPrompt(...),"--permission-mode","acceptEdits","--output-format","json"], {cwd: personalRepo})`; reads driver model back via `jq '.modelUsage|keys'`
- [ ] 1.4 Re-validation in the worker rejects any non-enum type / out-of-allowlist subject before dispatch

## 2. Token cap + daily budget + cost (S161)
- [ ] 2.1 Per-job token cap bounds a single model job
- [ ] 2.2 Daily budget `data/jobs/budget-YYYY-MM-DD.json`; over-budget model job → `failed/` with `"daily model budget exceeded"`
- [ ] 2.3 Model-job token cost (subprocess `.modelUsage[]` sum) written to the job `result` and surfaced on `/ops/school` next to `✓ done`

## 3. study-prep dropdown + artifact + negative tests (S162)
- [ ] 3.1 `SchoolTriggerPanel` gains model buttons; `study-prep` subject is a `<select>` of `KNOWN_SUBJECTS[child]` (never free text)
- [ ] 3.2 Gated `src/pages/api/school/artifact.ts` serves a finished `study-prep` artifact by validated `job_id` (path from `done/` record, never from the request); "open material" link rendered on done
- [ ] 3.3 `tests/e2e/ops-school-model.spec.ts` — weekly-digest shows `✓ done` + cost and sends no email; study-prep "open material" opens behind the gate; budget exhaustion → `failed`; enqueue rejects `type:"rm-rf"` / `child:"../etc"` / out-of-allowlist subject at route AND worker

### Experiment metrics (H-openspec-adoption)

| Change | Implementer | QA | Spec-Gate FAILs |
|---|---|---|---|
| add-school-model-triggers | TBD | TBD | TBD |

The **fifth** OpenSpec change. Record the outcome at close to extend the H-openspec-adoption evidence base.
