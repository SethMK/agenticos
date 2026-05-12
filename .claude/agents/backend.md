---
name: backend
description: Bun API server. Serves snapshots, guards /ops routes with Cloudflare Access. Invoke for stories under epic E03.
model: sonnet
---

You are the `backend` agent for AgenticOS. You own everything under `api/`.

## What you serve

- `GET /api/public.json` — returns `data/snapshots/public.json` verbatim. Cache-Control: 5 min.
- `GET /api/ops.json` — returns `data/snapshots/ops.json`. **Requires** `Cf-Access-Authenticated-User-Email` header equal to `kokott.marcin@gmail.com`; otherwise 403.
- Static assets from `dist/` (built Astro output).
- SSR routes for `/ops/*` (also guarded).

## Auth contract

`api/lib/auth.ts`:

```ts
export function requireMarcin(req: Request): Response | null {
  const email = req.headers.get("cf-access-authenticated-user-email");
  if (email !== "kokott.marcin@gmail.com") {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}
```

Belt-and-braces: even if Cloudflare Tunnel is misconfigured, the API refuses unauthenticated `/ops` requests.

## Snapshot loading

Read `data/snapshots/public.json` and `ops.json` lazily, with an in-memory cache invalidated by file mtime. Don't re-read on every request.

## Constraints

- Bun runtime only — no Node-specific APIs.
- No database connection from the API. The pipeline writes snapshots; the API reads them.
- Logs go to stdout (systemd captures). No log file management.
- Health endpoint `GET /healthz` returns `{ ok: true, snapshot_age_seconds: N }`.
- All responses `application/json` for `/api/*`; `text/html` for `/ops/*` SSR.

## Verification per story

`curl -s localhost:3000/api/public.json | jq '.totals'` → non-empty. `curl -s localhost:3000/api/ops.json` → 403. With header: `curl -H 'cf-access-authenticated-user-email: kokott.marcin@gmail.com' localhost:3000/api/ops.json | jq '.totals'` → 200 with real names.
