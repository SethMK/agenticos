/**
 * S112 — sprint-accuracy-time median-normalized scale + off-scale glyph.
 * Asserts gate bullets 4-6 via Playwright bounding-box API (not pixel measurement).
 */
import { expect, test } from '@playwright/test';

// Geometry constants mirrored from StackedBarSprintComparison.astro
const VB_H = 220;
const PAD_TOP = 30;
const PAD_BOTTOM = 48;
const PLOT_H = VB_H - PAD_TOP - PAD_BOTTOM; // 142

const TIME_CHART_SELECTOR = 'section.stacked-comparison[aria-label*="time"]';

test.describe('S112 · sprint-accuracy-time median-normalized scale', () => {
  test('SPR-002 + SPR-009 bar heights meet gate thresholds', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const chart = page.locator(TIME_CHART_SELECTOR);
    await expect(chart).toBeVisible();

    const svg = chart.locator('svg.chart-svg');
    const svgBox = await svg.boundingBox();
    expect(svgBox).not.toBeNull();
    if (!svgBox) throw new Error('svg bbox null');

    // Rendered plot pixel height = svg pixel height * (PLOT_H / VB_H)
    const plotHpx = svgBox.height * (PLOT_H / VB_H);

    const spr002Actual = chart.locator(
      'g.bar-group[data-sprint-id="SPR-002"] rect.seg-actual-must',
    );
    const spr009Actual = chart.locator(
      'g.bar-group[data-sprint-id="SPR-009"] rect.seg-actual-must',
    );
    await expect(spr002Actual).toBeVisible();
    await expect(spr009Actual).toBeVisible();

    const box002 = await spr002Actual.boundingBox();
    const box009 = await spr009Actual.boundingBox();
    expect(box002).not.toBeNull();
    expect(box009).not.toBeNull();
    if (!box002 || !box009) throw new Error('bar bbox null');

    const pct002 = box002.height / plotHpx;
    const pct009 = box009.height / plotHpx;

    console.log(
      `[S112-B4] plotHpx=${plotHpx.toFixed(1)} ` +
        `SPR-002=${box002.height.toFixed(1)}px (${(pct002 * 100).toFixed(1)}%) ` +
        `SPR-009=${box009.height.toFixed(1)}px (${(pct009 * 100).toFixed(1)}%)`,
    );

    expect(pct002, 'SPR-002 (36m actual) ≥35% plot height').toBeGreaterThanOrEqual(0.35);
    expect(pct009, 'SPR-009 (73m actual) ≥75% plot height').toBeGreaterThanOrEqual(0.75);
  });

  test('SPR-010 renders off-scale glyph "↑ 168m"', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const chart = page.locator(TIME_CHART_SELECTOR);
    await expect(chart).toBeVisible();

    const spr010Group = chart.locator('g.bar-group[data-sprint-id="SPR-010"]');
    await expect(spr010Group).toBeVisible();

    const offscale = spr010Group.locator('text.offscale-glyph');
    await expect(offscale).toBeVisible();

    const txt = (await offscale.textContent())?.trim() ?? '';
    console.log(`[S112-B5] SPR-010 offscale-glyph text="${txt}"`);
    expect(txt).toMatch(/↑\s*168m/);
  });

  test('SPR-010 contains both off-scale glyph AND overrun glyph', async ({ page }) => {
    await page.goto('/how-it-was-built');
    const chart = page.locator(TIME_CHART_SELECTOR);
    const spr010Group = chart.locator('g.bar-group[data-sprint-id="SPR-010"]');

    const offscaleCount = await spr010Group.locator('text.offscale-glyph').count();
    const overrunCount = await spr010Group.locator('text.overrun-glyph').count();

    console.log(`[S112-B6] SPR-010 offscale-count=${offscaleCount} overrun-count=${overrunCount}`);

    expect(offscaleCount, 'SPR-010 must have off-scale glyph').toBeGreaterThanOrEqual(1);
    expect(overrunCount, 'SPR-010 must still have overrun glyph (ratio 2.8× > 1.5×)').toBeGreaterThanOrEqual(1);
  });
});
