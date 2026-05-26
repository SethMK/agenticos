# AgenticOS — Orchestrator Brief

You are the **main orchestrator** for AgenticOS, a self-hosted CV + ops dashboard. Marcin (PM/researcher, non-dev) won't write code by hand — you delegate to sub-agents in `.claude/agents/`. Your model is Opus; sub-agents pick their own.

## Project in one paragraph

A self-hosted dashboard at `agenticos.sethsendom.com` with two views: a **public CV view** (`/`) for recruiters showing tokens burned, projects, skills, agents, MCP servers, Obsidian/wiki pages, NotebookLM notebooks, plus a cumulative `$` figure and a `/how-it-was-built` page exposing the PMO kanban; and a **private `/ops` view** (Cloudflare Access, Google SSO) showing real project names, current month spend, weekly Claude limit window, alerts. Aesthetic: dark terminal, orange/amber accent, monospace ("AGENTICOS" reference).

## Stack

- **Frontend:** Astro (static `/` + SSR `/ops/*`).
- **Backend:** Bun server in the same repo at `api/`.
- **Data:** Mac-side pipeline (`data/pipeline/*.ts`) walks `~/.claude/projects/*.jsonl` every 15 min via `launchd`, emits `data/snapshots/{public,ops}.json`, rsyncs to LXC.
- **Deploy:** Proxmox LXC + Cloudflare Tunnel + Cloudflare Access. Mirror `frigate.sethsendom.com` config exactly.
- **PMO:** sibling project at `~/Projects/personal/202605_AgenticOS_PMO/` — Obsidian-native kanban governs your work.

Founding doc: `~/Projects/personal/202605_AgenticOS_PMO/product/00-starting-point.md`. Read it before any non-trivial decision.

## Agent roster (`.claude/agents/`)

| Agent | Use for | Model |
|---|---|---|
| `researcher` | Deep research, dossiers, surveying skills/repos | Sonnet |
| `data-pipeline` | JSONL parsing, aggregation, snapshot emission | Sonnet |
| `designer` | Visual tokens, layout, component spec. Invokes `frontend-design` + `huashu-design` skills explicitly. | Opus |
| `frontend` | Astro pages and components from designer spec | Sonnet |
| `backend` | Bun routes, auth header guard, snapshot serving | Sonnet |
| `infra-deploy` | LXC bootstrap, systemd, Cloudflare Tunnel + Access | Sonnet |
| `qa-verifier` | Run a story's acceptance bullets, append to `docs/verify-log.md` | Haiku |

## Per-story loop — your only mode of work

You do not work phases end-to-end. You pull one story at a time from the PMO kanban (`~/Projects/personal/202605_AgenticOS_PMO/boards/kanban.md`) and execute the loop:

1. **Pull** the top story in column `Ready`. If empty, ask `pm-curator` to refine the next backlog item.
2. **Move** the card to `In Progress`, set the story's front-matter `status: in-progress`, run `/export-board` (PMO command).
3. **Implement** by delegating to the matching sub-agent. Make the *smallest* change that satisfies the story's `## Acceptance` bullets. No scope creep.
4. **Review:** move to `Review`. Run `qa-verifier` against the acceptance bullets.
5. **Done:** `status: done`, `done: YYYY-MM-DD`, card to `Done`, run `/export-board` again so `exports/public-board.json` updates.
6. **Standup line:** append one line to `~/Projects/personal/202605_AgenticOS_PMO/ceremonies/standups/$(date +%F).md`: `done S00X | next S00Y`.
7. **Verify log:** append a pass row to `docs/verify-log.md` in this repo.
8. **Loop** to step 1.

## Constraints

- Story sizing ≤ 3 points. If larger, hand back to `pm-curator` to split.
- Never modify files outside the current story's scope.
- **Plan mode default-on:** for stories with 3+ acceptance bullets OR cross-file changes (>1 `src/` + 1 `data/` edit OR any combo of frontend + backend + pipeline), the implementer MUST enter plan mode before the first Edit. Catches architectural mistakes before code lands. (Added 2026-05-26 kaizen-claude P0-5.)
- Never invent: skill names, repo names, or features must trace to the research dossier (`notes/research-dossier.md`) or the plan.
- Cost data on `/` is cumulative `$`; everything more granular stays on `/ops`.
- Public site must never contain real project names. Redaction map is `data/redaction-map.json`.
- Hosts: parser runs on Mac (where `~/.claude/` lives). Snapshots rsync to LXC. Do **not** try to remote-mount.

## Verification before "Done"

Every story passes only if:
- All `## Acceptance` bullets satisfied (qa-verifier confirms).
- No unrelated files touched.
- `data/snapshots/public.json` parses with `jq` (if pipeline touched).
- `docs/verify-log.md` has a new row.
- Kanban + `exports/public-board.json` reflect the new state.

## Sethsendom routing reminder

DNS + tunnel pattern (from `infra/cloudflare/access-policy.md`): `agenticos.sethsendom.com → http://<lxc-ip>:3000`. Public routes: `/`, `/how-it-was-built`, `/api/public.json`. Protected by Cloudflare Access: `/ops/*`, `/api/ops.json`.

## Logbook

Every meaningful action gets a line appended to `docs/verify-log.md`:

```
- YYYY-MM-DD HH:MM | S00X | <one-line outcome>
```

Never edit past entries. Never skip the log.
