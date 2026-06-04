/**
 * Smoke tests for AgenticOS public routes.
 *
 * Limitation: `/ops` is Cloudflare Access-protected in production AND in
 * `bun run dev` — `requireAuth()` in api/lib/auth.ts returns 403 unless the
 * `cf-access-authenticated-user-email` header is present. The `/ops` page
 * also does not render `.stat-card` elements (it uses `.window-card`).
 * Therefore the `/ops` smoke test navigates to `/ops` and asserts the route
 * responds (200 or 403 both count as "server alive") without checking for
 * stat-cards. The full ops acceptance is covered by manual QA or a dedicated
 * ops spec that injects the auth header.
 *
 * See tests/e2e/README.md for more detail.
 */
import { test, expect, statCard } from './fixtures.ts';

test('/ has at least one stat-card visible', async ({ page }) => {
  await page.goto('/');
  await expect(statCard(page).first()).toBeVisible();
});

test('/ops route responds (auth-gated locally — smoke only)', async ({ page }) => {
  const response = await page.goto('/ops');
  // The route exists and responds — 200 (if auth bypassed) or 403 (expected
  // locally). Either way the server is alive. 503 would indicate snapshot
  // unavailable. We accept 200 or 403.
  expect([200, 403]).toContain(response?.status());
});
