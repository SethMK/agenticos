# Tasks — Research Explorer

> PMO mapping: 1.x → S124 · 2.x → S125 · 3.x → S126 · 4.x → S127 (epic E16).

## 1. Research-data foundation (S124)
- [x] 1.1 Author `data/snapshots/research.json` from PMO docs (seed = mockup `data.js`): groups A–F, validated, watching, backlog
- [x] 1.2 Add `data/pipeline/research.schema.ts` (Zod) and validate at build
- [x] 1.3 Merge `research` key into `public.json` in `data/pipeline/snapshot.ts`
- [x] 1.4 Attribution-coverage check: every evidence anchor (sprint/story) resolves to a real entity, not a synthetic bucket

## 2. Base components (S125)
- [x] 2.1 `LearningCard`, `ConstraintCard`, `HypothesisCard` (shared props, state-coloured left border)
- [x] 2.2 `EvidenceBadge` (n + sprint/story anchors) and `StatusFilter` (state + group toggles)
- [x] 2.3 All on existing tokens — no new design tokens introduced

## 3. Explorer page (S126)
- [x] 3.1 `src/pages/research/explorer.astro` — 3-pane grid, reads `public.json.research`
- [x] 3.2 Inline-SVG scatter: x=evidence n, y=recency, size=n, colour=state; filters dim non-matching dots
- [x] 3.3 Card list (centre) + detail panel (right); click/keyboard select; hover dot ↔ highlight card
- [x] 3.4 Responsive collapse to single column < 980px; reduced-motion safe

## 4. Wiring, test, perf (S127)
- [x] 4.1 Nav link in `src/layouts/TerminalLayout.astro` — added `research →` link next to how-it-was-built; gap: var(--space-4) separates links
- [x] 4.2 `tests/e2e/research-explorer.spec.ts` — 6 tests, all pass (6/6): render/card-count, filter dim cards+dots, click→detail (claim+practice+evidence), 375px/768px single-col, 1280px three-col
- [x] 4.3 Perf: dist/client/research/explorer/index.html gz = 7,851 bytes (≤ 50 KB ✓). Raw = 36,076 bytes.
- [x] 4.4 Experiment metrics (H-openspec-adoption): Spec-Gate FAIL/re-gate for add-research-explorer = 0 (tests green first run). Implementer tokens: see final line. QA tokens: see final line.
