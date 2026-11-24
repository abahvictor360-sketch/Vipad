import { test, expect } from '@playwright/test';
import { openApp, docInfo, generateTone } from './helpers';

test.describe('menu bar & Window menu', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await openApp(page);
  });

  test('desktop menu bar has a Window menu that switches files and layout', async ({ page }) => {
    await generateTone(page, 1);
    await page.evaluate(() => (window as any).__vipad.getState().newDoc('Second', { sampleRate: 48000, channels: [new Float32Array(4800)] }));
    await expect(page.getByRole('menubar')).toBeVisible();
    await page.getByTestId('mb-Window').click();
    const menu = page.getByRole('menu', { name: 'Window' });
    await expect(menu).toContainText('Next File');
    await expect(menu).toContainText('1. Tone');
    await expect(menu).toContainText('2. Second');
    await page.getByTestId('mb-win-file-0').click();
    expect((await docInfo(page))!.name).toBe('Tone');
    // keyboard: next file
    await page.keyboard.press('Control+Alt+ArrowRight');
    expect((await docInfo(page))!.name).toBe('Second');
    // hide the toolbar, then switch to the multitrack mixer
    await page.getByTestId('mb-Window').click();
    await page.getByTestId('mb-win-toolbar').click();
    await expect(page.locator('.app-header .ribbon')).toHaveCount(0);
    await page.getByTestId('mb-Window').click();
    await page.getByTestId('mb-win-multitrack').click();
    await expect(page.getByTestId('multitrack')).toBeVisible();
    // hover moves between open menus, Escape closes
    await page.getByTestId('mb-File').click();
    await page.getByTestId('mb-Help').hover();
    await expect(page.getByRole('menu', { name: 'Help' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('Help → Create Shortcut explains how to install when the browser cannot prompt', async ({ page }) => {
    await page.getByTestId('mb-Help').click();
    await page.getByTestId('mb-menu-shortcut').click();
    await expect(page.getByRole('dialog')).toContainText('Create a shortcut');
  });

  test('icon quick actions open the right place', async ({ page }) => {
    await page.goto('/app.html?e2e&action=multitrack');
    await expect(page.getByTestId('multitrack')).toBeVisible();
    await expect(page).not.toHaveURL(/action=/);
    await page.goto('/app.html?e2e&action=library');
    await expect(page.getByRole('dialog')).toContainText('Library');
    await page.goto('/app.html?e2e&action=record');
    await expect(page.getByTestId('rec-start')).toBeVisible();
  });

  test('manifest lists app-icon shortcuts', async ({ page, request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m.shortcuts.map((s: { short_name: string }) => s.short_name)).toEqual(['Record', 'Multitrack', 'Library']);
    for (const s of m.shortcuts) expect((await request.get(`/${s.icons[0].src}`)).status()).toBe(200);
  });
});

test.describe('update notifications', () => {
  test('installed app shows a banner when GitHub has a newer release, and remembers dismissal', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    });
    await page.route('https://api.github.com/repos/abahvictor360-sketch/Vipad/releases/latest', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://github.com/abahvictor360-sketch/Vipad/releases/tag/v9.9.9', published_at: '2026-12-01T00:00:00Z', body: 'New stuff' }) }),
    );
    await page.clock.install();
    await openApp(page);
    await page.clock.fastForward(6000);
    const banner = page.getByTestId('update-banner');
    await expect(banner).toContainText('Vipad 9.9.9 is available');
    await expect(page.getByTestId('update-download')).toHaveAttribute('href', /releases\/latest\/download\/Vipad-android\.apk$/);
    await banner.getByRole('button', { name: 'Skip this version' }).click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__vipadSettings.getState().dismissedUpdate)).toBe('9.9.9');
    // manual check still shows it
    await page.keyboard.press('Control+,');
    await page.getByTestId('check-updates').click();
    await expect(page.getByTestId('update-banner')).toBeVisible();
  });

  test('installed app on the latest version says it is up to date', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    });
    await page.route('https://api.github.com/repos/abahvictor360-sketch/Vipad/releases/latest', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.0.1' }) }),
    );
    await openApp(page);
    await page.getByTestId('mb-Help').click();
    await page.getByTestId('mb-menu-check-updates').click();
    await expect(page.locator('.toast-success').last()).toContainText('up to date');
  });

  test('web app offers "Update now" when a new version has been downloaded', async ({ page }) => {
    await openApp(page);
    // drive the store the service worker callback uses
    await page.evaluate(() => {
      (window as any).__updated = false;
      (window as any).__vipadUpdates.setState({ swReady: true, applySw: () => ((window as any).__updated = true) });
    });
    await expect(page.getByTestId('update-banner')).toContainText('new version of Vipad is ready');
    await page.getByTestId('update-now').click();
    expect(await page.evaluate(() => (window as any).__updated)).toBe(true);
  });
});
