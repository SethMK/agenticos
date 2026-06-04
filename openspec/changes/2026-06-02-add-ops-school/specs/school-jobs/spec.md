# School-jobs capability — delta for Add Ops School Dashboard

## ADDED Requirements

### Requirement: Enum-only command surface
The web SHALL never submit a command, prompt, path, or flag string. A job SHALL carry only a typed
`type` from a fixed enum plus a structured `params` object.

#### Scenario: Free-form command rejected
- GIVEN an enqueue request whose `type` is not in the job-type enum
- WHEN the enqueue route validates it
- THEN it returns 400 and writes no job file

### Requirement: Param allowlist double-validated
Job params SHALL be validated against an allowlist both at the enqueue route and again in the Mac worker
before dispatch; an invalid job SHALL never execute.

#### Scenario: Out-of-allowlist child rejected at the route
- GIVEN an enqueue request with `params.child` outside `{magda, marta, piotr}`
- WHEN the route validates it
- THEN it returns 400

#### Scenario: Worker re-validates before dispatch
- GIVEN a queued job file with a tampered `params.child`
- WHEN the worker picks it up
- THEN the worker re-validation rejects it
- AND the job is moved to `failed/` without executing anything

### Requirement: Job-file state machine
A job SHALL move through `queued → running → done | failed` by atomic file moves between
`data/jobs/` subdirectories, and its status SHALL be readable via a gated poll endpoint.

#### Scenario: Status is observable
- GIVEN a job has been enqueued
- WHEN the client polls the gated `jobs.json` endpoint
- THEN the job appears with its current status
- AND on completion it appears under `done/` (or `failed/` with a sanitized message)

### Requirement: Deterministic refresh dispatch
Refresh jobs SHALL invoke `librus.py` directly via array-form spawn (no shell) and SHALL NOT invoke any
model.

#### Scenario: Refresh runs without the model
- GIVEN a `refresh-grades` job for `magda`
- WHEN the worker dispatches it
- THEN it spawns `python3 librus.py magda grades` as an argv array
- AND no `claude` process is started and no model tokens are consumed
- AND `school.json` is rebuilt afterward

### Requirement: Reverse-rsync transport and creds isolation
The Mac SHALL be the sole network initiator: it pulls the queue and pushes results; Librus credentials
SHALL never be synced to the LXC.

#### Scenario: Creds never reach the LXC
- GIVEN the worker pushes job statuses and `school.json` to the LXC
- WHEN the rsync include-list is applied
- THEN `librus-config.md` and any credential file are excluded
- AND a scan of the LXC snapshot directory finds no credentials

#### Scenario: Single-flight execution
- GIVEN two watcher ticks overlap
- WHEN the worker starts
- THEN the lockfile prevents a second concurrent run
