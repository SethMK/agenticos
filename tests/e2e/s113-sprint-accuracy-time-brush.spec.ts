/**
 * S113 — sprint-accuracy brush/zoom two-panel layout.
 * Bullets B3, B4, B5, B8 verified via Playwright bbox + count API.
 *
 * Vocab anchors (do NOT confuse):
 *   - text.offscale-glyph → "↑ NNNm" numerical, fires when bTotal > Y_CAP
 *   - text.overrun-glyph  → "↑" alone, fires when ratio > varianceFlagThreshold
 */
import { expect, test } from '@playwright/test';

const TIME_CHART_SELECTOR = 'section.stacked-comparison[aria-label*="time"]';
const TOKENS_CHART_SELECTOR = 'section.stacked-comparison[aria-label*="tokens"]';

test.describe('S113 · sprint-accuracy brush-zoom two-panel', () => {
  test('B3 · main panel = 10 bar-groups; overview = ≥24 rects', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const chart = page.locator(TIME_CHART_SELECTOR);
    await expect(chart).toBeVisible();

    // Main panel = first chart-wrap inside section
    const mainBarGroups = chart.locator('.chart-wrap g.bar-group');
    const mainCount = await mainBarGroups.count();
    console.log(`[S113-B3] main bar-groups=${mainCount}`);
    expect(mainCount, 'main panel last-10 bar-groups').toBe(10);

    const overviewSvg = chart.locator('.overview-wrap svg.overview-svg');
    await expect(overviewSvg).toBeVisible();
    const overviewRects = await overviewSvg.locator('rect').count();
    console.log(`[S113-B3] overview rect count=${overviewRects}`);
    expect(overviewRects, 'overview rects ≥24').toBeGreaterThanOrEqual(24);
  });

  test('B4 · window-rect positioned within rightmost 50% of overview', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const chart = page.locator(TIME_CHART_SELECTOR);
    const overviewSvg = chart.locator('.overview-wrap svg.overview-svg');
    await expect(overviewSvg).toBeVisible();

    const svgBox = await overviewSvg.boundingBox();
    expect(svgBox).not.toBeNull();
    if (!svgBox) throw new Error('overview svg bbox null');

    const windowRect = overviewSvg.locator('rect.window-rect');
    await expect(windowRect).toBeVisible();
    const rectBox = await windowRect.boundingBox();
    expect(rectBox).not.toBeNull();
    if (!rectBox) throw new Error('window-rect bbox null');

    const leftPct = (rectBox.x - svgBox.x) / svgBox.width;
    console.log(
      `[S113-B4] svg.w=${svgBox.width.toFixed(1)} rect.x=${rectBox.x.toFixed(1)} ` +
        `rect.w=${rectBox.width.toFixed(1)} left%=${(leftPct * 100).toFixed(1)}`,
    );
    // Last-10 of 24 starts at index 14 → 14/24 = 58.3% of plot width
    expect(leftPct, 'window-rect.left within rightmost 50% (≥50%)').toBeGreaterThanOrEqual(0.5);
  });

  test('B5 · main panel renders ≥1 text.offscale-glyph matching ↑ NNNm', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const chart = page.locator(TIME_CHART_SELECTOR);
    await expect(chart).toBeVisible();

    // SPR-010 is at index 9 of 24; not in last-10 window. Fallback: any
    // text.offscale-glyph in main panel matching the numerical glyph format.
    const mainOffscale = chart.locator('.chart-wrap text.offscale-glyph');
    const count = await mainOffscale.count();
    console.log(`[S113-B5] main offscale-glyph count=${count}`);
    expect(count, 'main panel has ≥1 offscale-glyph').toBeGreaterThanOrEqual(1);

    // Verify text format on the first one
    const first = await mainOffscale.first().textContent();
    const txt = (first ?? '').trim();
    console.log(`[S113-B5] first offscale text="${txt}"`);
    expect(txt).toMatch(/↑\s*\d+m/);
  });

  test('B8 · both consumer sections render two-panel layout', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const sections = page.locator('section.stacked-comparison');
    await expect(sections).toHaveCount(2);

    const time = page.locator(TIME_CHART_SELECTOR);
    const tokens = page.locator(TOKENS_CHART_SELECTOR);
    await expect(time.locator('.overview-wrap')).toBeVisible();
    await expect(tokens.locator('.overview-wrap')).toBeVisible();

    const timeRects = await time.locator('.overview-wrap rect').count();
    const tokensRects = await tokens.locator('.overview-wrap rect').count();
    console.log(`[S113-B8] time.overview-rects=${timeRects} tokens.overview-rects=${tokensRects}`);
    expect(timeRects).toBeGreaterThanOrEqual(24);
    expect(tokensRects).toBeGreaterThanOrEqual(24);
  });

  test('B6 · caption matches "showing last N of M sprints"', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const time = page.locator(TIME_CHART_SELECTOR);
    const caption = time.locator('.window-caption');
    await expect(caption).toBeVisible();
    const txt = (await caption.textContent())?.trim() ?? '';
    console.log(`[S113-B6] caption="${txt}"`);
    expect(txt).toMatch(/showing last \d+ of \d+ sprints/);
  });
});
