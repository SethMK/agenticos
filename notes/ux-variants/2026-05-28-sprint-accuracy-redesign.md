# Sprint Accuracy (Time) Redesign — Mode 3 Variant Review

**Date:** 2026-05-28  
**Reviewer:** ux-reviewer  
**Target component:** `src/components/SprintAccuracyTime.astro` (base: `StackedBarSprintComparison.astro`)  
**Sprint:** SPR-025 planning input  

---

## ⭐ Marcin Verdict (2026-05-27 22:45 PMO-pick)

**Picked: Variant C (median-normalized scale + outlier glyph) + Variant E (brush/zoom).**

Override of Mode 3 Rank 1 recommendation (C + D). Reasoning is Marcin's product call — E provides historical-context visual layer (overview strip showing ALL sprints compressed) that D's pure-windowing loses. C still handles outlier-readability. E inherits median-normalized scale in the main panel from C — variants compose naturally.

**Trade-off accepted:** E carries higher implementation cost (~30 lines JS for live brush drag, OR static "last 10 fixed window" if zero-JS preserved). Mode 3 mocked the zero-JS static fallback — viable Phase 1 ship. JS drag upgrade = follow-up story.

**SPR-025 must basket (per pick):**
- Story C — `S-TIME-SCALE` (3 pts) — see spec below at line 85
- Story E — `S-TIME-BRUSH` (3 pts) — see DRAFT spec appended below at "## Marcin-added Story S-TIME-BRUSH (Variant E)"
- Story C-basecomponent typecheck (1 pt, optional bundle) — see spec at line 158

D story (`S-TIME-WINDOW`) deferred or dropped per Marcin pick.

---

## Problem Summary

Two compounding problems make the current chart unreadable as sprint count grows:

**Problem 1 — Outlier scale collapse.** SPR-010 actual wall-clock = 168m vs plan = 60m (2.80×). Linear auto-scale sets Y_MAX = 168 × 1.15 ≈ 193m. All 22 other sprints (range: 3m–90m) compress into the bottom 47% of plot height. At the current SVG geometry (PLOT_H = 152px), most sprint bars render at ≤37px tall — indistinguishable from noise.

**Problem 2 — Density at 23 sprints.** Slot width = 584/23 ≈ 25.4 px/sprint. Each slot already hosts two bars + labels + overrun glyph. Adding SPR-024..050 makes this unreadable. The `.slice(-30)` UsageChart precedent was not applied here.

---

## Real Data Summary (from `data/snapshots/public.json`)

| Sprint | Plan (min) | Actual (min) | Ratio | Overrun? |
|--------|-----------|--------------|-------|----------|
| SPR-001..008 | 60 | 13–41 | 0.22–0.68 | No |
| SPR-009 | 60 | 73 | 1.22 | No |
| **SPR-010** | **60** | **168** | **2.80** | **YES** |
| SPR-011 | 60 | 90 | 1.50 | Borderline |
| SPR-012..013 | 60 | 8–20 | 0.13–0.33 | No |
| SPR-014..018 | 90 | 27–45 | 0.30–0.50 | No |
| SPR-019 | 60 | 3 | 0.05 | No |
| SPR-020 | 90 | 113 | 1.26 | No |
| SPR-021..023 | 90 | 19–59 | 0.21–0.66 | No |

Median actual = 35m. Only SPR-010 exceeds the 1.5× threshold.

---

## Variant Comparison Table

| Dimension | A: Log-Scale | B: Broken-Axis | C: Median-Norm + Glyph | D: Recent-N Window | E: Brush/Zoom | F: Sparkline Cards |
|---|---|---|---|---|---|---|
| **Outlier readability** | Good — outlier visible at correct height; other bars spread across full range | Good — outlier isolated in labelled band; normal band at full resolution | Best — normal band uncompressed; outlier reduced to numerical glyph | Excellent (default view) — outlier absent from default window; appears in "all" with glyph | Excellent (main panel) — outlier only in compressed overview | Excellent — each card self-contained; SPR-010 clearly marked |
| **Cross-sprint comparison flow** | Good — relative heights comparable under log transform | Good — normal sprints fully comparable; outlier excluded from flow comparison | Good — normal sprints comparable; off-scale sprints lose bar-to-bar height comparison | Good (last 10 default) — limited to window; full view loses density | Good (main panel) — window provides clean comparison | Partial — horizontal bars comparable per card, but vertical trend hard to read |
| **Scalability to 50 sprints** | Poor — 50 slots × 2 bars = 12.7 px/sprint, illegible x-axis | Poor — same density problem | Poor — same density problem; glyph column gets cluttered | Excellent — default window stays fixed; overflow handled by "show all" + glyph | Good — overview strip compresses well; main panel stays fixed-width | Excellent — CSS grid wraps naturally; 50 cards ≈ same layout |
| **Terminal aesthetic fit** | Moderate — log axes feel analytical rather than terminal | Good — zig-zag break is a known dataviz convention, readable with legend | Best — amber median reference line, danger glyphs fit the terminal vocabulary natively | Best — clean window cut matches CLI pagination idiom | Moderate — brush handle implies GUI interaction; static fallback looks incomplete | Good — grid of cards has terminal "table" feel; dense but legible |
| **Implementation cost (est.)** | Low — 5 lines: replace `yV()` function, regenerate tick labels | Medium — new `yBreak` layout, two coordinate zones, connector lines for outlier | Low — add `Y_CAP = median * 2.5` constant, clipping logic, off-scale glyph branch | Low-Medium — add `windowed` prop + CSS `:target` toggle (or Astro server state) | High — two SVG panels, brush rect, overview bar generation; JS needed for live drag | Medium-High — replace SVG with HTML/CSS card grid, per-card bar widths |
| **Zero-JS requirement** | Full — pure SVG math | Full — pure SVG | Full — pure SVG | Full for static default (CSS `:target` for toggle) | Partial — static mockup is zero-JS; live brush requires ~30 lines JS | Full — pure CSS flex/grid |
| **Risk of reader confusion** | High — log axes require annotation; non-technical readers misread equal distances | Medium — break convention is non-standard; requires legend explanation | Low-Medium — off-scale glyph is self-documenting if label includes value | Low — pagination is universally understood | Low-Medium — brush metaphor familiar to dashboard users but not terminal users | Low — ratio value on each card removes ambiguity |
| **Matches existing sibling patterns** | No — no other log-scale chart exists | No — no other broken-axis chart | Partial — danger glyph matches overrun glyph pattern; median line matches UsageChart accent-line style | Yes — `.slice(-N)` exact precedent in `UsageChart.astro` | No — brush is novel in this codebase | No — card grid pattern exists in stat cards but not in chart components |

---

## Ranked Recommendation

### Rank 1: Variant C (Median-Normalized Scale + Outlier Glyphs) + Variant D (Recent-N Window) — Combined

**Recommended implementation strategy for SPR-025:**

Implement both solutions as complementary layers in `StackedBarSprintComparison.astro`:

1. **Scale fix (C):** Replace `Y_MAX = rawMax * 1.15` with `Y_CAP = median(actuals) * 2.5`. Any sprint whose bar would exceed `Y_CAP` renders a clipped stub + numerical `↑ NNNm` glyph. This is a 1-file, 15-line change in the base component. Handles the outlier without axis distortion or log math.

2. **Density fix (D):** Add `windowSize={10}` prop to `StackedBarSprintComparison`. Default render uses `.slice(-windowSize)`. Expands to full set with a static `<a href="#all">show all</a>` link (CSS `:target` swap). This matches the `UsageChart.slice(-30)` precedent exactly.

The combination gives: (a) readable default view of recent sprints with linear scale and no density problem, (b) outlier-safe scale even if SPR-010-class events recur, (c) full history accessible on demand. Both fixes are composable without changing the public API.

### Rank 2: Variant D alone

If only one fix ships in SPR-025, the windowing fix gives the most immediate relief. The outlier is already outside the default last-10 window. Cost: ~20 lines added to the base component.

### Rank 3: Variant B (Broken-Axis)

Best visual clarity for the outlier problem in isolation, but doesn't address the density/scalability issue and adds implementation complexity (two coordinate zones). Suitable as an enhancement if Variant C is rejected.

### Not recommended: A (Log-scale), E (Brush), F (Cards)

- **A** risks reader misinterpretation; no other log chart in the codebase; poor fit for terminal aesthetic.
- **E** requires JS for live interaction; static fallback loses the "brush" value proposition.
- **F** eliminates temporal trend reading, which is the primary purpose of this chart.

---

## Proposed Stories for SPR-025

### Story S-TIME-SCALE (3 pts)

**Title:** SprintAccuracyTime — median-normalized scale + outlier glyph

**Problem:** Linear Y_MAX = rawMax × 1.15 crushes 22/23 normal sprint bars when SPR-010 (168m) is present.

**Approach:** In `StackedBarSprintComparison.astro`, replace raw-max scale with median-normalized cap.

**Files to modify:**
- `src/components/StackedBarSprintComparison.astro` (only)

**Implementation sketch:**
```
const sortedActuals = sprints.map(s => s.bTotal).sort((a,b) => a-b);
const medianActual = sortedActuals[Math.floor(sortedActuals.length / 2)];
const Y_CAP = medianActual * 2.5;
const Y_MAX = Math.max(Y_CAP, sprints.reduce((m,s) => Math.max(m, s.aTotal), 0) * 1.15);
// For each sprint where bTotal > Y_CAP: clip bar at Y_CAP, render off-scale glyph with numerical label
```

## Acceptance

1. `bun run build` exits 0 — no TypeScript errors.
2. `grep -n "rawMax" src/components/StackedBarSprintComparison.astro` returns 0 matches (old formula removed).
3. `grep -n "medianActual\|Y_CAP" src/components/StackedBarSprintComparison.astro` returns ≥2 matches.
4. Manual visual (dev server): with 23 sprint data, SPR-001..009 bars occupy >30% of chart height (not crushed).
5. Manual visual: SPR-010 renders an `↑ 168m` glyph above the chart cap line (not a full-height bar).
6. Manual visual: SPR-020 (113m, plan=90m) renders as a bar taller than the plan bar — SPR-020 is within cap (90m × 2.5 = 225m > 113m → no glyph needed if plan is 90m).
7. Overrun glyph (danger color) still fires for SPR-010 (ratio > 1.5×). Off-scale glyph and overrun glyph coexist on same sprint.
8. `docs/verify-log.md` has new row for this story.

**Estimated:** 3 pts · est_tokens_k: 35k · est_minutes: 25

---

### Story S-TIME-WINDOW (2 pts)

**Title:** SprintAccuracyTime — windowed view (last 10 default)

**Problem:** 23 slots × 2 bars = 25px slot width, already at minimum. 50-sprint horizon makes the chart unreadable.

**Approach:** Add optional `windowSize` prop to `StackedBarSprintComparison.astro`. Default=10. Static link shows full history.

**Files to modify:**
- `src/components/StackedBarSprintComparison.astro`
- `src/components/SprintAccuracyTime.astro` (pass `windowSize={10}`)
- `src/components/SprintAccuracyTokens.astro` (same prop, keep default or set windowSize={10})

**Implementation sketch:**
```astro
// In StackedBarSprintComparison.astro Props:
windowSize?: number;  // default: all sprints

// In script:
const displayData = windowSize ? data.slice(-windowSize) : data;
// render displayData instead of data
// Add "showing last N of M" footer text when windowed
```

## Acceptance

1. `bun run build` exits 0.
2. `grep -n "windowSize" src/components/StackedBarSprintComparison.astro` returns ≥3 matches (prop declaration, destructure, usage).
3. `grep -n "windowSize" src/components/SprintAccuracyTime.astro` returns ≥1 match (prop passed).
4. Manual visual: default chart renders 10 bars (SPR-014..023), not 23.
5. Manual visual: chart footer shows "showing last 10 of 23 sprints" (or equivalent count text).
6. `grep -n "slice" src/components/StackedBarSprintComparison.astro` returns ≥1 match.
7. `docs/verify-log.md` has new row for this story.

**Estimated:** 2 pts · est_tokens_k: 20k · est_minutes: 15

---

### Story S-TIME-BASECOMPONENT (1 pt)

**Title:** Verify StackedBarSprintComparison props are typed correctly after S-TIME-SCALE + S-TIME-WINDOW

**Problem:** Two new props added in parallel stories may create TypeScript interface drift.

**Approach:** After both stories ship, run `bun run build` and `tsc --noEmit` to confirm no type errors. If errors found, fix interface and re-run.

## Acceptance

1. `bun run build` exits 0.
2. `npx tsc --noEmit` exits 0 (or equivalent type check command per project).
3. `grep -n "windowSize\|Y_CAP\|medianActual" src/components/StackedBarSprintComparison.astro` returns all expected identifiers.
4. Both consumers (`SprintAccuracyTime.astro`, `SprintAccuracyTokens.astro`) pass typecheck.
5. `docs/verify-log.md` has new row for this story.

**Estimated:** 1 pt · est_tokens_k: 8k · est_minutes: 8

---

## Marcin-added Story S-TIME-BRUSH (Variant E · 2026-05-27 PMO-pick)

**Title:** SprintAccuracyTime — brush/zoom two-panel layout (E)

**Problem:** Windowing alone (D) loses historical context. Need to see ALL sprints' relative position + outliers AT A GLANCE while still rendering recent sprints at full resolution.

**Approach (Phase 1, zero-JS static):** Two-panel SVG layout in `StackedBarSprintComparison.astro`:
- **Main panel (top, ~180px h):** last 10 sprints at full resolution, with `Y_CAP = median × 2.5` (inherits from S-TIME-SCALE / Variant C). Median-normalized scale + outlier glyphs apply.
- **Overview panel (bottom, ~50px h):** ALL N sprints as 3px-wide compressed stub bars. Window indicator = semi-transparent `<rect>` overlaying the last-10 region of the overview. Static — no JS drag.
- **Caption** between panels: "showing last 10 of N sprints — full history below" + median value + outlier count.

Mockup reference: `notes/ux-variants/2026-05-28-sprint-accuracy-E-brush-zoom.html` (zero-JS static, Mode 3 confirmed viable).

**Phase 2 follow-up (optional, separate story):** ~30 lines of vanilla JS for live brush drag — make the overlay rect draggable, main panel reacts. Defer until product validation of Phase 1.

**Files to modify:**
- `src/components/StackedBarSprintComparison.astro` (refactor to dual-panel; Variant C scale logic already applied via S-TIME-SCALE)
- `src/components/SprintAccuracyTime.astro` (pass window-size prop if needed)
- `src/components/SprintAccuracyTokens.astro` (same — keep API parity)

**Implementation sketch:**
```astro
// In StackedBarSprintComparison.astro Props:
windowSize?: number;  // default: 10
showOverview?: boolean;  // default: true

// In script:
const displayData = data.slice(-(windowSize ?? 10));
const overviewData = data;  // all sprints, compressed
// Main panel renders displayData w/ Y_CAP from S-TIME-SCALE
// Overview panel renders overviewData w/ same Y_CAP, each bar slot 3-4px wide
// Static window rect: x = overview.x of first displayData sprint, width = displayData.length × overview slotW
```

**Acceptance:**

1. `bun run build` exits 0 — no TypeScript errors.
2. `grep -n "overviewData\|window-rect\|showOverview" src/components/StackedBarSprintComparison.astro` returns ≥3 matches.
3. Manual visual: main panel renders last 10 sprints at full bar resolution; overview panel renders all N sprints as compressed stubs at the bottom.
4. Manual visual: window indicator `<rect>` is visible over the last 10 positions of overview panel; opacity ~30%, accent stroke color.
5. Manual visual: outlier glyph from S-TIME-SCALE appears in MAIN panel for SPR-010 (and any future outliers) — Variant C composes with E.
6. Manual visual: overview panel bar widths are 3-4px regardless of total sprint count (compresses gracefully to 50+ sprints).
7. Caption between panels reads `showing last 10 of <N> sprints` (or equivalent count format).
8. Static layout — zero client JS. `find dist/_astro -name "*.js" -exec gzip -c {} + | wc -c` unchanged vs pre-S-TIME-BRUSH baseline (acceptable: small delta if Astro bundles changed, but no NEW JS for chart interactivity).
9. `docs/verify-log.md` has new row for this story.

**Estimated:** 3 pts · est_tokens_k: 35k · est_minutes: 25 (cross-window M-frontend bucket — same as S-TIME-SCALE)

**Pairs with:** S-TIME-SCALE (must ship FIRST or in same sprint; E inherits C's scale logic).

---

## Files Produced

| File | Purpose |
|------|---------|
| `notes/ux-variants/2026-05-28-sprint-accuracy-A-log-scale.html` | Variant A mockup |
| `notes/ux-variants/2026-05-28-sprint-accuracy-B-broken-axis.html` | Variant B mockup |
| `notes/ux-variants/2026-05-28-sprint-accuracy-C-median-normalized.html` | Variant C mockup |
| `notes/ux-variants/2026-05-28-sprint-accuracy-D-recent-n-window.html` | Variant D mockup |
| `notes/ux-variants/2026-05-28-sprint-accuracy-E-brush-zoom.html` | Variant E mockup |
| `notes/ux-variants/2026-05-28-sprint-accuracy-F-sparkline-cards.html` | Variant F mockup |

---

implementer total_tokens_k: 38 · QA total_tokens_k: 0 · wall_min: 28
