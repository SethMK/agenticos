# open-design — SKIPPED (graceful fallback)

**Date:** 2026-05-11
**Status:** Container ran, healthchecked, but cannot be driven end-to-end from this sub-agent context. Per the S016 brief this is an **expected fallback**, not a failure of the story.

## What worked

1. `git clone --depth 1 https://github.com/nexu-io/open-design.git` — succeeded. Repo present at `notes/design-skill-poc/open-design-app/`.
2. `cd open-design-app/deploy && docker compose up -d` — succeeded. Pulled `docker.io/vanjayak/open-design:latest`, started container `open-design`.
3. `curl http://localhost:7456/` → `200 OK` within **1 second** of container start.
4. `curl http://localhost:7456/api/health` → `{"ok":true,"version":"0.5.0"}`.
5. `curl http://localhost:7456/api/agents` returned the full agent registry.

## What blocked end-to-end generation

Open-design needs **either** (a) a local agent CLI (`claude`, `codex`, `devin`, etc.) on the **container's** PATH, **or** (b) a BYOK API key (Anthropic / OpenAI / Azure / Google / Ollama) configured through the browser settings UI.

| Path | Why it's blocked here |
|---|---|
| **Local CLI** | The Docker image is `read_only: true` with a minimal Node runtime. No host CLIs are mounted. All entries in `/api/agents` return `"available": false` — claude / codex / devin / gemini / opencode / cursor-agent / qwen / qoder / copilot are all flagged unavailable inside the container. |
| **BYOK API mode** | The `/api/proxy/anthropic/stream` endpoint (see `apps/daemon/src/server.ts:7566`) requires `baseUrl` + `apiKey` + `model` in the request body. There is no Anthropic / OpenAI / Gemini API key available in this sub-agent's environment. The frontend stores keys in `localStorage` via the browser Settings panel — there's no API to inject them headlessly. |
| **`/api/chat` daemon route** | Routes through `spawn(<agent>, ...)` against `/api/agents` — same CLI-availability blocker as above. |

## Why this isn't a "fix it now" task

The story (S016) explicitly says:

> If anything in the Docker path errors (Docker not running, image pull fails, network blocked), write `SKIPPED.md` immediately — do not retry more than once.

and

> If the API requires browser interaction / BYOK that isn't set, **fall back gracefully** [...] **The story explicitly permits this fallback — it is not a failure of S016.**

Both conditions are met here. Driving open-design end-to-end requires a human-in-the-loop step (open `http://localhost:7456`, paste an API key into Settings, type a prompt, click Send, click "Save to disk"). That's the right shape of work for Marcin to do interactively at his desk — not a sub-agent.

## Manual instructions for Marcin

If you want the open-design variant for parity with the other two:

```bash
cd /Users/marcinkokott/Projects/personal/202605_AgenticOS/notes/design-skill-poc/open-design-app/deploy
docker compose up -d

# Wait ~5 seconds then open:
open http://localhost:7456

# In the app:
# 1. Click the gear icon → Settings → Execution & model
# 2. Switch from "Local CLI" to "Anthropic API"
# 3. Paste your Anthropic API key, save
# 4. Top bar: Skill = "web-prototype" (or "dashboard"), Design system = "Neutral Modern"
#    — but consider importing tokens.css manually if you want a fair comparison
# 5. In the chat pane, paste this prompt:

PROMPT:
"""
Build a single self-contained AgenticOS public CV layout. Dark background #0A0A0A,
single orange accent #FF6A00, monospace type. Include exactly:
- a page header with 'AGENTICOS' wordmark in monospace, accent colour
- ONE StatCard component: label TOKENS, value 2.4M, delta +18% vs last week with up-triangle glyph
- ONE chart placeholder: inline SVG area chart showing 30-day usage trend (fake data, real visual)
- ONE log feed row at the bottom: '00:30 | S001 | done'
Inline all CSS, no external imports. No emoji — glyphs only (▲ ▼ ◆ ●). Sharp corners, hairline borders.
"""

# 6. When the artifact finishes streaming, click "Save to disk" in the artifact pane.
# 7. The artifact lands at:
#    open-design-app/.od/artifacts/<timestamp>-<slug>/index.html
#    Copy it to:
#    /Users/marcinkokott/Projects/personal/202605_AgenticOS/notes/design-skill-poc/open-design/layout.html
# 8. Re-run S016 acceptance verification.

# Cleanup when done:
cd /Users/marcinkokott/Projects/personal/202605_AgenticOS/notes/design-skill-poc/open-design-app/deploy
docker compose down
```

Estimated manual time: **6-8 minutes** (mostly waiting for the SSE stream).

## Cleanup status

`docker compose down` was run. Container `open-design` is stopped and removed. Volume `open-design_open_design_data` was kept (default `down` behaviour) — to wipe it: `docker compose down -v` from `open-design-app/deploy/`.

## Cost / friction assessment (for the README comparison table)

| Dimension | Value |
|---|---|
| Setup time (one-time) | ~3 min (clone) + ~90 sec (image pull, 1st run) |
| Per-generation friction | High — requires browser session, BYOK setup, manual save-to-disk |
| Repeatability inside Claude Code sub-agent | **Not feasible** without a configured Anthropic key inside the daemon |
| Repeatability for the human | Easy once setup is done (single prompt → artifact) |
| In-repo vs external | External app, lives outside the AgenticOS repo (in `notes/design-skill-poc/open-design-app/`) |
