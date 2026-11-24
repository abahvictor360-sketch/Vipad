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
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
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

test('tablet sizes: nothing spills off-screen, toolbar sections stay readable, transport stays compact', async ({ page }) => {
  test.setTimeout(90_000);
  for (const [w, h] of [[768, 1024], [810, 1080], [1024, 768], [1080, 810], [1194, 834], [1366, 1024]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/app.html?e2e');
    await page.waitForFunction(() => (window as any).__vipad);
    // the first pass creates a file; later reloads restore it from autosave
    await page.waitForSelector('[data-testid=waveform], [data-testid=empty-generate]');
    if (await page.getByTestId('empty-generate').isVisible()) {
      await page.getByTestId('empty-generate').click();
      await page.getByTestId('generate-insert').click();
    }
    await page.waitForSelector('[data-testid=waveform]');
    const r = await page.evaluate(() => {
      const t = document.querySelector('.transport')!.getBoundingClientRect();
      const kids = [...document.querySelectorAll('.transport *')].map((e) => e.getBoundingClientRect().right);
      const tabs = [...document.querySelectorAll('.topbar .tabs button')].map((b) => b.getBoundingClientRect());
      const tabsBox = document.querySelector('.topbar .tabs')!.getBoundingClientRect();
      return { over: Math.max(...kids) - innerWidth, tH: t.height, tabsCut: tabs.some((b) => b.right > tabsBox.right + 1), page: document.documentElement.scrollWidth - innerWidth };
    });
    expect(r.page, `${w}x${h} page`).toBeLessThanOrEqual(0);
    expect(r.over, `${w}x${h} transport`).toBeLessThanOrEqual(1);
    expect(r.tabsCut, `${w}x${h} toolbar tabs`).toBe(false);
    expect(r.tH, `${w}x${h} transport height`).toBeLessThan(170);
    // multitrack keeps the transport compact too
    await page.getByTestId('multitrack-toggle').click();
    const mtH = await page.evaluate(() => document.querySelector('.transport')!.getBoundingClientRect().height);
    expect(mtH, `${w}x${h} multitrack transport`).toBeLessThan(170);
    await page.getByTestId('multitrack-toggle').click();
  }
});
