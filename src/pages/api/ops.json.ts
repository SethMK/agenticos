// S077: SSR endpoint — reads data/snapshots/ops.json at request time.
// prerender=false so the Astro node adapter serves this dynamically on CT 110.
// Auth guard via requireAuth mirrors the Bun server pattern from S011.
export const prerender = false;

import type { APIContext } from 'astro';
import { readFileSync } from 'fs';
import { join } from 'path';
import { requireAuth } from '../../../api/lib/auth';

const SNAPSHOT = join(process.cwd(), 'data/snapshots/ops.json');

export function GET({ request }: APIContext): Response {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const data = readFileSync(SNAPSHOT, 'utf-8');
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'snapshot unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
