# School-jobs capability — delta for Add School Model Triggers

## ADDED Requirements

### Requirement: Model-job dispatch via constructed prompt
The worker SHALL support `weekly-digest` and `study-prep` job types, building the `claude -p` prompt
Mac-side from validated params and running it with `--permission-mode acceptEdits` scoped to the
school working tree — never `bypassPermissions`, never a web-supplied prompt string.

#### Scenario: Weekly digest runs in status mode
- GIVEN a `weekly-digest` job for `magda`
- WHEN the worker dispatches it
- THEN it runs `claude -p "/school-weekly status magda"` with `--permission-mode acceptEdits`
- AND no family email is sent
- AND the digest result is recorded on the job

#### Scenario: Study-prep subject from allowlist only
- GIVEN a `study-prep` job whose `subject` is not in `KNOWN_SUBJECTS[child]`
- WHEN the worker re-validates it
- THEN the job is moved to `failed/` without invoking the model

### Requirement: Email side-effect locked out from the web
A web-triggered digest SHALL never send the family email; the email-sending `review` mode is
terminal-only.

#### Scenario: No mail on web trigger
- GIVEN any `weekly-digest` job enqueued from the web
- WHEN it runs
- THEN the worker forces `status` mode (the web cannot set `mode`)
- AND no email is dispatched

### Requirement: Token budget enforcement
Model jobs SHALL be bounded by a per-job token cap and a daily model-job budget; over-budget jobs SHALL
fail clearly rather than run.

#### Scenario: Daily budget exhausted
- GIVEN the daily model-job budget for today is already reached
- WHEN another model job is picked up
- THEN it is moved to `failed/` with `"daily model budget exceeded"`
- AND no model is invoked

#### Scenario: Cost surfaced
- GIVEN a model job completes
- WHEN its result is recorded
- THEN the token cost (subprocess `.modelUsage[]` sum) is written to the job and shown on the page

### Requirement: Gated artifact retrieval
A finished `study-prep` artifact SHALL be retrievable only behind the auth gate, addressed by validated
`job_id` — never by a path taken from the request.

#### Scenario: Open material behind the gate
- GIVEN a completed `study-prep` job whose `result` records an artifact path
- WHEN the owner opens the "open material" link
- THEN `artifact.ts` resolves the path from the job record (not the request) and serves the file after `requireAuth`

#### Scenario: Unauthenticated artifact request denied
- GIVEN a request to the artifact route without a valid Access header
- WHEN the route runs
- THEN it returns 403 and serves nothing
