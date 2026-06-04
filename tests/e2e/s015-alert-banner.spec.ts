/**
 * S015 — alert-banner e2e spec.
 *
 * Fixture injection: physical file swap on data/snapshots/ops.json (file is
 * read at SSR request time, so swapping before page.goto() is picked up).
 * The OPS_SNAPSHOT_PATH env-var override mechanism is implemented in
 * src/pages/ops/index.astro for alternative injection paths.
 *
 * Auth: injects cf-access-authenticated-user-email header so the local dev
 * server's requireAuth() guard passes.
 */
import { test, expect } from './fixtures.ts';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const OPS_SNAPSHOT = join(process.cwd(), 'data/snapshots/ops.json');
const AUTH_HEADER = 'cf-access-authenticated-user-email';
const AUTH_EMAIL = 'kokott.marcin@gmail.com';

const aboveFixture = readFileSync(
  join(process.cwd(), 'tests/e2e/fixtures/ops-above-threshold.json'),
  'utf-8',
);
const belowFixture = readFileSync(
  join(process.cwd(), 'tests/e2e/fixtures/ops-below-threshold.json'),
  'utf-8',
);

test.describe('S015 — alert banner', () => {
  let originalSnapshot: string;

  test.beforeAll(() => {
    originalSnapshot = readFileSync(OPS_SNAPSHOT, 'utf-8');
  });

  test.afterAll(() => {
    writeFileSync(OPS_SNAPSHOT, originalSnapshot);
  });

  test('banner visible at 0.81 ratio (above threshold)', async ({ page }) => {
    writeFileSync(OPS_SNAPSHOT, aboveFixture);
    await page.setExtraHTTPHeaders({ [AUTH_HEADER]: AUTH_EMAIL });
    await page.goto('/ops');
    const banner = page.locator('[data-alert="warning"]');
    await expect(banner).toBeVisible();
    await expect(page.locator('body')).toContainText('weekly limit', { ignoreCase: true });
  });

  test('banner absent at 0.79 ratio (below threshold)', async ({ page }) => {
    writeFileSync(OPS_SNAPSHOT, belowFixture);
    await page.setExtraHTTPHeaders({ [AUTH_HEADER]: AUTH_EMAIL });
    await page.goto('/ops');
    await expect(page.locator('[data-alert="warning"]')).not.toBeAttached();
  });
});
