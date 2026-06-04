# Design — Sprint Token Decomposition

## Data flow

```
PMO export (public-board.json) → public.json.pmo.closed_sprints[]  (sprint windows: started_at/ended_at)
                                              │
data/pipeline/snapshot.ts: parseFile() rows (ts, model, in/out/cache_*, category)
                                              │  window each row into the sprint whose [started_at, ended_at] contains its ts
                                              ▼
              pmo.sprint_tokens[]  (per sprint, additive on the weekly-quota basis)
              pmo.limits_model     (static, from quotas.ts + weekly-quota computation)
                                              │
                  ┌───────────────────────────┴───────────────────────────┐
        /research/sprint-tokens page                       PMO /sprint-close report section
```

A row belongs to a sprint when its timestamp falls in `[started_at, ended_at]`. Rows outside every
sprint window (between sprints / cross-project) are excluded from `sprint_tokens[]` — this is expected
and surfaced as the reconciliation gap, not hidden.

## Basis decision

The decomposition uses the **weekly-quota basis** = `input + output + cache_creation` — the same fields
`buildWeeklyQuota()` uses for `weekly_quota_project_used_k`, the meter the account is throttled on.
`cache_read` is carried in `by_token_type` for visibility but is **excluded** from `total_k`. The 5h
window is derived best-effort (no historical 5h store; cap unpublished) and explicitly flagged.

## Reconciliation identity + tolerance

For each sprint: `by_model`, `by_category`, and `by_token_type` (excluding cache_read) each sum to
`total_k` (a hard build assertion — the additive identity). Separately, `total_k` is compared to the
recorded `actual_total_tokens_k` **only when** the sprint's `actual_total_measurement` is
`snapshot-delta-clean`; the `measurement_flag` is passed through so the page can label non-clean sprints
as best-effort. A compute-basis cross-check against `actual_subprocess_tokens_k_modelusage` is recorded
where present. Drift is reported, never silently corrected.

## Layout

- **Sprint selector + per-sprint card**: one decomposition view per closed sprint (most recent first).
- **100%-stacked bar** with a **dimension toggle**: model / category / token-type. Bars are inline SVG
  (`<rect>` segments), labels carry the numeric `k` + `%` (not colour-only).
- **Reconciliation badge**: `drift X% · <measurement_flag>`; clean sprints get an accent, non-clean a
  muted "best-effort" tag.
- **Window-context strip**: `total_k / weekly cap (Y%)` + a flagged 5h best-effort line.
- **Limits-explainer panel**: renders `pmo.limits_model` — contributing vs excluded token types per
  window, cap basis, estimate rationale.

## House style / a11y

Existing tokens only; inline SVG, no chart lib. All values carry text beside shape (no colour-only
signal). WCAG-AA, keyboard focus, reduced-motion. 3 → 1 column collapse < 880px. Perf budget ≤ 50 KB gz.

## Tech

Astro prerendered page; minimal vanilla JS for the dimension toggle (swap `hidden` on pre-rendered SVG
groups, same pattern as `SprintBurnup.astro`). `limits_model` is data-driven from pipeline constants so
the explainer can never drift from the actual quota computation.
