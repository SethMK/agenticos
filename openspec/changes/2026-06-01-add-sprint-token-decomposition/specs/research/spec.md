# Research capability — delta for Sprint Token Decomposition

## ADDED Requirements

### Requirement: Per-sprint token decomposition data
The pipeline SHALL emit `public.json.pmo.sprint_tokens[]`, one entry per closed sprint, decomposing the
sprint's spend on the weekly-quota basis (`input + output + cache_creation`; `cache_read` excluded from
the total) along three orthogonal groupings — by model, by work-category (manual / agents / skills /
mcp), and by token-type — each of which sums to the sprint's `total_k`.

#### Scenario: Additive identity holds
- GIVEN a closed sprint with parsed JSONL rows inside its `[started_at, ended_at]` window
- WHEN `sprint_tokens[]` is built
- THEN the sum of `by_model` tokens equals `total_k`
- AND the sum of `by_category` tokens equals `total_k`
- AND the sum of `by_token_type` tokens excluding `cache_read` equals `total_k`
- AND the build fails if any grouping does not reconcile to `total_k`

#### Scenario: Sprint windowing
- GIVEN a parsed row whose timestamp falls within exactly one sprint's `[started_at, ended_at]`
- WHEN windowing runs
- THEN that row's tokens are attributed to that sprint
- AND rows outside every sprint window are excluded from `sprint_tokens[]` rather than mis-assigned

### Requirement: Reconciliation against the weekly meter
Each `sprint_tokens[]` entry SHALL carry a `reconciliation` block comparing its windowed sum to the
independently-recorded sprint total, and SHALL only treat the comparison as ground-truth when the
sprint's measurement flag is `snapshot-delta-clean`.

#### Scenario: Clean sprint reconciles
- GIVEN a sprint flagged `snapshot-delta-clean` with a recorded `actual_total_tokens_k`
- WHEN the reconciliation block is computed
- THEN it reports `windowed_sum_k`, `snapshot_delta_k`, and `drift_pct`
- AND `measurement_flag` is `snapshot-delta-clean`

#### Scenario: Non-clean sprint flagged best-effort
- GIVEN a sprint flagged `snapshot-delta-partial` or `estimate-stale`
- WHEN the reconciliation block is computed
- THEN `snapshot_delta_k` may be null and the entry is marked best-effort via `measurement_flag`
- AND drift is reported, never silently corrected

### Requirement: Sprint-tokens page
The site SHALL serve a prerendered `/research/sprint-tokens` page presenting each closed sprint's
decomposition as a 100%-stacked bar with a dimension toggle (model / category / token-type), a
reconciliation badge, and a window-context strip showing the sprint's share of the weekly cap.

#### Scenario: Default render
- GIVEN `pmo.sprint_tokens[]` is published
- WHEN the page renders
- THEN each closed sprint shows a stacked bar whose segments carry both their `k` value and `%`
- AND a reconciliation badge shows `drift% · measurement_flag`
- AND a window-context line shows `total_k` as a percentage of the weekly cap

#### Scenario: Dimension toggle
- GIVEN the page is rendered for a sprint
- WHEN the user switches the dimension toggle from model to category to token-type
- THEN the stacked bar re-segments along the selected grouping
- AND each view's segments still sum to 100%

### Requirement: Limits explainer
The site SHALL render an explainer of how the Claude Max windows are calculated, driven by
`public.json.pmo.limits_model` sourced from the pipeline's quota constants — not hand-written — stating
which token types contribute to each window and which are excluded.

#### Scenario: Contributing vs excluded token types
- GIVEN `pmo.limits_model` is published from the quota constants
- WHEN the explainer panel renders
- THEN it lists `input`, `output`, and `cache_creation` as contributing to the weekly window
- AND it lists `cache_read` as excluded
- AND the displayed cap basis and rationale trace to `data/pipeline/quotas.ts`

### Requirement: Tracked hypothesis
The Tracker SHALL carry a watching entry for `H-sprint-token-decomposition` so its reconciliation
verdict accrues across sprints toward a promotion threshold.

#### Scenario: Watching card present
- GIVEN the `H-sprint-token-decomposition` watching entry exists in `research.json` with `n=0`, `threshold=3`
- WHEN the Tracker page renders
- THEN the hypothesis appears in the watching lane with an `n=0/3` progress meter and its claim text
