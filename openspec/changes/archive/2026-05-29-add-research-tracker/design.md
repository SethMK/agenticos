# Design — Research Tracker

## Reuse

No new data plumbing: the Tracker reads the same `public.json.research` produced by the Explorer change,
and reuses `EvidenceBadge` + the card primitives. This change is deliberately thin to isolate the
OpenSpec experiment's second measurement from data-foundation cost.

## Layout

- **Metric strip** (top): 4 cells — validated count, watching count, queued count, sprints run.
  Accent only on the headline (validated) value; all tabular-nums.
- **Three lanes** (CSS grid, 3 → 1 column < 880px):
  - **validated** — cards with `n=` + anchors + a "passed" badge.
  - **watching** — cards with a progress meter `n=k/threshold` (unicode block meter `▓▓░` + a CSS bar)
    and the watch note; ordered by closeness to promotion.
  - **queued** — backlog cards ordered by score, each with a score bar and expected artifact.

## House style / a11y

Existing tokens only; desaturated status colours so the single amber accent stays loudest; sharp cards,
no shadows. Progress meters use real text (`n=2/3`) beside the visual bar so the signal is not
colour-only. WCAG-AA, keyboard focus, reduced-motion. Reference prototype:
PMO `notes/research/learnings-page-mockups/05-tracker.html`.

## Tech

Astro prerendered page; minimal vanilla JS (counts + meter widths derived from data at render). No chart
lib. Perf budget ≤ 50 KB gz.
