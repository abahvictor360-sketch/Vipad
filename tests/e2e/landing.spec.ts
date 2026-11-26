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
    await expect(page.locator('.footer')).toContainText('Developed by Victor Abah');
    expect(errors).toEqual([]);
  });

  test('"Open in browser" launches the editor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Open in browser/ }).click();
    await expect(page).toHaveURL(/app\.html/);
    await expect(page.getByText('Record, edit & perfect your audio.')).toBeVisible();
    await expect(page.getByTestId('empty-credit')).toHaveText('Developed by Victor Abah');
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

test('download buttons resolve to the exact release files and show sizes', async ({ page }) => {
  await page.route('https://api.github.com/repos/abahvictor360-sketch/Vipad/releases/latest', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: 'v1.0.0',
        published_at: '2026-11-23T20:14:35Z',
        assets: [{ name: 'Vipad-android.apk', size: 5 * 1048576, browser_download_url: 'https://github.com/abahvictor360-sketch/Vipad/releases/download/v1.0.0/Vipad-android.apk' }],
      }),
    }),
  );
  await page.goto('/download.html?os=android');
  const btn = page.locator('.os-card[data-os="android"] .dl-btn');
  await expect(btn).toHaveAttribute('href', 'https://github.com/abahvictor360-sketch/Vipad/releases/download/v1.0.0/Vipad-android.apk');
  await expect(page.locator('.os-card[data-os="android"] .dl-cap')).toContainText('5.0 MB');
  await expect(page.locator('#d-date')).toContainText('2026');
  // assets missing from the API response keep the always-valid "latest" link
  await expect(page.locator('.os-card[data-os="windows"] .dl-btn')).toHaveAttribute('href', /releases\/latest\/download\/Vipad-Setup-x64\.exe$/);
});

test('custom 404 page offers a way to the downloads', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('went silent');
  await expect(page.getByRole('link', { name: 'Go to downloads' })).toHaveAttribute('href', '/download');
});
