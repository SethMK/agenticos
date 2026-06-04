import { test, expect } from '@playwright/test';

const URL = '/research/explorer';
const TOTAL_ITEMS = 24;

test.describe('research explorer', () => {
  test('page renders with all hypothesis cards', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('.exp-card')).toHaveCount(TOTAL_ITEMS);
  });

  test('deselecting validated filter dims its cards and dots', async ({ page }) => {
    await page.goto(URL);
    // Wait for scatter dots to be drawn
    await page.waitForSelector('.sc-dot');

    const btn = page.locator('[data-filter-state="validated"]');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');

    // All validated cards must have dim class (opacity reduced)
    const validatedCards = page.locator('.exp-card.card-validated');
    const cardCount = await validatedCards.count();
    expect(cardCount).toBeGreaterThan(0);
    for (let i = 0; i < cardCount; i++) {
      await expect(validatedCards.nth(i)).toHaveClass(/\bdim\b/);
    }

    // At least one scatter dot must be dimmed
    await expect(page.locator('.sc-dot.dim')).not.toHaveCount(0);
  });

  test('clicking a card populates detail panel with claim, practice, evidence', async ({ page }) => {
    await page.goto(URL);
    // Click the second card so we exercise the click path (first is auto-selected on init)
    const cards = page.locator('.exp-card');
    await cards.nth(1).click();

    const detail = page.locator('#detail');
    await expect(detail.locator('.dt-badge')).toBeVisible();
    await expect(detail.locator('.dt-title')).toBeVisible();
    await expect(detail.locator('dt').filter({ hasText: 'claim' })).toBeVisible();
    await expect(detail.locator('dt').filter({ hasText: 'evidence' })).toBeVisible();
  });

  test('layout collapses to single column at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(URL);
    const cols = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.exp-grid')!).gridTemplateColumns
    );
    // Single column: one resolved pixel value, not three
    expect(cols.trim().split(/\s+/).filter(Boolean)).toHaveLength(1);
  });

  test('layout collapses to single column at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(URL);
    const cols = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.exp-grid')!).gridTemplateColumns
    );
    expect(cols.trim().split(/\s+/).filter(Boolean)).toHaveLength(1);
  });

  test('layout is three-column at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(URL);
    const cols = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.exp-grid')!).gridTemplateColumns
    );
    // Three-column: "260px Xpx 320px" → 3 resolved values
    expect(cols.trim().split(/\s+/).filter(Boolean)).toHaveLength(3);
  });
});
