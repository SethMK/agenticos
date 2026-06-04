# Design — Research Explorer

## Data flow

PMO prose is the source of truth but is too narrative to parse safely. We therefore hand-curate a
structured artifact and treat the PMO docs as the human-readable origin:

```
PMO docs (prose)  --curate-->  data/snapshots/research.json  --merge at build-->  public.json.research
                                                                                        |
                                                            src/pages/research/explorer.astro (prerender)
```

- `research.json` is validated with a Zod schema at build (`data/pipeline/research.schema.ts`).
- `data/pipeline/snapshot.ts` imports it and writes it under the `research` key of `public.json`,
  alongside the existing `pmo`/`totals` keys (same pattern as `how-it-was-built.astro`).
- Re-curated at sprint close; a `generated_at` + freshness check surfaces staleness.

### Schema (shape — seed = PMO mockup `data.js`)

```ts
research: {
  generated_at: string;
  groups: { id, title, blurb }[];                 // A..F themes
  validated: { id, group, title, claim, practice,
               evidence:{ n, sprints[], stories[] }, severity }[];
  watching:  { id, group, title, claim, n, threshold, sprints[], note }[];
  backlog:   { id, title, category, score, claim, artifact }[];
}
```

## Layout

3-pane CSS grid (`260px | 1fr | 320px`), collapsing to a single column < 980px:
- **Left (sticky):** facet filters (state, group) + an inline-SVG scatter — x = evidence `n`,
  y = recency (latest sprint ordinal), dot size = `n`, colour = state. Filters dim non-matching dots.
- **Centre:** card list (one card per hypothesis), filtered live, keyboard-navigable.
- **Right (sticky):** detail panel for the selected item — claim, best-practice, evidence trail.

## House style / a11y

Reuse `src/styles/tokens.css` verbatim — near-black canvas, single amber accent, mono-only, sharp
corners, tabular numerals. No new design tokens. Scatter is functional (every channel encodes data),
not decorative. WCAG-AA contrast; `:focus-visible` rings; `prefers-reduced-motion` disables transitions;
SVG carries `role="img"` + label.

## Tech

Astro prerendered page; vanilla JS for filter/scatter/detail interactivity (no chart lib — inline SVG,
matching the existing chart components). Perf budget ≤ 50 KB gz. Reference prototype:
PMO `notes/research/learnings-page-mockups/02-explorer.html`.
