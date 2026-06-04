# Research capability — delta for Tracker

## ADDED Requirements

### Requirement: Tracker page
The site SHALL serve a prerendered `/research/tracker` page presenting the research dataset as an
operational board: a metric strip plus three lanes — validated, watching, and queued — reading the same
`public.json.research` dataset as the Explorer.

#### Scenario: Default render
- GIVEN the research dataset is published
- WHEN the Tracker page renders
- THEN a metric strip shows the validated, watching, and queued counts and the number of sprints run
- AND each state's items appear in its corresponding lane

### Requirement: Promotion progress for watched hypotheses
Each watching item SHALL display its progress toward promotion as both a textual `n=k/threshold` and a
proportional visual meter, ordered so items closest to promotion appear first.

#### Scenario: Watched item near promotion
- GIVEN a watching hypothesis with n=2 and threshold=3
- WHEN it renders in the watching lane
- THEN it shows the text "n=2/3" and a meter filled to two-thirds
- AND it sorts ahead of a watching hypothesis with n=0

### Requirement: Score-ranked backlog queue
The queued lane SHALL order backlog hypotheses by descending score and show each item's score and
expected artifact.

#### Scenario: Queue ordering
- GIVEN two backlog hypotheses with scores 60 and 40
- WHEN the queued lane renders
- THEN the score-60 hypothesis appears above the score-40 hypothesis

### Requirement: Signal not colour-only
Status and progress SHALL be conveyed by text and shape in addition to colour, and the page SHALL meet
WCAG-AA with keyboard navigation and reduced-motion support, using only the existing design tokens.

#### Scenario: Colour-independent reading
- GIVEN a user who cannot distinguish the status colours
- WHEN they read a watching card
- THEN the promotion progress is legible from the "n=k/threshold" text and the meter shape alone
