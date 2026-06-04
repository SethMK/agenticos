# School-dashboard capability — delta for Add Ops School Dashboard

## ADDED Requirements

### Requirement: Gated school page
The site SHALL serve an SSR `/ops/school` page that requires Cloudflare-Access authentication and is
never prerendered or public.

#### Scenario: Unauthenticated request is denied
- GIVEN a request to `/ops/school` without a valid `cf-access-authenticated-user-email` header
- WHEN the page handler runs
- THEN it returns 403 and no school data

#### Scenario: Owner request renders
- GIVEN a request carrying the whitelisted owner email
- WHEN the page renders
- THEN per-child sections render from `school.json`
- AND no school data was emitted to any public artifact

### Requirement: At-risk strip
Each child SHALL show an at-risk strip of the subjects below the pass threshold.

#### Scenario: Subjects below threshold flagged
- GIVEN a child with a subject averaging `< 4.0` (or a point subject `< 60%`)
- WHEN the page renders
- THEN that subject appears as a chip in the at-risk strip using the danger/warn tokens

### Requirement: Grade, schedule, and message visualization
The page SHALL present, per child, a grade table, a per-subject trend sparkline, an upcoming-exams
timeline, and a message action-items list, using existing design tokens only.

#### Scenario: Trend sparkline renders
- GIVEN a subject with a sequence of numeric grades
- WHEN the page renders
- THEN a per-subject SVG sparkline shows the trend on a 1–6 scale
- AND no new `tokens.css` custom properties are introduced

#### Scenario: Exams and actions render
- GIVEN a child with upcoming exams and pending messages
- WHEN the page renders
- THEN exams appear on a dated timeline (at-risk subjects flagged)
- AND pending message action-items appear in a list with their deadlines

### Requirement: Empty, stale, and unavailable states
The page SHALL degrade gracefully when data is missing or stale.

#### Scenario: Missing snapshot
- GIVEN `school.json` is absent
- WHEN the page is requested
- THEN a styled "snapshot unavailable" state renders instead of an error

#### Scenario: Stale feed badge
- GIVEN a child's feed `last_synced` is older than the staleness threshold
- WHEN the page renders
- THEN an amber "stale" badge appears next to that feed's timestamp
