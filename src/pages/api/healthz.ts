// S077: Health check endpoint — mirrors the Bun server /healthz handler exactly.
// Returns { ok: true, snapshot_age_seconds: <int> } or { ok: false, snapshot_age_seconds: null }
export const prerender = false;

import { statSync } from 'fs';
import { join } from 'path';

const PUBLIC_SNAPSHOT = join(process.cwd(), 'data/snapshots/public.json');

export function GET(): Response {
  try {
    const stat = statSync(PUBLIC_SNAPSHOT);
    const ageSeconds = Math.floor((Date.now() - stat.mtimeMs) / 1000);
    return new Response(JSON.stringify({ ok: true, snapshot_age_seconds: ageSeconds }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, snapshot_age_seconds: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
