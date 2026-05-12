# S021 — `<synthetic>` model investigation

**Status:** investigated + patched
**Date:** 2026-05-11
**Owner:** data-pipeline

## TL;DR

`<synthetic>` is Claude Code's own marker for **client-fabricated assistant turns** — rate-limit notices, API-error messages, and a handful of CLI-replayed status/plan-mode messages. They never hit a real model and carry strictly zero usage across all four token fields. Filtered at the parser (one-line guard in `parse-jsonl.ts`). Aggregate model count drops 5 → 4 and the stderr `warn: unknown model "<synthetic>"` from the pricing stage disappears.

## Reproducer (anyone can re-run)

```bash
cd ~/Projects/personal/202605_AgenticOS
bun run data/pipeline/parse-jsonl.ts > /tmp/parsed.ndjson

# Pre-patch: 49 synthetic lines, post-patch: 0
jq -c 'select(.model == "<synthetic>")' /tmp/parsed.ndjson | wc -l

# Find the raw lines on disk
find ~/.claude/projects -name '*.jsonl' -type f -exec grep -l '"model":"<synthetic>"' {} \;

# Verify every synthetic raw record has zero usage (returns only [0,0,0,0])
find ~/.claude/projects -name '*.jsonl' -type f -exec grep -h '"model":"<synthetic>"' {} \; \
  | jq -c '.message.usage | [.input_tokens, .output_tokens, .cache_creation_input_tokens, .cache_read_input_tokens]' \
  | sort -u
```

## Sample raw lines

Six samples from four different projects, three different error categories. All have `type:"assistant"`, `message.role:"assistant"`, `message.model:"<synthetic>"`, and `usage.input_tokens == usage.output_tokens == usage.cache_*_tokens == 0`.

### 1. Rate-limit at session boundary (LAS-FairValue, 2026-04-16)

```json
{"parentUuid":"1dd13384-…","isSidechain":false,"type":"assistant","uuid":"ec144bd3-…",
 "timestamp":"2026-04-16T14:56:43.715Z",
 "message":{"id":"074d3e69-…","model":"<synthetic>","role":"assistant",
   "stop_reason":"stop_sequence","type":"message",
   "usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,…},
   "content":[{"type":"text","text":"You've hit your limit · resets 6pm (Europe/Warsaw)"}]},
 "error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,
 "userType":"external","entrypoint":"cli","cwd":"/Users/marcinkokott/Projects/202602_LAS_FairValue",
 "sessionId":"0394cf7c-…","version":"2.1.110"}
```

### 2. Anthropic 500 surfaced as synthetic (`.claude` mgmt session, 2026-04-21)

```json
{"type":"assistant","uuid":"6cbe0785-…","timestamp":"2026-04-21T17:13:07.439Z",
 "message":{"model":"<synthetic>","role":"assistant",
   "usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,…},
   "content":[{"type":"text","text":"API Error: {…\"type\":\"api_error\",\"message\":\"Internal Server Error\"…}"}]},
 "error":"unknown","isApiErrorMessage":true,
 "cwd":"/Users/marcinkokott/Projects/.claude","sessionId":"2edec5b8-…","version":"2.1.116"}
```

### 3. Extra-usage gate ("1M context") (Personal, 2026-05-04)

```json
{"type":"assistant","uuid":"b4e0f7e2-…","timestamp":"2026-05-04T19:40:04.096Z",
 "message":{"model":"<synthetic>","role":"assistant",
   "usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,…},
   "content":[{"type":"text","text":"API Error: Extra usage is required for 1M context · run /extra-usage to enable, or /model to switch to standard context"}]},
 "error":"rate_limit","isApiErrorMessage":true,"apiErrorStatus":429,
 "cwd":"/Users/marcinkokott/Projects/personal/202604_Personal","sessionId":"478677f8-…","version":"2.1.126"}
```

### 4. Replayed plan-mode reference (LAS-FairValue, 2026-04-21)

```json
{"type":"assistant","uuid":"67027b0d-…","timestamp":"2026-04-21T06:25:17.884Z",
 "message":{"model":"<synthetic>","role":"assistant",
   "usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,…},
   "content":[{"type":"text","text":"The plan is already saved at:\n\n**`/Users/marcinkokott/.claude/plans/you-are-expert-…`**\n\nIt was written there during plan mode and persists on disk…"}]},
 "isApiErrorMessage":false,
 "cwd":"/Users/marcinkokott/Projects/202602_LAS_FairValue","sessionId":"e1038178-…","version":"2.1.116"}
```

### 5. "No response requested" (Claude_Brain, 2026-04-26)

```json
{"type":"assistant","uuid":"950c60bf-…","timestamp":"2026-04-26T18:49:44.463Z",
 "message":{"model":"<synthetic>","role":"assistant",
   "usage":{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,…},
   "content":[{"type":"text","text":"No response requested."}]},
 "isApiErrorMessage":false,
 "cwd":"/Users/marcinkokott/Projects/202604_Claude_Brain","sessionId":"7eb12334-…",
 "version":"2.1.119","entrypoint":"claude-desktop"}
```

### 6. Auth-failed CLI hint

```
text:  "Not logged in · Please run /login"
error: "authentication_failed", isApiErrorMessage: true
```

## Pattern (all 38 raw records → 49 parsed → 27 aggregated)

Breakdown by `(type, error, apiErrorStatus, content)` across all 38 raw `<synthetic>` records on disk:

| Category | Trigger | Count (raw) |
| --- | --- | --- |
| `rate_limit` 429 — "You've hit your limit · resets …" | Plan window exhausted | 11 |
| `rate_limit` (no status) — same text | older client version | 2 |
| `rate_limit` 429 — "Extra usage is required for 1M context" | 1M-context gate | 1 |
| `unknown` — "API Error: 500 / Internal Server Error" | Anthropic 5xx | 1 |
| `unknown` — "API Error: Stream idle timeout" | Network/streaming | 1 |
| `unknown` — generic API Error envelope | Anthropic 5xx | 1 |
| `authentication_failed` — "Not logged in · Please run /login" | Session expired | 1 |
| `invalid_request` 400 — "image exceeds dimension limit" | Bad input | 1 |
| `invalid_request` — "Claude Code is unable to respond … policy" | Safety block | 1 |
| `invalid_request` — "Prompt is too long" | Context overflow | 1 |
| no error — "**Step 0: Runtime Check** …" (CLI-replayed plan output) | Plan mode replay | several |
| no error — "The plan is already saved at: …" | Plan persistence hint | 1 |
| no error — "No response requested." | Implicit completion | several |

Common invariants across every category:
- `type: "assistant"` and `message.role: "assistant"` (so the existing role/type gate doesn't catch them)
- `message.model === "<synthetic>"` — Claude Code's own sentinel
- All four `usage.*_tokens === 0` — zero billable cost by construction

The fact that all four token fields are zero confirms these are **CLI-fabricated** records, not Anthropic-returned ones (a real API call always reports at least the input tokens it billed). They exist in the JSONL so the UI can render the error/notice in conversation flow, but they shouldn't count toward token aggregates.

## Hypothesis

`<synthetic>` is Claude Code's local-only "assistant" record written by the CLI itself whenever it needs to surface a non-model event in the conversation log: rate-limit notices, Anthropic 4xx/5xx error envelopes, auth-failed hints, content-policy refusals, and internally-replayed plan-mode messages. The CLI sets `model: "<synthetic>"` precisely so downstream consumers can distinguish them from genuine assistant turns. They were leaking through our parser because the existing gate only checked `type === "assistant"` and `message.role === "assistant"` and the presence of a `usage` object — and Claude Code dutifully writes a zero-filled `usage` block to keep the JSON shape uniform. The 49 raw assistant.usage events (38 unique records, with some duplication via session resumes/forks) aggregate to 27 rows in `aggregate.ts` because the key is `(date, project_hash, model)` and they cluster onto a small number of dates and projects.

## Decision: **filter**

These are not assistant turns by any model. They have zero token cost, they pollute the model dimension with a fake 5th entry, and they emit `warn: unknown model "<synthetic>"` from `price-tokens.ts` on every run. Renaming to `unknown` or attributing to a previous record would both be misleading — the events truly were not produced by any model.

Filter at `parse-jsonl.ts` (the gatekeeper, per the story's "fix lands in one filter condition" note). The `<synthetic>` marker is Claude Code's own deliberate sentinel, so keying on it is more semantically honest than keying on zero usage (which is currently a coincidence — verified across all 38 raw records, but not guaranteed forever).

Alternatives considered:
- **Rename to `unknown`** — preserves the row count but still produces $0 noise and an inaccurate "model" column. Rejected.
- **Attribute to previous record's model** — would silently roll error notices into the parent model's stats. Rejected (events have zero usage, so it's a no-op for tokens, but it would inflate `message_count` for the real model).
- **Leave with stderr warning** — the warning fires on every pipeline run, every cron snapshot. Rejected (it's permanent noise).
- **Filter on zero-usage** — would also work today but is coincidence-based; if Claude Code ever stamps a non-zero usage on a synthetic record we'd silently start counting it. Rejected in favour of the explicit sentinel.

## Patch

`data/pipeline/parse-jsonl.ts` — one guard inside `handleLine`, right after the existing role/usage gates:

```ts
if (!usage || typeof usage !== "object") return;
// S021: skip Claude Code's client-fabricated "synthetic" assistant turns.
// These are CLI-emitted records for rate-limit / API-error / status messages
// (e.g. "You've hit your limit", "API Error: 500", "No response requested").
// They carry model: "<synthetic>" and strictly zero usage across all four
// token fields, so they never produced billable model output. Counting them
// pollutes the model list with a fake 5th "model" and emits a stderr warning
// on every pricing run for $0 of cost. See notes/synthetic-model-investigation.md.
if (msg.model === "<synthetic>") return;
```

## Re-run results

```bash
bun run data/pipeline/parse-jsonl.ts > /tmp/parsed.ndjson
bun run data/pipeline/aggregate.ts < /tmp/parsed.ndjson > /tmp/agg.json
bun run data/pipeline/price-tokens.ts < /tmp/agg.json > /tmp/priced.json
```

| Metric | Before | After |
| --- | --- | --- |
| Parsed NDJSON lines | 45,879 | 45,883 (live-session drift) |
| Of which `model == "<synthetic>"` | 49 | **0** |
| Aggregate rows | 250 | **223** (-27 synthetic) |
| Distinct models in aggregate | 5 | **4** |
| `<synthetic>` rows in aggregate | 27 | **0** |
| `project_raw in ("subagents","__subagents__")` rows | 0 | 0 (S019 still holds) |
| Sum of `input_tokens + output_tokens` | 57,185,196 | 57,192,282 (drift, real) |
| `price-tokens.ts` stderr | `warn: unknown model "<synthetic>"` | empty |

Sanity:
- `models | unique` after = `["claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-opus-4-7", "claude-sonnet-4-6"]` — exactly four real Anthropic models.
- Lossless-sum delta (+7,086 tokens) attributable to fresh assistant turns logged during the ~60s between the before- and after-pipeline runs (live Claude sessions on the host), not to the patch. Re-running pre-patch parser on the same post-patch input would show the same drift.
- S001 acceptance: parser still streams, still skips non-assistant events, still emits one JSON line per assistant.usage record.
- S019 acceptance: `__subagents__` bucket count = 0, real project ancestors still resolved.

## Files touched

- `data/pipeline/parse-jsonl.ts` — added one `if (msg.model === "<synthetic>") return;` guard plus a documenting comment. No other edits.
- `notes/synthetic-model-investigation.md` — this file.

**Not touched** (per story constraint): `aggregate.ts`, `price-tokens.ts`, `redact.ts`, `snapshot.ts`, any UI files. Note that `snapshot.ts` re-implements `parseFile` inline; it will continue to emit `<synthetic>` rows when run end-to-end until that mirror is updated. Recommend a tiny follow-up story to mirror the one-line filter into `snapshot.ts:parseFile` — out of scope here.
