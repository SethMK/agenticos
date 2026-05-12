# AgenticOS

Self-hosted CV + ops dashboard at [agenticos.sethsendom.com](https://agenticos.sethsendom.com). See [`CLAUDE.md`](CLAUDE.md) for the orchestrator brief and [`../202605_AgenticOS_PMO/product/00-starting-point.md`](../202605_AgenticOS_PMO/product/00-starting-point.md) for the founding plan.

## Two views

- **`/`** — public CV dashboard. Tokens burned, projects, skills, agents, MCPs, wiki/NotebookLM counts, cumulative `$`, usage chart.
- **`/how-it-was-built`** — public read-only kanban + sample stories (sourced from the PMO sibling project).
- **`/ops`** — private, Cloudflare Access gated. Real names, weekly limit window, monthly spend, per-project costs.

## Quickstart (once Phase 1 lands)

```bash
bun install
bun run pipeline    # walks ~/.claude/projects, writes data/snapshots/
bun run dev         # Astro dev server at localhost:4321
```

## Stack

Astro + Bun + Cloudflare Tunnel + Cloudflare Access (Google SSO). Data pipeline runs on the Mac and rsyncs snapshots to the Proxmox LXC. See [`docs/architecture.md`](docs/architecture.md) once written.

## Sibling repo

[`../202605_AgenticOS_PMO/`](../202605_AgenticOS_PMO/) — Obsidian-native kanban that drives the build story-by-story.
