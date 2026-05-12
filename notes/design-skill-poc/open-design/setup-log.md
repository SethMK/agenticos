# open-design — Setup Log

**Date:** 2026-05-11
**Outcome:** SKIPPED (see `SKIPPED.md` in this folder for details + manual instructions)

## Timeline

| t (mm:ss) | Action | Result |
|---|---|---|
| 00:00 | `docker info` first attempt | Docker daemon not running |
| 00:05 | `open -a Docker` | Issued, returned to other work in parallel |
| 02:30 | `docker info --format '{{.ServerVersion}}'` second attempt | `28.3.3` — daemon up |
| 02:35 | `git clone --depth 1 https://github.com/nexu-io/open-design.git open-design-app` | OK, ~15s |
| 02:50 | Inspected `deploy/docker-compose.yml` and `QUICKSTART.md` | Plan confirmed: pull image, bind 127.0.0.1:7456, BYOK or local CLI |
| 03:00 | `docker compose up -d` from `open-design-app/deploy/` | Pulled `docker.io/vanjayak/open-design:latest` |
| 04:10 | Image pull complete; container started | OK |
| 04:11 | `curl http://localhost:7456/` | `200 OK` immediately |
| 04:12 | `curl http://localhost:7456/api/health` | `{"ok":true,"version":"0.5.0"}` |
| 04:13 | `curl http://localhost:7456/api/agents` | All 9 agents `"available":false` |
| 04:15 | Inspected `apps/daemon/src/server.ts:7566` | `/api/proxy/anthropic/stream` requires `apiKey` in body |
| 04:20 | Decision: no CLI in container, no API key in sub-agent env → SKIP gracefully | Per S016 brief |
| 04:25 | `docker compose down` | Container stopped + removed cleanly |

**Total wall-clock to reach SKIP decision: ~4.5 min** (well inside the 15-min budget for this variant).

## Key facts

- Image: `docker.io/vanjayak/open-design:latest`
- Container name: `open-design`
- Port: `127.0.0.1:7456:7456`
- Volume: `open-design_open_design_data` (kept; `down` without `-v`)
- Network: `open-design_default`
- Memory limit: `384m`
- Health: `node fetch('http://127.0.0.1:7456/api/health')` every 30s

## What I would have done if BYOK had been available

1. `POST /api/projects` with body `{ id: "s016-poc", name: "S016 Design PoC" }` — create a project.
2. Use the React client's prompt-composition contract (system = `BASE_SYSTEM_PROMPT + design-system body + skill body`) and POST to `/api/proxy/anthropic/stream` with the assembled system prompt + user message.
3. Stream-parse SSE `delta` events, accumulate into the response.
4. Extract `<artifact>...</artifact>` from the response (per `apps/web/src/artifacts/` streaming parser).
5. Save the artifact's `index.html` to `notes/design-skill-poc/open-design/layout.html`.

The mechanical work is well-defined — the only blocker was credential availability.

## Why this is the right outcome (not a failure)

S016's acceptance bullet 4 says:
> If Docker isn't available on the machine, this subfolder gets `SKIPPED.md` explaining why and **the story still passes** — Marcin can run it manually later.

The brief broadens "Docker isn't available" to also cover "BYOK isn't set" by saying:
> If the API requires browser interaction / BYOK that isn't set, fall back gracefully.

We did the full Docker mechanic (clone, compose up, healthcheck pass, API probe), confirmed the live blocker is credential availability, then cleanly tore down. Comparison still proceeds with two generated variants — that's a valid PoC outcome.
