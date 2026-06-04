# Tasks — Sprint Token Decomposition

> PMO mapping: 1.x → S133 · 2.x → S134 · 3.x → S135 · 4.x → S137 · 5.x → S138 (epic E19).
> PMO-side report section → S136 (PMO `/sprint-close` skill, not in this repo).
> Depends on add-research-explorer (S124/S125) + add-research-tracker (S128/S129).
> **Spike-gated: 1.x must pass before 2.x–5.x.**

## 1. Reconciliation spike (S133)
- [ ] 1.1 Window AgenticOS JSONL rows by each closed sprint's `[started_at, ended_at]` from `pmo.closed_sprints[]`; sum on the weekly-quota basis (`input + output + cache_creation`; exclude `cache_read`)
- [ ] 1.2 For `snapshot-delta-clean` sprints, compute drift% of windowed-sum vs recorded `actual_total_tokens_k`; cross-check vs `actual_subprocess_tokens_k_modelusage` (compute basis) where present
- [ ] 1.3 Write a verdict artifact: per-sprint drift table + coverage verdict (possible / partial-with-limit / not-possible) + named limitations (clean-ground-truth scarcity, cross-project mixing, 5h noise)
- [ ] 1.4 Verdict gates 2.x–5.x; seeds the Tracker note (4.x)

## 2. Pipeline emit + schema (S134)
- [ ] 2.1 Sprint-windowing in `data/pipeline/snapshot.ts`: bucket parsed rows by sprint window
- [ ] 2.2 Emit `pmo.sprint_tokens[]` — `{ sprint_id, started_at, ended_at, basis, total_k, by_model[], by_category{}, by_token_type{}, reconciliation{ windowed_sum_k, snapshot_delta_k, drift_pct, measurement_flag, compute_modelusage_k }, weekly_window_share, fivehr_window_context }`
- [ ] 2.3 New `data/pipeline/sprint-tokens.schema.ts` (Zod); validate at build
- [ ] 2.4 Additive identity asserted: `by_model` / `by_category` / `by_token_type`(excl. cache_read) each sum to `total_k`; attribution-coverage self-check across full JSONL (fields map to real rows, not synthetic buckets)

## 3. Public page (S135)
- [ ] 3.1 `src/pages/research/sprint-tokens.astro` — per-sprint 100%-stacked bars + dimension toggle (model / category / token-type)
- [ ] 3.2 Reconciliation badge (`drift% · measurement_flag`) + window-context strip (% of weekly cap; 5h best-effort flagged)
- [ ] 3.3 Inline SVG, no chart lib, existing tokens only; values carry text not colour-only; 3 → 1 column < 880px; reduced-motion safe
- [ ] 3.4 Nav link in `src/layouts/TerminalLayout.astro`
- [ ] 3.5 `tests/e2e/research-sprint-tokens.spec.ts` — render bars per dimension, toggle switches dimension, responsive collapse; gz ≤ 50 KB

## 4. Tracker entry (S137)
- [ ] 4.1 Add `watching[]` entry to `data/snapshots/research.json`: id, group, title "Sprint token decomposition", claim (the `H-sprint-token-decomposition` statement), `n: 0`, `threshold: 3`, `sprints: []`, `note` seeded from the spike verdict
- [ ] 4.2 Validates against `research.schema.ts`; Tracker page renders the new watching card with an `n=0/3` meter

## 5. Limits explainer (S138)
- [ ] 5.1 Emit `pmo.limits_model` from `data/pipeline/quotas.ts` + the weekly-quota computation: per window `{ weekly, fivehr }` → `{ cap_k, contributing:[input,output,cache_creation], excluded:[cache_read], window, basis, rationale }` (no hand-written numbers)
- [ ] 5.2 Render an explainer panel on `/research/sprint-tokens` (contributing vs excluded token types, cap basis, estimate rationale)
- [ ] 5.3 e2e asserts the panel lists `cache_creation` as contributing and `cache_read` as excluded; values trace to `quotas.ts`

### Experiment metrics (H-openspec-adoption)

| Change | Implementer | QA | Spec-Gate FAILs |
|---|---|---|---|
| add-sprint-token-decomposition | TBD | TBD | TBD |

This is the **third** OpenSpec change (H-openspec-adoption is GO at n=2). Record the outcome at close to extend the evidence base.
