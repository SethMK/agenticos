import { test, expect } from '@playwright/test';

const URL = '/research/tracker';
// These counts mirror public.json research.{validated,watching,backlog}.length — update when data changes.
const VALIDATED = 13;
const WATCHING = 5;
const QUEUED = 6;

test.describe('research tracker', () => {
  test('three lanes render', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('section[aria-label="Validated hypotheses"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Watching hypotheses"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Queued hypotheses"]')).toBeVisible();
  });

  test('metric strip counts match data', async ({ page }) => {
    await page.goto(URL);
    const cells = page.locator('.strip-cell');
    await expect(cells).toHaveCount(4);

    const validatedVal = cells.nth(0).locator('.strip-v');
    const watchingVal  = cells.nth(1).locator('.strip-v');
    const queuedVal    = cells.nth(2).locator('.strip-v');

    await expect(validatedVal).toHaveText(String(VALIDATED));
    await expect(watchingVal).toHaveText(String(WATCHING));
    await expect(queuedVal).toHaveText(String(QUEUED));
  });

  test('watching card shows n=k/threshold text and meter', async ({ page }) => {
    await page.goto(URL);
    const watchingCards = page.locator('.tk-watching');
    const count = await watchingCards.count();
    expect(count).toBe(WATCHING);

    // First card must have n=k/threshold label
    const firstCard = watchingCards.first();
    const nLabel = firstCard.locator('.tk-n');
    await expect(nLabel).toBeVisible();
    const nText = await nLabel.textContent();
    expect(nText).toMatch(/^n=\d+\/\d+$/);

    // Progress bar (meter) must be present
    const meter = firstCard.locator('[role="progressbar"]');
    await expect(meter).toBeVisible();
    const valuenow = await meter.getAttribute('aria-valuenow');
    const valuemax = await meter.getAttribute('aria-valuemax');
    expect(Number(valuenow)).toBeGreaterThanOrEqual(0);
    expect(Number(valuemax)).toBeGreaterThan(0);
  });

  test('layout collapses to single column at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(URL);
    const cols = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.lanes')!).gridTemplateColumns
    );
    expect(cols.trim().split(/\s+/).filter(Boolean)).toHaveLength(1);
  });

  test('layout collapses to single column at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(URL);
    const cols = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.lanes')!).gridTemplateColumns
    );
    expect(cols.trim().split(/\s+/).filter(Boolean)).toHaveLength(1);
  });

  test('layout is three-column at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(URL);
    const cols = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.lanes')!).gridTemplateColumns
    );
    // Three equal columns → "Xpx Xpx Xpx" → 3 values
    expect(cols.trim().split(/\s+/).filter(Boolean)).toHaveLength(3);
  });
});
