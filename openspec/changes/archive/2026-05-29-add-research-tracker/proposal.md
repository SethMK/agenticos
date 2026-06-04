# Add Research Tracker page

## Why

Browsing the full research dataset (the Explorer) answers "what have we learned?". It does not answer
the *operational* question: "what is confirmed, what is close to being confirmed, and what is queued?"

This change adds `/research/tracker` — the "Live Experiment Tracker" concept (validated as a hi-fi
mockup) — a CI/CD-style board with three lanes (validated / watching / queued), progress meters toward
each watched hypothesis's promotion threshold, and status badges. It reuses the `research.json` data
foundation and base components delivered by the Explorer change.

It is the **second data point** in the OpenSpec adoption experiment (`H-openspec-adoption`): with two
spec-first cross-window pages built, we can compute a GO/NO-GO on adopting OpenSpec.

## What Changes

- Add the `/research/tracker` page: a metric strip + three lanes; watched items show an `n=k/threshold`
  progress meter; backlog items show score-ranked queue cards.
- Reuse `research.json`, the base components, and the design tokens from the Explorer change.
- Add a nav entry and a Playwright e2e spec.

## Impact

- Affected specs: `research` (extends the capability with a tracker view)
- Affected code: `src/pages/research/tracker.astro`, `src/components/research/*` (reused/extended),
  `src/layouts/TerminalLayout.astro`, `tests/e2e/research-tracker.spec.ts`
- Depends on `add-research-explorer` (data foundation + base components); additive only.
