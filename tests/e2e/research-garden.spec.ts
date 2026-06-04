import { test, expect } from '@playwright/test';

const URL = '/research/garden';

// These counts must match public.json research.garden node states.
const VALIDATED = 13;
const WATCHING  = 5;
const AVAILABLE = 5;
const LOCKED    = 1;
// Total edges = Σ of all nodes' requires arrays (28)
const EDGE_COUNT = 28;

test.describe('research garden', () => {
  test('page renders with correct title path', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('.mast-title')).toBeVisible();
    const title = await page.locator('.mast-title').textContent();
    expect(title).toContain('/research/garden');
  });

  test('node-state counts match data', async ({ page }) => {
    await page.goto(URL);
    // On desktop the SVG is visible; on mobile the mobile-node divs are shown.
    // Check both SVG nodes (desktop) and mobile nodes (mobile project).
    const vp = page.viewportSize();
    if (vp && vp.width >= 880) {
      // SVG classes
      await expect(page.locator('#garden .n-validated')).toHaveCount(VALIDATED);
      await expect(page.locator('#garden .n-watching')).toHaveCount(WATCHING);
      await expect(page.locator('#garden .n-available')).toHaveCount(AVAILABLE);
      await expect(page.locator('#garden .n-locked')).toHaveCount(LOCKED);
    } else {
      // Mobile node classes
      await expect(page.locator('.mn-validated')).toHaveCount(VALIDATED);
      await expect(page.locator('.mn-watching')).toHaveCount(WATCHING);
      await expect(page.locator('.mn-available')).toHaveCount(AVAILABLE);
      await expect(page.locator('.mn-locked')).toHaveCount(LOCKED);
    }
  });

  test('edge count equals sum of all requires', async ({ page }) => {
    await page.goto(URL);
    const vp = page.viewportSize();
    if (vp && vp.width >= 880) {
      await expect(page.locator('#garden .edge')).toHaveCount(EDGE_COUNT);
    } else {
      // On mobile, edges are not rendered as SVG paths — skip SVG count check
      // but verify total node count = VALIDATED + WATCHING + AVAILABLE + LOCKED
      const total = VALIDATED + WATCHING + AVAILABLE + LOCKED;
      const allNodes = page.locator('.mobile-node');
      await expect(allNodes).toHaveCount(total);
    }
  });

  test('click-to-focus dims non-connected nodes', async ({ page }) => {
    await page.goto(URL);
    const vp = page.viewportSize();
    if (!vp || vp.width < 880) {
      test.skip(); // click-to-focus is SVG-only; skip on mobile
      return;
    }
    // Click node E1 (root — has no requires but many dependents)
    const e1 = page.locator('#garden [data-id="E1"]');
    await e1.click();
    // SVG should have the focusing class
    await expect(page.locator('#garden')).toHaveClass(/focusing/);
    // E1 itself must be lit
    await expect(e1).toHaveClass(/lit/);
    // A node NOT in E1's chain (e.g. C1, which has no requires and is not a prereq of E1's descendants)
    // should NOT have lit class — C1 is an isolated root unrelated to E1's subtree
    const c1 = page.locator('#garden [data-id="C1"]');
    const c1Lit = await c1.getAttribute('class');
    expect(c1Lit).not.toContain('lit');
    // Click background to reset
    await page.locator('#garden').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#garden')).not.toHaveClass(/focusing/);
  });

  test('responsive: SVG hidden and mobile tiers shown below 880px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(URL);
    const sceneSvg = page.locator('.scene-svg');
    const mobileTiers = page.locator('.mobile-tiers');
    // scene-svg should be hidden (display:none via CSS)
    await expect(sceneSvg).toBeHidden();
    // mobile-tiers should be visible
    await expect(mobileTiers).toBeVisible();
    // No horizontal overflow
    const overflow = await page.evaluate(() => {
      const body = document.body;
      return body.scrollWidth > body.clientWidth;
    });
    expect(overflow).toBe(false);
  });

  test('nav link to /research/garden is present', async ({ page }) => {
    await page.goto('/');
    const navLink = page.locator('a[href="/research/garden"]');
    await expect(navLink).toBeVisible();
    await expect(navLink).toContainText('garden');
  });
});
