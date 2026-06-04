# Add Research Explorer page

## Why

The project has accumulated 30+ validated learnings, ~18 constraints, and a backlog of untested
hypotheses across 34 sprints (sourced from the PMO repo: `notes/research/lessons-from-35-sprints.md`,
`constraint-history.md`, `_pending-next.md`). Today they exist only as prose. There is no public,
browsable surface that lets a visitor explore *what the project has learned* by theme, by weight of
evidence, or by recency.

This change adds `/research/explorer` — a faceted browser (the "Hypothesis Explorer" concept,
validated as a hi-fi mockup) — in the existing terminal-first house style.

It is also the first delivery of an **OpenSpec adoption experiment** (PMO hypothesis
`H-openspec-adoption`): we build this page spec-first to measure whether spec-driven development
reduces rework and improves traceability versus our prior acceptance-bullet + agent-brief flow.

## What Changes

- Add a hand-curated `data/snapshots/research.json` (learnings, constraints, in-progress, backlog
  hypotheses, each with evidence `{n, sprints[], stories[]}`), merged into `public.json` at build.
- Add reusable research components (cards, evidence badge, status filter).
- Add the `/research/explorer` page: a 3-pane faceted layout — filters + an evidence×recency scatter
  on the left, a card list in the centre, a detail panel on the right.
- Add a nav entry and a Playwright e2e spec.

## Impact

- Affected specs: `research` (new capability)
- Affected code: `data/snapshots/research.json`, `data/pipeline/snapshot.ts`,
  `src/components/research/*`, `src/pages/research/explorer.astro`,
  `src/layouts/TerminalLayout.astro`, `tests/e2e/research-explorer.spec.ts`
- No change to existing pages; additive only.
