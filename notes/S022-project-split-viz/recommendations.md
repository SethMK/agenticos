# S022 — Project Split Viz: Recommendations

## Real counts

- **Work: 26**
- **Personal: 7**
- **Total: 33** (verified against PROJECTS stat card in `data/snapshots/public.json`)
- **Classifier:** `classify.sh` — reads `data/snapshots/ops.json` (the un-redacted snapshot), classifies each project_raw on substring `-Users-marcinkokott-Projects-personal-`, asserts total == 33 as a drift guard.

**Filter reconciliation:** `ls ~/.claude/projects` yields 35 directories on 2026-05-11, but the dashboard reports 33. The two-row delta is the pipeline filter in `data/pipeline/snapshot.ts`: a project is counted only if it produced at least one billable assistant turn (i.e. an `assistant` record where `msg.model !== "<synthetic>"` and a `usage` object is present). Two on-disk dirs (`-Users-marcinkokott-Projects-personal` with no trailing dash, and one work dir) exist but emit zero billable turns and are dropped at the `aggregate → set(project_hash)` step. The classifier reads the snapshot directly so it stays locked to the rendered number rather than re-walking the FS.

## Variants

### variant-1-language-bar.html — single horizontal segmented strip (GitHub languages style)

- **Pros:**
  - Visually consistent with `ModelSplitChart.astro` — segmented horizontal bars are the page's established idiom for "share of one whole".
  - 78.8 / 21.2 split reads at a glance.
  - Smallest bundle cost; reuses existing component grammar (hairline border, dotted-bottom legend rows, accent + accent-dim swatches).
  - Mobile-friendly: bar collapses naturally, legend stays two rows.
- **Cons:**
  - Familiar / "expected" — no novelty payoff beyond what ModelSplitChart already delivers.
  - The 7-project personal segment is short; needs the legend below the bar to read the raw count, can't fit "7" inside the segment.
- **Bundle impact (rough):** ~2.5 KB raw component CSS+markup, ~0.9 KB gz. Net page increase ~0.8–1.0 KB gz (existing page is ~6.3 KB gz post-S018).

### variant-2-dual-gauges.html — two SVG ring gauges side by side, big mono counts inside

- **Pros:**
  - High visual punch — the two filled arcs read as "two worlds, both substantial" even though one is 3x the other.
  - Big monospace `26` / `7` inside the rings borrow the StatCard ramp; numbers stay the loudest element.
  - The circle geometry signals "this is a different category of viz" — the eye lingers.
- **Cons:**
  - **Fights the design language.** `tokens.css` line 96 mandates `--border-radius: 0` and "sharp corners by default". `ModelSplitChart.astro:14` explicitly rejected the donut for this reason — circles vs the dashboard's "square / hairline grammar". Picking gauges here would relitigate a decided question.
  - Each gauge is its own visual unit — easy to forget the 33 is the union of both, not a separate stat.
  - SVG transforms (rotate -90deg) increase the per-instance complexity.
- **Bundle impact (rough):** ~2.8 KB raw, ~1.0 KB gz. Slightly heavier than variant 1 because of the two SVGs.

### variant-3-stat-card-pair.html — two side-by-side mini stat cards in the existing PROJECTS slot

- **Pros:**
  - Lowest-risk integration. The shape, padding, and corner-bracket vocabulary are identical to `StatCard.astro`.
  - Drop-in replacement: literally replaces the single `<StatCard label="PROJECTS" ... />` cell in `index.astro:47` with this pair, no grid rework.
  - Each card carries its own delta-line slot, so future enhancements (e.g. "+2 vs prior month") plug in trivially.
- **Cons:**
  - **Doesn't visualise the split** — it's two numbers next to each other with a hint of a progress bar. The "breadth across worlds" signal gets lost in the existing 6-card grid.
  - Adds a 7th stat tile to a page already running close to capacity (3 columns × 2 rows). On mobile the row reflows to 1-col and the work/personal pairing dissolves.
- **Bundle impact (rough):** ~3.0 KB raw, ~1.0 KB gz. Highest CSS surface because it duplicates StatCard's bracket + delta scaffolding, but all of it could ride on the existing `.stat-card` class with one new modifier.

### variant-4-bracket-annotation.html — big counts above, annotated stacked SVG bar with tick labels

- **Pros:**
  - Most distinctive of the four — the tick-annotated bar reads as a CLI/`ps`-style summary, leans hardest into the "terminal first" aesthetic.
  - Big `26` / `7` numbers at the top do the heavy stat-card work; the bar below adds geometric reinforcement; the `26:7 ratio` footer adds a third readout in case someone scans the bottom of the card.
  - Hand-rolled SVG with `preserveAspectRatio="none"` keeps the bar fluid at any container width.
- **Cons:**
  - Three separate readouts of the same number (top counts, bar segments, ratio footer) edge into "over-explaining". Some viewers will read it as cluttered.
  - The largest of the four (~3.4 KB raw). Bracket-annotation logic is bespoke — harder to extend later if a third bucket is ever introduced.
  - Slight risk of visual conflict with the corner brackets already on every StatCard — there's now bracket-annotation language on top of bracket-frame language.
- **Bundle impact (rough):** ~3.4 KB raw, ~1.2 KB gz.

## Recommendation: **variant-1-language-bar**

The dashboard already has a "share of one whole" viz (`ModelSplitChart`), and it deliberately chose the horizontal segmented bar over a donut because the page's grammar is square + hairline. The work/personal split is *the same kind of question* — proportional share of a single total — so reusing the same idiom is honest, not lazy. The 26:7 segmentation makes the recruiter narrative ("ships volume at work, balances with personal range") visually immediate without inventing new design language. Variant 4 is a tempting runner-up if Marcin wants more swagger, but the cleaner read is the language-bar.

## Implementation sketch (for S023)

- **Target file:** `src/components/ProjectSplitChart.astro` (new — sits alongside `ModelSplitChart.astro`)
- **Page integration:** sits *below* the 6-card stats grid in `src/pages/index.astro`, between the stats grid and `ModelSplitChart`. Keep the existing single `PROJECTS` stat card unchanged at 33 — the new component is the breakdown, not a replacement.
- **Data source:** add `counts.projects_by_classification: { work: number, personal: number }` to `data/snapshots/public.json`. In `data/pipeline/snapshot.ts:596-603`, replace the current `counts` block with:
  ```ts
  const projectHashes = Array.from(new Set(priced.map((r) => r.project_hash)));
  // Build a hash → first-seen project_raw map for classification (privacy: classification is
  // a boolean derived from path shape; the raw name doesn't leak into public.json).
  const rawByHash = new Map<string, string>();
  for (const r of priced) if (!rawByHash.has(r.project_hash)) rawByHash.set(r.project_hash, r.project_raw);
  const personal = projectHashes.filter((h) =>
    (rawByHash.get(h) ?? "").includes("-Users-marcinkokott-Projects-personal-"),
  ).length;
  const counts: SnapshotCounts = {
    projects: projectHashes.length,
    projects_by_classification: { work: projectHashes.length - personal, personal },
    skills: skillsTotal,
    // ...
  };
  ```
  Update the `SnapshotCounts` type at line 443 to include the new field.
- **Bundle estimate:** +0.8–1.0 KB gz vs current ~6.3 KB gz page (within budget).
- **Open questions for Marcin:**
  1. **Does the unredacted classification hint at private path shapes?** The `personal` count itself is fine; nobody can reverse-engineer paths from the integer 7. But if S023 ever surfaces *which* projects are personal (e.g. a list), that's a different story. Recommend keeping S023 strictly aggregate.
  2. **Worktree dedup?** Two of the seven "personal" entries are `--claude-worktrees-…` shadows of real projects (Future, Personal). If we dedup, personal drops to 5 and total drops to 31 — but that changes the headline PROJECTS number, which is a bigger contract change than this spike. Suggest: ship S023 with the current 26/7, file a separate story to decide on worktree-vs-project dedup.
  3. **Position priority** vs the still-unbuilt project tokens chart (S006-equivalent)? If a future "tokens per project" bar lives on the same page, two project-related charts stacked could be a lot. Place S023 below stats + above ModelSplitChart, leave the tokens-per-project for a dedicated row.
