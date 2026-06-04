# School-pipeline capability — delta for Add Ops School Dashboard

## ADDED Requirements

### Requirement: Gated school snapshot emit
The pipeline SHALL parse the family-hub school markdown files into `data/snapshots/school.json`, a
private snapshot sibling to `ops.json`, decomposed per child into subjects (with average or point
percentage), schedule, and messages — and SHALL skip (not fail) when the source directory is absent.

#### Scenario: Snapshot built for all children
- GIVEN the `05_school/{grades,schedule,messages}-{magda,marta,piotr}.md` files exist
- WHEN the pipeline runs
- THEN `data/snapshots/school.json` is written with one entry per child
- AND each child carries `subjects[]`, `schedule[]`, `messages[]`, and `last_synced`
- AND Piotr carries both `1-6` (average) and `pkt` (percent) subjects

#### Scenario: Missing source directory is skipped
- GIVEN the school source directory does not exist on the build host
- WHEN the pipeline runs
- THEN the school stage is skipped without throwing
- AND the public and ops snapshots are still written

### Requirement: Public-leak prohibition
School data SHALL NOT appear in `public.json` or any prerendered/public page; the build SHALL fail if it
does.

#### Scenario: Leak guard fails the build
- GIVEN `school.json` contains a child name and grade values
- WHEN the leak-guard assertion runs against `public.json`
- THEN it confirms no child name or grade string is present in `public.json`
- AND the build fails if any is found

### Requirement: Tolerant parse with attribution coverage
The parser SHALL map every emitted field to a real source-markdown row (no synthetic buckets) and SHALL
degrade rather than crash on malformed input.

#### Scenario: Malformed row is skipped, not fatal
- GIVEN a grades file with one unparseable table row
- WHEN the parser runs
- THEN that row is skipped and logged as a warning
- AND the remaining rows are emitted
- AND the parser does not throw

#### Scenario: Grade modifiers normalized
- GIVEN a grade cell of `5+`, `4-`, or a non-numeric mark
- WHEN the parser computes `numeric`
- THEN `5+`→5.5 and `4-`→3.75
- AND non-numeric marks are excluded from the average rather than coerced to a number
