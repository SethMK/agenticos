// S077: SSR endpoint — reads data/snapshots/public.json at request time.
// prerender=false so the Astro node adapter serves this dynamically on CT 110.
export const prerender = false;

import { readFileSync } from 'fs';
import { join } from 'path';

const SNAPSHOT = join(process.cwd(), 'data/snapshots/public.json');

export function GET(): Response {
  try {
    const data = readFileSync(SNAPSHOT, 'utf-8');
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=300',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'snapshot unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
