import { test, expect } from '@playwright/test';
import { openApp, docInfo, generateTone } from './helpers';

test('mobile/tablet: editor works and has no horizontal overflow', async ({ page }) => {
  await openApp(page);
  await generateTone(page, 2);
  expect((await docInfo(page))!.length).toBeGreaterThan(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.getByTestId('play').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('mobile/tablet: landing has no horizontal overflow and menu works', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('#mobile-menu')).toBeVisible();
  }
});
