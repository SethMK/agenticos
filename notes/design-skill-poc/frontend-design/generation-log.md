# frontend-design — Generation Log

**Date:** 2026-05-11
**Skill:** `frontend-design` (Anthropic, in-process Claude Code skill)
**Wall-clock:** ~3 min
**Status:** generated

## What the skill suggested

The `frontend-design` skill returned a *thinking framework* rather than direct HTML. It pushed:

- **Bold aesthetic commitment** — pick an extreme and execute it precisely.
- **Distinctive typography** — pair a display mono with a refined body mono; avoid generic system fonts (Arial, Inter, Roboto, Space Grotesk).
- **Dominant colour + sharp accent** — anti-pastel, anti-purple-gradient.
- **Spatial composition** — asymmetry, generous negative space, grid-breaking.
- **Atmosphere over solid colour** — dotted rules, corner brackets, scanlines.
- **High-impact moments** — one well-orchestrated load animation beats scattered micro-interactions.
- **Match complexity to vision** — minimal designs need restraint and precision, not more code.

It explicitly warned against AI-slop hallmarks: cliché purple-on-white, predictable layouts, system-font defaults.

## What I accepted

- **Type pairing:** `Space Mono` (display, the 2.4M value + wordmark) + `JetBrains Mono` (body / labels). Both via Google Fonts — single `@import`, no external CSS file.
- **Atmosphere:** corner-bracket framing on every panel (Vercel-Ship lineage), dotted gridlines on the chart (Wickstrom Monospace Web), pulsing online dot, uppercase letter-spaced labels.
- **Real chart, not a box:** inline SVG area chart with 30 fake datapoints, gradient fill + 1.5px stroke, dotted grid, Y-axis ticks (3.0M / 2.0M / 1.0M / 0), terminal marker on the last point.
- **Status strip** above the wordmark — gives the page a "running OS" tone before any data.
- **Restraint on motion:** single CSS keyframe (the pulse). No staggered reveal — over-animating a terminal UI fights the aesthetic.

## What I rejected

- **Multiple stat cards.** Story says exactly one StatCard. Resisted the urge to fill the panel row.
- **Hover transforms on the chart.** The skill mentioned hover-state surprises; on a static terminal export they'd be invisible and feel like cargo-culted JS. Skipped.
- **A persona photo / sidebar.** The designer agent brief mentions one in the full AGENTICOS screen, but the S016 target screen explicitly limits scope to 1 stat + 1 chart + 1 log row.
- **Dramatic background textures (noise, grain).** Tested mentally — adds visual noise without serving the data-density terminal aesthetic. Hairline borders and dotted rules already do this job at lower cost.

## Tokens used vs S006

Kept S006 palette verbatim (--bg #0A0A0A, --bg-panel #111, --accent #FF6A00, --border #2A2A2A, --muted #6B6B6B). Bumped `--size-xl` from 36px to 48px (3rem) for the stat value — the skill's "elegance through restraint" advice argued for one striking number, and 36px felt timid alongside the chart. This is a *single-page* deviation, not a token rewrite.

## Verdict

Clean, defensible, comparable to S006. The page reads as a terminal first, dashboard second. Corner brackets + dotted rules + single pulsing dot do the atmospheric work without leaving the aesthetic.
