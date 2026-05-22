# AgenticOS

Self-hosted CV + ops dashboard. Live at **[agenticos.sethsendom.com](https://agenticos.sethsendom.com)**.

A 7-agent orchestrator runs the build story-by-story from a kanban backlog. Each agent owns specific files, hands off via explicit STOP markers, and writes a verification log for the next step.

## Two views

- **`/` (public)** — CV dashboard. Tokens burned, projects, skills, agents, MCPs, wiki + NotebookLM counts, cumulative spend, usage chart.
- **`/how-it-was-built` (public)** — read-only kanban + sample stories sourced from the [agentic-os-pmo](https://github.com/SethMK/agentic-os-pmo) sister project.
- **`/ops` (private)** — Cloudflare Access gated (Google SSO). Real project names, weekly limit window, monthly spend, per-project costs.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Astro |
| Backend | Bun |
| Auth | Cloudflare Tunnel + Cloudflare Access (Google SSO) |
| Data pipeline | Mac-side walker (scans `~/.claude/projects/`) → 15-min snapshots → rsync to Proxmox LXC |
| Storage | JSON snapshots + SQLite for aggregates |

## Orchestrator

7 sub-agents, single-story-at-a-time loop:

| Agent | Role |
|---|---|
| `researcher` | NotebookLM deep research per story |
| `data-pipeline` | Walker + snapshot emit + rsync |
| `designer` | UI specs + Pencil MCP integration |
| `frontend` | Astro components, state, routing |
| `backend` | Bun APIs, data shaping, auth |
| `infra-deploy` | Cloudflare Tunnel + Access config, LXC deploy |
| `qa-verifier` | Playwright tests, screenshot diff, smoke checks |

Story state machine: **Backlog → Ready → In Progress → Review → Done**. No parallel work-in-progress.

## Calibration table

Story-sizing anchored to **measured** token + time runs, not story-point fiction:

| Bucket | Typical scope |
|---|---|
| S-inline | Single-file edit, no QA |
| S-with-QA | Single-file edit + Playwright pass |
| M-data | Data-shape change, multi-file edit |
| M-frontend | New component + integration |
| L-single | Full new feature, single agent |
| Spike | Time-boxed research, no commit expected |

Observed floor: ~130k tokens for cold-rebuild + Playwright QA regardless of edit size. Verification shape dominates code surface area.

## Code

Code lives in a private repo. This public README documents architecture + live URL. Companion methodology repo: [agentic-os-pmo](https://github.com/SethMK/agentic-os-pmo).

---

Built by [Marcin Kokott](https://linkedin.com/in/marcinkokott) — Head of Product & Delivery, Vazco.
