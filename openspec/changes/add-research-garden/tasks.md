# Tasks — Research Garden

> PMO mapping: spike S130 (scaffold) · 1.x + 2.x → S131 (data + page, epic E18) · 3.x → S132 (wiring).
> Depends on add-research-explorer + add-research-tracker (data foundation + base components + tokens).

## 1. Data foundation (S131)
- [x] 1.1 Author `requires: string[]` on every node in `data/snapshots/research.json` (validated/watching/backlog) per spike §1 edge table; roots `[]`.
- [x] 1.2 `data/pipeline/snapshot.ts` — compute `public.json.research.garden = { nodes[], edges[] }`: derive `state` (locked/available/watching/validated) + `tier` (longest dependency depth, memoised DFS); `edges` = inverted `requires`.
- [x] 1.3 attribution-coverage: every edge maps to a real `requires` entry; every node id exists in exactly one source tier; no synthetic nodes. QA re-derives one node's `state` + `tier` from the raw dataset = exact match.
- [x] 1.4 jq smoke: `jq '.research.garden.nodes[0]'` and `jq '.research.garden.edges|length'` return non-null; `bun run build` exits 0.

## 2. Garden page (S131)
- [x] 2.1 `src/pages/research/garden.astro` — prerendered; reads `public.json.research.garden`.
- [x] 2.2 Layered-DAG inline SVG + ~40-line tier layout helper (no heavy deps); edges as SVG `<path>`.
- [x] 2.3 State-driven nodes: validated (filled + severity + ✓) · watching (progress arc + `n=k/threshold`) · available (dashed + score) · locked (greyed + 🔒 + score). Signal by shape + glyph + text, not colour-only.
- [x] 2.4 Responsive: horizontal DAG wide → vertical tier-stacked sections `< 880px`, no horizontal scroll; reduced-motion safe; existing design tokens only (no new CSS custom properties).

## 3. Wiring, test (S132)
- [x] 3.1 Nav link `/research/garden` in `src/layouts/TerminalLayout.astro`.
- [x] 3.2 `tests/e2e/research-garden.spec.ts` — render; node-state counts match data; edge count = Σ node.requires; responsive collapse; reduced-motion.
- [x] 3.3 Log experiment metrics; with Explorer + Tracker (n=3) update the `H-openspec-adoption` record (GO confirmed / review).

### 3.3 Experiment metrics (S131, SPR-043)

| Change | Implementer (self-report) | QA (ground-truth) | Spec-Gate FAILs | Driver modelUsage |
|---|---|---|---|---|
| add-research-garden (S131) | ~200k | 79k | 0 (inline-gate PASS vs prototype) | 6,320k (Sonnet, 44t) |

**H-openspec-adoption n=3 — GO CONFIRMED.** 3rd spec-first cross-window change built with 0 Spec-Gate FAILs (Explorer S124-127 + Tracker S128-129 + Garden S131). Prototype-first + OpenSpec spec → inline-Spec-Gate eligibility held on a NOVEL layout (layered DAG). GO reaffirmed for E18 (done) + future cross-window work. Caveat unchanged: win is OpenSpec **+ prototype-first** together.
