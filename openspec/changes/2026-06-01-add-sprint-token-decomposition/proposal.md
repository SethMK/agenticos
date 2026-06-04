# Add Sprint Token Decomposition

## Why

The site shows global, daily, and per-project token usage, and the PMO board shows planned-vs-actual
sprint budgets. Neither answers the *retrospective* question Marcin actually needs: **for a completed
sprint, where did every token go, and how does that reconcile to the Claude Max windows (weekly + 5h)
that throttle the account?**

This change adds a per-sprint token **decomposition** — slicing each sprint's spend by model, by
work-category (manual / agents / skills / mcp), and by token-type (input / output / cache_creation /
cache_read) — and reconciles the windowed sum against the independently-measured weekly snapshot-delta.
It also adds an **explainer** of how the Max limits are calculated (which token types count toward each
window, the cap basis, and the estimate rationale for the unpublished cap numbers).

It is framed as a **tracked hypothesis** (`H-sprint-token-decomposition`): whether full retrospective
per-sprint token attribution is *possible*, *partial*, or *bounded by a limit*. The verdict accrues on
the existing Tracker page. The build is **spike-gated** — a reconciliation spike validates the basis
before any emit or page work.

## What Changes

- Add **sprint-windowing** in the pipeline: bucket parsed JSONL rows by each closed sprint's
  `[started_at, ended_at]` (from `public.json.pmo.closed_sprints[]`).
- Emit **`public.json.pmo.sprint_tokens[]`** — per-sprint `{ total_k, by_model[], by_category{},
  by_token_type{}, reconciliation{}, weekly_window_share, fivehr_window_context }` on the **weekly-quota
  basis** (`input + output + cache_creation`; `cache_read` excluded). New Zod schema; validated at build.
- Emit a sibling **`public.json.pmo.limits_model`** block sourced from `data/pipeline/quotas.ts` + the
  weekly-quota computation (contributing/excluded token types per window, cap basis, rationale — no
  hand-written numbers).
- Add the **`/research/sprint-tokens`** page: per-sprint 100%-stacked bars with a dimension toggle
  (model / category / token-type), a reconciliation badge (drift + measurement flag), a window-context
  strip (% of weekly cap, 5h best-effort), and a limits-explainer panel.
- Add a **Tracker `watching[]` entry** for `H-sprint-token-decomposition` (n=0, threshold=3).
- Reuse `research.json`, the base research components, and the design tokens. Nav entry + Playwright
  e2e spec.

## Impact

- Affected specs: `research` (extends the capability with the sprint-token decomposition view + limits
  explainer).
- Affected code: `data/pipeline/snapshot.ts` (sprint-windowing + emit), new
  `data/pipeline/sprint-tokens.schema.ts`, `data/snapshots/research.json` (tracker entry),
  `src/pages/research/sprint-tokens.astro`, `src/components/research/*` (reused),
  `src/layouts/TerminalLayout.astro` (nav), `tests/e2e/research-sprint-tokens.spec.ts`.
- Consumed by PMO: the same `pmo.sprint_tokens[]` + `pmo.limits_model` feed a `## Token decomposition`
  section the PMO `/sprint-close` ceremony writes into each sprint file (PMO-side story).
- Depends on `add-research-explorer` (data foundation + base components) and `add-research-tracker`
  (watching-lane rendering). Additive only; **spike-gated** (does not ship the emit/page until the
  reconciliation spike passes or the limit is documented).
