# Design — School Model Triggers (v2)

## Context

Builds directly on `add-ops-school`: the job-file queue, reverse-rsync transport, enum+param allowlist,
gated routes, Mac worker, and `/ops/school` page already exist and ship deterministic refresh. This
change only adds the **model-heavy** dispatch path and its guard rails. The LXC remains untrusted for
command content — the web still submits only a typed job + structured params; the actual `claude -p`
prompt is built Mac-side.

## Prompt construction (no injection path)

`api/lib/schoolJobs.ts` gains `buildPrompt(type, params)` — constant templates with validated slots:

```
weekly-digest, child=magda   →  "/school-weekly status magda"     // mode hard-coded to `status`
study-prep,    child=marta,
               subject=niemiecki →  "/study-prep marta niemiecki"  // subject ∈ KNOWN_SUBJECTS[marta]
```

`weekly-digest` has **no `mode` param** the web can set — the worker always passes `status`. `study-prep`
takes `subject` only from a per-child allowlist surfaced as a `<select>` in the UI. There is no path by
which web input becomes free prompt or shell text.

## Model dispatch (minimum privilege)

The worker runs model jobs as:

```
Bun.spawn(["claude","-p", buildPrompt(type,params),
           "--permission-mode","acceptEdits",            // NOT bypassPermissions
           "--output-format","json"],
          { cwd: PERSONAL_REPO })                          // scoped to 05_school/** edits
```

`acceptEdits` + the `05_school/**`-scoped cwd let the skill edit school files and run its declared tools,
but not arbitrary commands elsewhere. The driver model is read back from the result
(`jq '.modelUsage | keys'`) — never inferred.

## Token budget

- **Per-job cap** bounds a single model job.
- **Daily budget** `data/jobs/budget-YYYY-MM-DD.json` counts model jobs run that day; when the cap is
  hit, further model jobs are moved to `failed/` with `"error":"daily model budget exceeded"`.
- Model-job token cost (from the subprocess `.modelUsage[]` sum) is written into the job's `result` and
  surfaced on the page next to the `✓ done` state.

Default budget (tunable): 5 weekly-digests + 3 study-preps/day.

## Artifact retrieval

`study-prep` writes its HTML/PDF into the family hub. The worker records the artifact path in the job's
`result`. `src/pages/api/school/artifact.ts` (gated, `requireAuth`) serves that file by validated
`job_id` (looked up in `done/`, path never taken from the request) so the trigger panel can render an
"open material" link behind the same Cloudflare-Access gate.

## Email side-effect (locked out)

`/school-weekly` in `review` mode auto-sends a family email. The web path **forces `status` mode**, which
builds the digest but sends nothing. The email-sending `review` mode is reachable only from the terminal.
The e2e + worker assertions confirm no mail is dispatched on a web-triggered digest.

## Spike gate (S160)

Before the model buttons are wired: run one `claude -p "/school-weekly status magda"` under the launchd
env (`run-school-worker.sh`) and confirm (a) headless `claude` is authenticated and runs, (b)
`acceptEdits` confines edits to `05_school/**`, and (c) no email fires in `status` mode. The buttons stay
dark until this passes.
