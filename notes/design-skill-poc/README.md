# S016 — Design Skill PoC (3-way comparison)

**Date:** 2026-05-11
**Story:** [S016](../../../202605_AgenticOS_PMO/stories/S016-design-skill-poc.md)
**Target screen** (identical across variants): AgenticOS `/` public CV — page header with `AGENTICOS` wordmark, 1 `StatCard` (TOKENS / 2.4M / +18%), 1 chart placeholder (30-day usage area chart), 1 log row (`00:30 | S001 | done`).

> The three candidates **are not equivalent in nature.** `frontend-design` and `huashu-design` are Claude Code skills that emit code inside this process. `open-design` is a separate Docker app driven via browser + BYOK. The comparison reflects that asymmetry.

---

## Summary

| Variant | Status | Wall-clock | Output | Aesthetic in one line |
|---|---|---|---|---|
| `frontend-design` | **generated** | ~3 min | [`frontend-design/layout.html`](frontend-design/layout.html) | Terminal-brutalist — corner-bracket framed panels, pulsing status dot, dotted gridlines, vivid orange `#FF6A00` accent over near-black. |
| `huashu-design` | **generated** | ~5 min | [`huashu-design/layout.html`](huashu-design/layout.html) | Editorial-minimal — Kenya-Hara / Field.io cross, huge hero number, IBM Plex Mono with serif italic flourishes, warmer honey-amber `#F5A524` over cool charcoal. |
| `open-design` | **skipped** | ~4.5 min to decision | [`open-design/SKIPPED.md`](open-design/SKIPPED.md) | n/a — see SKIPPED.md. Container ran (`{"ok":true,"version":"0.5.0"}`) but BYOK key isn't set in this sub-agent env and no host CLI is exposed inside the read-only container. Manual instructions provided for Marcin. |

**Skill invocation status:**
- `frontend-design` Skill tool — invoked, succeeded. The skill is a *thinking framework* (no direct HTML emit); I used its anti-AI-slop and typography-pairing guidance to author the HTML.
- `huashu-design` Skill tool — invoked, succeeded. Skill loaded its full SKILL.md (Kenya Hara philosophy library, asset protocol, references router). Used its 20-philosophy fallback mode + signature-detail-at-120% rule.
- `open-design` — Docker / HTTP path verified live, end-to-end generation blocked by credential availability per the brief's permitted fallback.

---

## 5 visible differences

When you open the two `.html` files in a browser side-by-side, these are observable without measurements:

1. **Accent temperature.** `frontend-design` uses a vivid alarm-orange `#FF6A00`; `huashu-design` uses a warmer honey-amber `#F5A524`. The huashu page feels like lamp light through paper; the frontend-design page feels like a dashboard alert.
2. **Chart treatment.** `frontend-design` fills the area under the line with a gradient (orange → transparent) and uses a 1.5px stroke + a dotted background grid. `huashu-design` draws **no fill at all**, uses a thicker 2.5px stroke, and shows only 3 hair-thin horizontal gridlines — Hara-restraint vs Vercel-Ship density.
3. **Wordmark typography.** `frontend-design` sets `AGENTICOS` in a single mono face (Space Mono, weight 700, ~36px) with a `/root` path indicator. `huashu-design` sets `AGENTICOS` in IBM Plex Mono caps, then a **serif italic** `/index` in Newsreader — three faces meeting at one baseline, deliberately warm.
4. **Hero number scale.** `frontend-design`'s `2.4M` is `3rem` (~48px) and sits inside a panel. `huashu-design`'s `2.4M` is `clamp(5rem, 14vw, 11rem)` — up to **176px** — with the `M` rendered in matching serif italic amber. Frontend-design treats the number as a stat; huashu-design treats it as the only thing on the page.
5. **Panel framing.** `frontend-design` wraps both stat + chart in 1px-bordered panels with 12px amber corner-brackets at all four corners (Vercel-Ship lineage). `huashu-design` uses no panels at all — content sits directly on the canvas, separated only by hairline rules and a vertical centre axis. The page composition does the framing; no boxes.

Bonus observable: `huashu-design` adds a **24px-pitch dot-grid pattern** to the background (very low opacity) — a generative-art breathing texture absent from `frontend-design`.

---

## Recommendation

**(Non-binding — Marcin's decision.)**

I lean toward **keeping `frontend-design` as the default** for the `designer` agent — for three reasons:

1. **Fit with the existing AGENTICOS aesthetic** locked in S006 (`tokens.css` + `docs/design-system.md`). `frontend-design` produced output that drops onto those tokens with zero drift — same vivid orange `#FF6A00`, same `#0A0A0A` canvas, same hairline + corner-bracket vocabulary. `huashu-design` is more beautiful *as a one-off* but its honey-amber + cool-charcoal + serif-italic combination would require regenerating `tokens.css` (S006) and rewriting `design-system.md` to absorb. That's a knock-on patch the story flags as acceptable but not free.
2. **Predictability.** `frontend-design`'s framework-style guidance is consistent across invocations and easy to constrain. `huashu-design` is more opinionated — it wants to add a generative substrate, a signature detail, asset protocols, and a brand philosophy. That's amazing for one-shot pieces (a launch animation, a deck) but more variable when used as the design-system author for 8+ component specs.
3. **Aesthetic ambition vs operational fit.** For the AgenticOS *public CV* — a recurring page that a future hiring manager skims in 8 seconds — the brutalist-terminal read of `frontend-design` says "I run an OS" faster than the editorial-minimal read of `huashu-design`, which says "I write essays". The product positioning of AgenticOS is closer to the former.

**However**, I want to flag: `huashu-design`'s hero-number treatment and the wordmark's mono-meets-serif moment are genuinely better craft. If Marcin's bias is "I want this to look like nothing else in PM-portfolio-land," `huashu-design` is the bolder pick and `tokens.css` regeneration is a 30-minute job.

**Open-design** I can't recommend from a generated artifact — but as a *tool category* it's different from the other two: it's where you go when you want **iteration in a UI**, not single-shot generation. Worth keeping installed for the times Marcin wants to A/B four variants visually without re-prompting through the CLI. Don't make it the default; do keep it as the third option in the toolbelt.

---

## Cost / friction

| Variant | Setup steps | Per-generation friction | Repeatable in-repo | External app? |
|---|---|---|---|---|
| `frontend-design` | None — bundled in Claude Code | Low — single Skill tool invocation | Yes | No |
| `huashu-design` | One-line config flip in `~/.claude/settings.json` (`skillOverrides`) | Low — single Skill tool invocation | Yes | No |
| `open-design` | Clone repo + `docker compose up -d` (~3 min one-time) + paste API key in browser Settings | **Medium-high** — browser session, BYOK setup, manual "Save to disk", file copy | Not from a sub-agent without preloaded credentials | Yes — runs at `http://localhost:7456`, lives outside the AgenticOS repo |

**Estimated wall-clock per future re-generation:**
- `frontend-design`: 2-3 min (skill invocation + handwriting based on its framework)
- `huashu-design`: 3-5 min (skill loads more context; outputs more opinionated guidance)
- `open-design`: 6-8 min interactive (Marcin types prompt → waits for SSE stream → clicks save → copies file)

---

## Files in this folder

```
notes/design-skill-poc/
├── README.md                      (this file)
├── frontend-design/
│   ├── layout.html                (generated PoC)
│   └── generation-log.md          (skill suggestion + accept/reject)
├── huashu-design/
│   ├── layout.html                (generated PoC)
│   └── generation-log.md          (skill philosophy + signature detail)
├── open-design/
│   ├── SKIPPED.md                 (graceful fallback + manual instructions)
│   └── setup-log.md               (timeline, key facts, what would have been done)
└── open-design-app/               (shallow clone of nexu-io/open-design, ~140 MB)
    ├── deploy/                    (docker-compose entry point)
    └── ... (full repo)
```

The `open-design-app/` clone is left in place so Marcin can run the manual variant later without re-cloning. It can be trashed any time without affecting the rest of S016.
