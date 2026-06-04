import { test as base, type Page } from '@playwright/test';

export const statCard = (page: Page) => page.locator('.stat-card');
export const quotaCard = (page: Page) => page.locator('.quota-card');
export const sprintBurnup = (page: Page) => page.locator('.sprint-burnup');

export { expect } from '@playwright/test';
export const test = base;
