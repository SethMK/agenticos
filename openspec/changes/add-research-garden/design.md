# Design — Research Garden (skill-tree)

Source spike: PMO `notes/spikes/2026-06-01-garden-skill-tree-S130.md` (S130).

## Dependency model (DAG, not tree)

Every node gains `requires: string[]` — the hypotheses that must be **validated** before this node is
reachable. It is a DAG: six nodes have two prerequisites (B1, B3, C3, F1, W5, H2). Roots (no prereq): **E1**
(measurement honesty) and **C1** (parallel safety). Edge direction: `requires` points back to the prerequisite;
the rendered edge goes prereq → dependent.

Authored edges (see spike §1 for the full table): e.g. A1←E1 · A2←E1 · A3←A2 · B1←E1,A1 · B3←A1,A2 ·
D2←A2 · C2←A1 · D1←A1 · B2←B1 · C3←A2,B1 · F1←D1,D2 · W5←A2,C3 · H2←E1,A3 · H5←H2 (locked behind a backlog node).

## Node-state taxonomy

Derived, not authored:
```
prereqsMet(node) = node.requires.every(r => r ∈ validatedIds)
state = validated ? "validated"
      : watching  ? (prereqsMet ? "watching" : "locked")
      : backlog   ? (prereqsMet ? "available" : "locked")
```
- **validated** — earned skill: filled node, group-accent border, severity dot, ✓.
- **watching** — in progress: outline + progress arc, text `n=k/threshold` (reuse Tracker meter).
- **available** — prereqs met, not started: dashed outline, "+score".
- **locked** — unmet prereq: greyed, 🔒, score.

Signal by **shape + glyph + text**, never colour alone (WCAG-AA, reduced-motion, existing tokens only).

## Computed emit (`public.json.research.garden`)

`snapshot.ts` produces `{ nodes:[{id,group,title,state,tier,requires, severity|score|n+threshold}], edges:[{from,to}] }`.
- `tier` = longest-path depth from a root (memoised DFS over `requires`; root tier = 0).
- `edges` = invert each node's `requires` into one `{from: prereq, to: node}` per requirement.
- Pure derivation; attribution-coverage = every edge maps to a real `requires` entry and every node id exists
  in exactly one source tier (no synthetic nodes).

## Layout / rendering

**Layered DAG (Sugiyama-lite), lib-free inline SVG + a ~40-line tier helper. No d3/cytoscape/dagre.**
- Column per `tier`; vertical slot per node within a tier. `x = tier·colGap`, `y = slot·rowGap`.
- Edges = SVG `<path>` cubic Béziers (prereq right-anchor → dependent left-anchor).
- Wide: horizontal layered DAG. `< 880px`: collapse to vertical tier-stacked sections, edges hinted by
  "unlocks →" text. No horizontal scroll.
- Reuses Explorer's inline-SVG approach + existing design tokens → expected **layout-only / no-new-tokens**
  cost band, not full component-build.

## Decisions

- **DAG vs tree:** DAG — the multi-parent prerequisite lattice is the point.
- **Lib-free vs layout lib:** lib-free + minimal helper — keeps zero new client JS bytes, matches Explorer.
- **State stored vs computed:** edges authored (`requires`), state + tier computed — single source of truth, no
  drift between authored state and the validated set.
