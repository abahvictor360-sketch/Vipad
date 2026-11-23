import { test, expect } from '@playwright/test';

test.describe('landing page', () => {
  test('renders hero, sections and working download links', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page).toHaveTitle(/Vipad/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Record, edit');
    for (const id of ['about', 'features', 'how', 'download', 'faq']) await expect(page.locator(`#${id}`)).toBeAttached();
    const assets = await page.locator('[data-asset]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    expect(assets.length).toBeGreaterThanOrEqual(5);
    for (const href of assets) expect(href).toMatch(/^https:\/\/github\.com\/abahvictor360-sketch\/Vipad\/releases\/latest\/download\/Vipad-/);
    await expect(page.locator('.dl.recommended')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('"Open in browser" launches the editor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Open in browser/ }).click();
    await expect(page).toHaveURL(/app\.html/);
    await expect(page.getByText('Record, edit & perfect your audio.')).toBeVisible();
  });

  test('FAQ expands', async ({ page }) => {
    await page.goto('/');
    const q = page.locator('.faq summary').first();
    await q.click();
    await expect(page.locator('.faq details').first()).toHaveAttribute('open', '');
  });
});
