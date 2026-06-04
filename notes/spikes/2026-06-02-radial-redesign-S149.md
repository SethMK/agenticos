# S149 Scope Recommendation — Radial Sprint Loop Redesign

**Spike date:** 2026-06-02  
**Prototype:** `notes/spikes/s149-radial-prototype.html`  
**Target story:** S101 (E11, backlog, 13 acceptance bullets)

---

## Key findings from prototype

**Arc proportion math:** circular arc `getTotalLength()` ratio is mathematically exact (Δ<0.001%). The ±3% tolerance is trivially met — implementer just sets correct angle spans (P_PLAN=0.07, P_EXEC=0.80, P_CLOSE=0.13 × 360°). No iteration needed.

**Loop closure:** with `/sprint-plan` AND `CHAIN?` both placed at the arc join point (bottom of circle), distance = 5.4px. S101 acceptance bullet "≤100px" is automatically satisfied by the geometry. No special measurement logic needed — the two nodes share the same ring radius, separated by ~1.5°.

**Mobile 390px:** proportional shrink via `viewBox + width:100%` works natively. Body scrollWidth=300px at 390px viewport, no overflow. The `scrollWidth ≤ 391` acceptance criterion passes without a vertical-fallback branch.

**ARIA fallback pattern:** visually-hidden `<ol class="s101-fallback-list">` with 22 items in linear reading order works cleanly. `role="graphics-document"` + `aria-labelledby` on outer SVG is sound — same pattern S091 established.

**Animation:** `stroke-dashoffset` draw-in works. `prefers-reduced-motion` guard: set `strokeDashoffset=0` on reduced-motion, no animation class applied. Validated in prototype.

---

## Per-bullet feasibility verdict (S101 acceptance bullets)

| # | Bullet | Verdict | Notes |
|---|--------|---------|-------|
| 1 | **Arc proportions ±3%** | **EASY** | Math is exact for circular arcs. `getTotalLength()` ratio = angle ratio to ≪1% precision. Playwright assertion trivial. |
| 2 | **EXECUTION inner ring ≥4 sub-states + ≥4 tripwire dots** | **EASY** | Prototype renders 4+4. Inner dashed track at R_INNER=148, sub-state circles at R_TRIP=178. Radial connector lines work. Only subtlety: node labels need ≥9px font for legibility at 390px. |
| 3 | **Loop closure ≤100px** | **EASY** | Trivially met: CHAIN? and /sprint-plan are adjacent nodes on same ring radius. Distance ≈5px. Playwright assertion is a one-liner. |
| 4 | **Q0–Q4 markers on planning arc** | **HARD** | 7% arc = 25.2°. Five gates at 5° spacing. At R=210 prototype, inter-label gap ≈18px at outer ring. Works with radial leader-lines + micro-text, but at 390px (scaled to ~70%) the Q-gate cluster becomes unreadable (~12px gap). **Needs decision:** (a) accept illegibility at mobile and pass just the dot + aria-label, or (b) use a pull-out annotation approach with longer leader lines angling outward. Option (b) is right but adds ~40 lines of path computation. |
| 5 | **Legend parity** | **EASY** | Prototype legend has 6 items (exec/planning/close/sub-state/tripwire/Q-gate). Just write it; no shape ambiguity. |
| 6 | **Mobile reflow (≤391 scrollWidth OR vertical fallback)** | **EASY** | Proportional shrink option proven. No fallback branch needed. |
| 7 | **ARIA fallback list + role=graphics-document** | **EASY** | Pattern validated in prototype. 22 list items cover full reading order. |
| 8 | **No new design tokens** | **EASY** | Prototype uses only `--accent`, `--accent-dim`, `--fg-dim`, `--muted`, `--border-strong`, `--bg-panel`. Zero new CSS vars. |
| 9 | **Animation ≤800ms + reduced-motion fallback** | **EASY** | stroke-dashoffset draw-in confirmed. Guard with `matchMedia`. One gotcha: must set `strokeDasharray` from JS (not CSS) because length is dynamic from `getTotalLength()`. |
| 10 | **Code surface swap: new SprintLoopRadial.astro, old lines 0 after grep** | **EASY** | Mechanical extraction. Old s091 lines 447-655 move into new component. Grep zeroes out trivially. |
| 11 | **Label-parity (no vocab drift)** | **NEEDS-DECISION** | Prototype already caught one drift: S101 notes say `/sprint-plan` but implementer brief must be explicit about capitalisation (`EXECUTION` vs `execution`, `/sprint-close` vs `sprint-close` vs `close`). CLAUDE.md canonical terms must be transcribed into component comments. QA brief must call out an explicit re-read (not grep replay). Flag for implementer: check all 6 phase/node labels against S091 fallback-list vocabulary before shipping. |
| 12 | **Cross-window token self-report** | **NEEDS-DECISION** | Not prototype-relevant but structurally: S101 requires a separate `qa-verifier` spawn (not self-verify). This is a process requirement on the sprint plan, not a code change. Must be included in implementer brief. Otherwise SPR-011 regression. |
| 13 | **Playwright distance assertion (CHAIN?→/sprint-plan)** | **EASY** | `getBoundingClientRect()` on both elements, `Math.hypot(dx,dy)`. Since the nodes are ~5px apart in the SVG, at 1440px viewport they'll be ~12px apart (SVG rendered ≈580px wide → scale 580/600 ≈ 0.97). Well within 100px. |

---

## Hard parts summary

**1 HARD bullet:** Q0–Q4 markers in 25.2° planning arc. Recommend: radial leader lines extending to R_GATE=235, accept that the hint micro-text (7–8px) is decorative at ≤390px — hint falls back to SVG `<title>` on the gate dot for screen readers. This is the one genuinely tricky layout constraint.

**2 NEEDS-DECISION:** Label-parity self-check (implementer process discipline) + cross-window QA spawn (sprint plan / brief). Neither is blocking for code, but both are required by the QA rubric.

---

## Recommended component structure

```
src/components/SprintLoopRadial.astro
  ├── <section> wrapper (aria-label, role)
  ├── <svg role="graphics-document" aria-labelledby>
  │     <title id>  ← short summary heading
  │     <defs>  ← arrowhead markers
  │     <g id="g-track">   ← background ring
  │     <g id="g-arcs">    ← 3 phase arcs (plan/exec/close)
  │     <g id="g-inner">   ← exec inner track + sub-state nodes + tripwires
  │     <g id="g-gates">   ← Q0–Q4 markers + leader lines
  │     <g id="g-nodes">   ← /sprint-plan, /sprint-close, CHAIN? key nodes
  │     <g id="g-labels">  ← all text labels (aria-hidden)
  │     <g id="g-arrows">  ← yes/no arrows
  │   </svg>
  ├── <ol class="s101-fallback-list">  ← 22-item ARIA list (visually hidden)
  └── <div class="s101-legend">
```

**Geometry constants block** (inline `<script>` or build-time computed, NOT Framer Motion dependency):
- Pure SVG + CSS stroke-dashoffset animation. No Framer Motion.
- Justification: avoids new npm dep, no React in Astro component, simpler reduced-motion guard.
- Saves ~30k tokens vs Framer Motion path.

**Animation approach:** set `stroke-dasharray` and `stroke-dashoffset` from inline `<script>` using `getTotalLength()`. Apply CSS `@keyframes draw-in` class after values set. Reset to 0 if `prefers-reduced-motion: reduce`.

---

## S101 build estimate

| Dimension | Estimate | Basis |
|-----------|----------|-------|
| **est_tokens_k** | **160–180k** | No Framer Motion (saves ~30k). Arc math is proven from prototype. Tight Q0-Q4 layout is the main unknown. Anchor: S091 (150k, similar SVG complexity but no radial math). |
| **Turn count** | **8–11 turns** | Plan (1) → arc geometry impl (2–3) → inner ring + tripwires (1–2) → Q-gates (1–2, hardest) → ARIA + legend + animation (1–2) → QA spawn (1). |
| **Wall time est** | ~14 min | Based on anchor stories S088/S094/S095 (~10–16 min) and similar token band. |
| **Agent count** | 2 (implementer + qa-verifier) | Cross-window mandate from S101 notes. qa-verifier is a separate spawn. |
| **Recommended model** | sonnet | Matches story owner field. Opus not needed — arc math is computed, not creative. |

---

## Build approach recommendation

1. **Enter plan mode** (3+ acceptance bullets with cross-file + new component + Playwright assertions → CLAUDE.md triggers plan mode).
2. Implement arc geometry as a standalone JS constant block first, validate proportions match before adding any visual decoration.
3. Sub-state nodes + tripwires second (inner ring, independent of arc math).
4. Q0–Q4 markers third (hardest, use radial leader-line approach from prototype, accept mobile hint is decorative).
5. Swap old s091 code last, after component is complete and tested in isolation.
6. QA: separate `qa-verifier` spawn covering all 13 bullets (NOT self-verify via Playwright alone).

---

## Screenshot

See `s149-proto-full.png` (full-page) and `s149-proto-390.png` (390px viewport) in repo root.

**Validation output from prototype:**
- planning: 7.00% (Δ−0.001%) ✓
- execution: 80.00% (Δ+0.001%) ✓
- close: 13.00% (Δ−0.000%) ✓
- CHAIN?→/sprint-plan: 5.4px ✓
- Sub-state nodes: 4 ✓ · tripwire dots: 4 ✓
- ARIA fallback-list: 22 items ✓
- 390px scrollWidth: 300px ✓

---

## Spike verdict

**go** — all hard unknowns are resolved. Arc proportions are trivial (exact by geometry). Loop closure is trivially ≤100px (same ring point). Mobile reflow works via proportional shrink. Only genuine complexity is Q0–Q4 label crowding in 25.2° planning arc, and that has a clear approach (leader lines, hint as `<title>`). No blocking unknowns.

S101 can be pulled from backlog once the design gate (ux-reviewer Spec-Gate) is cleared.
