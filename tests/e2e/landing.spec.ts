import { test, expect } from '@playwright/test';

test.describe('landing page', () => {
  test('renders hero, sections and working download links', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page).toHaveTitle(/Vipad/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Record, edit');
    for (const id of ['about', 'features', 'how', 'download', 'faq']) await expect(page.locator(`#${id}`)).toBeAttached();
    await expect(page.locator('#hero-download')).toHaveAttribute('href', /download\.html#/);
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

test.describe('download page', () => {
  test('shows a card per platform with release download links and highlights your system', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/download.html?os=linux');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Download Vipad');
    await expect(page.locator('.d-pill')).toContainText(/free forever/i);
    await expect(page.locator('.os-card')).toHaveCount(6);
    await expect(page.locator('.os-card.yours')).toHaveAttribute('data-os', 'linux');
    await expect(page.locator('.your-system')).toHaveText(/your system/i);
    const assets = await page.locator('[data-asset]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    for (const f of ['Vipad-Setup-x64.exe', 'Vipad-mac-universal.dmg', 'Vipad-linux-x86_64.AppImage', 'Vipad-linux-amd64.deb', 'Vipad-android.apk', 'Vipad-ios-unsigned.ipa']) {
      expect(assets).toContain(`https://github.com/abahvictor360-sketch/Vipad/releases/latest/download/${f}`);
    }
    await page.locator('.step-card summary').first().click();
    await expect(page.locator('.step-card').first()).toHaveAttribute('open', '');
    expect(errors).toEqual([]);
  });
});

test.describe('guide page', () => {
  test('has a table of contents and every screenshot loads', async ({ page }) => {
    await page.goto('/guide.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to use Vipad');
    const steps = page.locator('.guide-step');
    expect(await steps.count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator('.g-toc a[href^="#"]')).toHaveCount(await steps.count());
    const imgs = page.locator('.g-shot img');
    for (let i = 0; i < (await imgs.count()); i++) {
      const img = imgs.nth(i);
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(300);
    }
  });
});
