---
type: research-dossier
project: AgenticOS
status: draft
last_updated: 2026-05-10
notebooklm_id: 51ab2c0c-97ae-494b-b77e-f4a2e0602eb3
notebooklm_url: https://notebooklm.google.com/notebook/51ab2c0c-97ae-494b-b77e-f4a2e0602eb3
sources_consulted: 42
streams: 5
---

# AgenticOS — Research Dossier (2026-05-10)

NotebookLM notebook `51ab2c0c-97ae-494b-b77e-f4a2e0602eb3` was created and seeded with 10 sources covering streams 1–3. Tavily was used in parallel for breadth across all 5 streams (model=auto + advanced search). The dossier below merges both.

---

## 1. Best Claude skills for building this dashboard

Findings:

- **`frontend-design`** (Anthropic, official) pushes Claude to pick a deliberate aesthetic direction before writing code, instead of defaulting to "Inter + purple gradient + rounded cards". Auto-activates for frontend work.
- **`huashu-design`** (alchaincyf, 6,600+ stars) is the most-cited community skill. HTML-native, 20 design philosophies, 5-dim review, MP4/PPTX/PDF export. Reverse-engineered from Claude Design's system prompts; runs in Claude Code, Cursor, Codex. README is Chinese but the agent is bilingual.
- **`brand-guidelines`** (Anthropic, in `anthropics/skills`) — clean template for building a per-project brand skill (good base for orange-on-black tokens).
- **`claude-api`** (Anthropic, same repo) — install for `data-pipeline` + `backend` agents; nudges toward prompt caching, batches, current model selection.
- **`Claude-Code-Frontend-Design-Toolkit`** (wilwaldon, April 2026) — curated index of 70+ frontend skills/plugins/MCPs. Discovery surface, not a dependency.

**Recommendation:** Install `frontend-design` + `huashu-design` + `claude-api`. Build a project-local `agenticos-brand` skill from the `brand-guidelines` template pinning orange/black tokens, Fira Code, AGENTICOS logotype rules — `designer` agent invokes it explicitly.

Sources:
- https://github.com/anthropics/skills
- https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md
- https://github.com/alchaincyf/huashu-design
- https://pyshine.com/Huashu-Design-HTML-Native-Design-Skill-Claude-Code/
- https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit
- https://www.analyticsvidhya.com/blog/2026/03/github-repositories-to-get-free-claude-code-skills/

---

## 2. Best open-source dashboard / portfolio / "agent OS" template repos

Findings:

- **`steven-tey/portfolio`** — modular Next.js portfolio (4,000+ stars), each section a standalone component. Reference for section-as-component pattern.
- **Astro Terminal Theme** (port of Hugo Terminal by panr) — closest visual match: Fira Code, retro palettes, customisable via Terminal.css. Free, MIT.
- **`ixartz/Astro-boilerplate`** — Astro + React + Tailwind + strict tooling (TS/ESLint/Prettier/Husky). Good engineering baseline.
- **Astronaut** (Astro admin dashboard with vibrant orange accents) + **Flowbite Astro Admin** — closest "stat-card grid" templates. Astronaut already uses orange.
- **Zaggonaut / Neodev / Futura** (Astro Themes gallery) — retro/futurist portfolios worth a quick screenshot triage.

**Recommendation:** Start from a blank Astro app (per the founding plan). Pull patterns from: (a) Astro Terminal Theme for type + terminal chrome, (b) Astronaut for stat-card grid, (c) `steven-tey/portfolio` for modular composition. Don't fork wholesale — the AGENTICOS aesthetic is distinctive enough that templates fight the design.

Sources:
- https://astro.build/themes/details/astro-terminal/
- https://github.com/ixartz/Astro-boilerplate
- https://github.com/steven-tey/portfolio
- https://getastrothemes.com/free-astro-themes-templates/ (Astronaut, Zaggonaut)
- https://dev.to/srbhr/-5-portfolio-templates-you-can-deploy-tonight-no-react-experience-required-4d5k

---

## 3. Best repos for parsing Claude usage data

Findings:

- **`ryoppippi/ccusage`** is the de-facto standard. CLI, MIT, `npx ccusage` zero-install. Walks `~/.claude/projects/*/*.jsonl`, aggregates by day/week/month/session/5-hour-block, offline pricing cache, JSON export, MCP server. Production reference for `parse-jsonl.ts`.
- **`getagentseal/codeburn`** is the multi-agent successor: Claude Code, Codex, Cursor, Gemini CLI, OpenCode, OpenClaw, Roo/Kilo, Pi, Kimi, Qwen. Useful if AgenticOS should count Codex/Cursor too.
- **`junhoyeo/tokscale`** — Rust TUI, cross-platform. Clean Rust reference if Bun perf isn't enough.
- **`Maciek-roboblog/Claude-Code-Usage-Monitor`** — Python live-burn tool with ML "time-to-limit" predictions. Read for the weekly-window logic in `data/limits.yaml`.
- **Critical caveat:** Gille's analysis shows JSONL undercounts real usage by ~10–100× because it records visible output only, not Opus thinking tokens; streaming entries also distort counts. AgenticOS's cumulative-$ headline will be 1–2 orders of magnitude **lower** than the Anthropic invoice. The plan's monthly invoice reconciliation in `data/invoices/` covers this — keep it, surface drift on `/ops`, label the JSONL $ as "estimated visible spend".

**Recommendation:** Read `ccusage`'s `loadDailyUsageData` and pricing logic line-by-line, then write a custom parser (founding plan needs redaction + Obsidian-vault counts in the output). Use `codeburn` as reference for cache-creation/cache-read columns. Add a `/ops` footnote that the JSONL estimate is "visible-output bound" — invoice CSV is ground truth.

Sources:
- https://github.com/ryoppippi/ccusage (and https://ccusage.com/)
- https://github.com/getagentseal/codeburn
- https://github.com/junhoyeo/tokscale
- https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/
- https://code.claude.com/docs/en/monitoring-usage
- https://www.natecue.com/en/learn/ai/ccusage-codeburn-track-claude-code-usage/

---

## 4. AgenticOS-style aesthetic inspiration

Findings:

- **Wickstrom's "Monospace Web"** — canonical grid-aligned monospace UI: 80ch body, `font-variant-numeric: tabular-nums lining-nums`, `--border-thickness: 2px`. Free CSS to fork.
- **Karpathy blog + nanoGPT/nanochat READMEs** — minimal, monospace-leaning, code-forward. Researcher-aesthetic baseline.
- **Vercel Ship 2025** — black/white precision, Geist, visible-structure pattern (lines marking margins, photo-frame corners). Strong reference for empty space + structural ornament on a dark canvas.
- **`getdesign.md/vercel`** — packaged Vercel-style DESIGN.md, loadable with `npx getdesign@latest add vercel`. Same idea as a skill: a designer brief the agent reads.
- **`agentscope-ai/QwenPaw`** + **codeburn** screenshots — TUI-aesthetic dashboards are a recognisable 2026 genre.

Recurring tokens:
- Background near-black (`#0a0a0a`–`#111111`), single accent (orange `~#ff6a00`).
- Monospace primary (Fira Code, Geist Mono, JetBrains Mono).
- Tabular numerals always-on.
- Border 1–2px, no shadows, no gradients.
- Structural ornaments (corner brackets, dotted margin lines).
- High info-density per element; page overall uncluttered.

**Recommendation:** Lock `src/styles/tokens.css` early — `--bg:#0a0a0a; --fg:#e6e6e6; --accent:#ff6a00; --muted:#6b6b6b; --border:#2a2a2a;` font stack `"Fira Code","JetBrains Mono",ui-monospace,monospace`; `font-variant-numeric: tabular-nums`. Borrow one Vercel Ship ornament (corner brackets or dotted margins). Resist gradients, shadows, rounded cards — both design skills explicitly warn against those.

Sources:
- https://wickstrom.tech/2024-09-26-how-i-built-the-monospace-web.html
- http://karpathy.github.io/2026/02/12/microgpt/
- https://vercel.com/blog/designing-and-building-the-vercel-ship-conference-platform
- https://getdesign.md/vercel/design-md
- https://astro.build/themes/details/astro-terminal/
- https://github.com/karpathy/nanoGPT

---

## 5. PM-in-Obsidian best practice

Findings:

- **Kanban + Tasks + Dataview is the validated community trio** for Obsidian PM. Multiple long-form write-ups (Sweet Setup, Obsibrain, Evan Travers, forum.obsidian.md) describe near-identical setups: Kanban for board, Tasks for syntax/recurring, Dataview for cross-cutting queries.
- **Sharp edge:** Kanban and Tasks don't natively sync custom statuses — dragging a Kanban card to "Done" doesn't set Tasks' `done` date. Workaround = Dataview queries on YAML `status:` front-matter rather than either plugin's internal state. Founding plan's `status: backlog|ready|in-progress|review|done` convention is exactly this pattern — confirmed sound.
- **`automazeio/ccpm`** — most relevant agent-PM repo. Claude Code skill running PRD → Epic → Task → Issue → Code → Commit, backed by GitHub Issues + git worktrees, with deterministic bash scripts for status/standup/blocked. Harness-agnostic. Even though AgenticOS PMO stays in Obsidian (not GitHub), the `references/conventions.md` and frontmatter schemas are a useful sanity check.
- **JD Wilkins' "AI-Powered Task Management with Obsidian and Claude Code"** — Claude maintains `agent-notes.md` of behavioural observations alongside user-maintained `context.md`. Cleanest published example of an LLM keeping an Obsidian workspace coherent.
- LogSeq alternative was checked: no clear superiority. Obsidian's Kanban-as-markdown-file primitive (mgmeyers/obsidian-kanban) is load-bearing; LogSeq's outliner model would force a different story-shape.

**Recommendation:** Keep the Kanban + Tasks + Dataview stack — validated 2026 pattern. Two enhancements:

1. Borrow `ccpm` conventions for `202605_AgenticOS_PMO/CLAUDE.md` — frontmatter schemas + deterministic-script-vs-LLM split + bash idioms for standup/status/blocked (run as Bash hooks, not agent calls — cheaper, faster, no token cost).
2. Have `pm-curator` maintain an `agent-notes.md` per Wilkins' pattern, recording observations like "S00X bounced twice — split too large", so the PMO learns from itself across phases.

Sources:
- https://github.com/automazeio/ccpm
- https://www.jdhwilkins.com/how-i-built-an-ai-powered-task-system-with-obsidian-and-claude-code
- https://thesweetsetup.com/my-obsidian-based-kanban-writing-workflow/
- https://forum.obsidian.md/t/using-tasks-and-kanban-plugin-together/56018
- https://forum.obsidian.md/t/dataview-tasks-from-all-notes-linked-from-one-specific-note-kanban/55394
- https://taskforge.md/blog/obsidian-project-management/
- https://evantravers.com/articles/2025/01/06/setting-up-obsidian-tasks-as-a-things-app-user/
- https://news.ycombinator.com/item?id=44960594

---

## Summary table — install / read / fork

| Item | Action | Stream |
|---|---|---|
| `frontend-design` skill | Install (already global) | 1 |
| `huashu-design` skill | Install via `npx skills add alchaincyf/huashu-design` | 1 |
| `claude-api` skill | Install for data-pipeline + backend agents | 1 |
| Project-local `agenticos-brand` skill | Build from Anthropic `brand-guidelines` template | 1 |
| `ryoppippi/ccusage` | Read, do not fork; copy aggregation logic | 3 |
| `getagentseal/codeburn` | Read for cache-token handling | 3 |
| Wickstrom Monospace Web CSS | Fork into `tokens.css` baseline | 4 |
| `automazeio/ccpm` conventions | Borrow frontmatter + bash idioms into PMO | 5 |
| Astro Terminal Theme | Reference for fonts/colours only | 2, 4 |
