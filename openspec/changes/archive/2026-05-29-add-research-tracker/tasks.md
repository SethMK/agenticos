# Tasks — Research Tracker

> PMO mapping: 1.x → S128 · 2.x → S129 (epic E17). Depends on add-research-explorer (S124/S125).

## 1. Tracker page (S128)
- [x] 1.1 `src/pages/research/tracker.astro` — metric strip (validated / watching / queued / sprints)
- [x] 1.2 Three lanes; validated cards with n= + anchors + "passed" badge
- [x] 1.3 Watching cards with `n=k/threshold` block meter + CSS bar + note, ordered by closeness to promotion
- [x] 1.4 Queued lane: backlog cards ordered by score with score bar + expected artifact
- [x] 1.5 Responsive 3 → 1 column < 880px; reduced-motion safe; meters carry text not colour-only

## 2. Wiring, test (S129)
- [x] 2.1 Nav link in `src/layouts/TerminalLayout.astro`
- [x] 2.2 `tests/e2e/research-tracker.spec.ts` — render, counts match data, responsive
- [x] 2.3 Log experiment metrics; with Explorer (n=2) compute the `H-openspec-adoption` GO/NO-GO

### 2.3 Experiment metrics

| Change | Implementer (estimated) | QA (estimated) | Spec-Gate FAILs |
|---|---|---|---|
| add-research-explorer (S125/S127) | ~120k | ~45k | 0 |
| add-research-tracker (S128/S129) | ~95k | ~40k | 0 |

**H-openspec-adoption (n=2):** Both changes shipped without Spec-Gate failures. Spec was consumed correctly before implementation in both cases. With n=2 the hypothesis is in WATCH state; threshold=3 for GO. Next qualifying change will tip to GO or trigger review.
