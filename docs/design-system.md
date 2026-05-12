# AgenticOS Design System

Terminal first, dashboard second. One accent, hairline borders, tabular numerals always-on. Tokens live in `src/styles/tokens.css` — never hardcode a colour or pixel value in a component.

## Palette reasoning

Near-black canvas (`--bg: #0A0A0A`) with two graded panels builds depth through luminance alone — no shadows, no gradients. The single accent `--accent: #FF6A00` is reserved for active values (stat delta, chart line, focus, pulse); `--accent-dim` (`#B24A00`) handles inactive states. Status colours are desaturated so nothing competes with the orange.

| Token            | Role                                      |
|------------------|-------------------------------------------|
| `--bg`           | Page canvas                               |
| `--bg-panel`     | Cards, log feed, kanban columns           |
| `--bg-elevated`  | Hover / focused panel                     |
| `--fg`           | Primary text                              |
| `--muted`        | Meta, timestamps, labels                  |
| `--border`       | Hairline panel outline                    |
| `--accent`       | Active value, chart line, focus ring      |

## Type ramp

Four sizes (`--size-sm` 12 / `--size-md` 14 / `--size-lg` 18 / `--size-xl` 36). **Page rule: max 3 sizes per screen.** Allowed combinations:

- **Stat-heavy** (`/`, `/ops`): `sm` (labels) + `md` (body) + `xl` (values).
- **Reading** (`/how-it-was-built`): `sm` (meta) + `md` (body) + `lg` (headings).
- **Dense table** (kanban, log): `sm` + `md` only.

Two faces: `--font-mono` for everything; `--font-display` for stat-card values only. Never a proportional sans.

**Contrast-pairing rule (WCAG AA):** `--muted` (#6B6B6B) on `--bg-panel` (#111111) yields only 3.54:1 — below the 4.5:1 minimum required for normal text at `--size-sm` (12px). **Never use `--muted` for readable text at `--size-sm` on `--bg-panel`.** Use `--fg-dim` (#9A9A9A) instead — it clears 4.5:1 with a 6.71:1 ratio. `--muted` is permitted only for non-text graphical glyphs (e.g. `◇` neutral delta arrows, separator dots) where the 3:1 graphical-element threshold applies.

## Spacing

4px base, six steps: `--space-1` 4 / `--space-2` 8 / `--space-3` 12 / `--space-4` 16 / `--space-5` 24 / `--space-6` 32. Compose multiples — don't invent new values. Grid gutter `--space-5`; content column `80ch`.

## Component primitives

### StatCard
Anatomy: label (`sm`, `muted`) · value (`display`, `xl`, `accent`) · delta (`sm`, ▲/▼ + %).
States: default · loading (skeleton) · empty (`—`) · error (label `danger`).
Motion: value tweens on update (`--motion-base`). Responsive: stacks below 640px.

### UsageChart
Anatomy: axes `muted`, dotted gridlines `border`, single line `accent`, no fill.
States: default · loading (axes only) · empty.
Motion: path draws left-to-right on mount.

### LogFeed
Anatomy: timestamp (`muted`) · level glyph (● ◆ ▲) · message (`fg`).
States: default · streaming (top row pulses `accent`) · empty.
Motion: new rows slide from top; older fade to `fg-dim` after 10.

### SkillList
Anatomy: skill name + right-aligned invocation count (tabular).
States: default · selected (left border 2px `accent`) · disabled (`muted`).

### KanbanColumn
Anatomy: header (`sm`, uppercase, `muted`) + count badge; cards with `--space-3` gap; `border` separators.
States: default · drag-over (`bg-elevated`, `border-accent`) · empty.

### OpsCostTable
Anatomy: sticky header (`bg-panel`, `border-strong` underline); rows separated by `border`; total row in `accent`.
States: default · sorting (header ▲/▼) · loading.

### AlertBanner
Anatomy: full-width strip; 4px left rule (`warn`/`danger`); `[x]` dismiss right.
States: info · warn · danger · dismissed (collapses).

## Conventions

No emoji — glyphs only (▲ ▼ ◆ ● ◇ ○ ✕). `border-radius: 0` globally. `tabular-nums` inherited from `:root`. Focus: `2px solid var(--accent)`. Hover: surface lifts `bg-panel` → `bg-elevated` over `--motion-fast`; never scale or translate.

---

_Skills used: `frontend-design` (invoked). `huashu-design` skipped — disabled in skillOverrides settings._
