# Add Research Garden page

## Why

The Explorer answers "what have we learned?" and the Tracker answers "what is confirmed / close / queued?".
Neither answers the *pedagogical* question: "in what order were these insights earned, and what does each one
unlock?" The learnings form a real prerequisite lattice — you cannot trust a token number (E1) before cost
follows-the-checking (A1) makes sense; the helper wake-up floor (A2) is what makes batching beat fan-out (D2).

This change adds `/research/garden` — an **RPG skill-tree** view of the research dataset. Each hypothesis is a
node; validating a hypothesis unlocks its dependents (`locked → available → watching → validated`). It reuses
the `research.json` data foundation, base components, and design tokens from the Explorer/Tracker changes.

It is the **third data point** in the OpenSpec adoption experiment (`H-openspec-adoption`, verdict GO at n=2) —
the first change authored after the GO decision, extending the evidence to n=3.

## What Changes

- Author `requires: string[]` (prerequisite hypothesis ids) on every node in `research.json` — carries the edges.
- `snapshot.ts` emits a computed `public.json.research.garden` = `{ nodes[], edges[] }` with derived `state`
  (locked/available/watching/validated) and `tier` (longest dependency depth).
- Add the `/research/garden` page: a layered-DAG inline-SVG skill-tree (lib-free, ~40-line tier helper), nodes
  drawn by state (shape + glyph + text, not colour-only), edges as SVG paths, responsive collapse `< 880px`.
- Add a nav entry and a Playwright e2e spec.

## Impact

- Affected specs: `research` (extends the capability with a skill-tree / dependency view)
- Affected code: `data/snapshots/research.json` (authored `requires`), `data/pipeline/snapshot.ts`
  (compute `garden`), `src/pages/research/garden.astro`, `src/components/research/*` (reused),
  `src/layouts/TerminalLayout.astro`, `tests/e2e/research-garden.spec.ts`
- Depends on `add-research-explorer` + `add-research-tracker` (data foundation + base components); additive only.
- PMO mapping: spike S130 (this scaffold) · 1.x+2.x → S131 (data + page) · 3.x → S132 (wiring), epic E18.
