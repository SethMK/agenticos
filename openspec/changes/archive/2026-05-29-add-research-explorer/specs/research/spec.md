# Research capability — delta for Explorer

## ADDED Requirements

### Requirement: Research data artifact
The site SHALL publish a structured `research` dataset under `public.json`, containing thematic groups,
validated learnings, in-progress (watched) hypotheses, and a backlog of untested hypotheses, each
validated or watched item carrying evidence as a count `n` and lists of sprint and story anchors.

#### Scenario: Build merges research data
- GIVEN a valid `data/snapshots/research.json` that passes the Zod schema
- WHEN the build pipeline runs
- THEN `public.json` contains a `research` key with `groups`, `validated`, `watching`, and `backlog`
- AND each `validated` item exposes `evidence.n`, `evidence.sprints[]`, and `evidence.stories[]`

#### Scenario: Invalid data fails the build
- GIVEN a `research.json` that violates the schema
- WHEN the build pipeline runs
- THEN the build fails with a schema validation error rather than emitting a malformed `public.json`

### Requirement: Explorer page
The site SHALL serve a prerendered `/research/explorer` page presenting the research dataset as a
three-pane faceted browser: filters and an evidence-by-recency scatter, a card list, and a detail panel.

#### Scenario: Default render
- GIVEN the Explorer page is loaded
- WHEN it finishes rendering
- THEN every hypothesis appears as a card and as a dot on the scatter
- AND the scatter encodes evidence count on the x-axis, recency on the y-axis, count by dot size, and state by colour

#### Scenario: Inspect a hypothesis
- GIVEN the Explorer page is loaded
- WHEN the user clicks a card or its scatter dot
- THEN the detail panel shows that hypothesis's claim, best-practice, and evidence trail (n + anchors)

### Requirement: Faceted filtering
The Explorer SHALL let the user filter the dataset by state (validated / watching / backlog) and by
theme group, updating the card list and scatter together.

#### Scenario: Filter by state
- GIVEN all states are shown
- WHEN the user deselects the "backlog" state
- THEN backlog cards are hidden and backlog dots are dimmed on the scatter

### Requirement: House style and accessibility
The Explorer SHALL use the existing design tokens (near-black canvas, single accent, monospace, sharp
corners, tabular numerals) and introduce no new design tokens, and SHALL meet WCAG-AA with keyboard
navigation and reduced-motion support.

#### Scenario: Keyboard and reduced motion
- GIVEN a keyboard-only user with `prefers-reduced-motion` enabled
- WHEN they tab through the cards and select one
- THEN every interactive element is focusable with a visible focus ring
- AND no non-essential transition or animation plays
