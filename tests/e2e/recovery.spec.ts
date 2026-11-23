import { test, expect } from '@playwright/test';
import { openApp, docInfo, generateTone } from './helpers';

const waitSaved = (page: import('@playwright/test').Page) =>
  expect(page.getByTestId('autosave')).toHaveAttribute('data-status', 'saved', { timeout: 10_000 });

test.describe('autosave & recovery', () => {
  test('edits survive an accidental reload / close', async ({ page }) => {
    await openApp(page);
    await generateTone(page, 2);
    await page.getByTestId('select-all').click();
    await page.getByTestId('fx-amplify').click();
    await page.getByLabel('Gain value').fill('-12');
    await page.getByTestId('effect-apply').click();
    await expect(page.locator('.toast-success').last()).toContainText('Amplify applied');
    const before = (await docInfo(page))!;
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipad);
    await expect.poll(async () => (await docInfo(page))?.name).toBe('Tone');
    const after = (await docInfo(page))!;
    expect(after.length).toBe(before.length);
    expect(after.peak).toBeCloseTo(before.peak, 3);
    await expect(page.locator('.toast-success').last()).toContainText('Restored');
  });

  test('a recording interrupted mid-take is recovered after the app closes', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('empty-record').click();
    await page.getByTestId('rec-start').click();
    await page.waitForTimeout(4500); // > two autosave flushes
    // simulate a crash: reload without pressing Stop
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipad);
    await expect.poll(async () => (await docInfo(page))?.name ?? '', { timeout: 10_000 }).toMatch(/recovered/);
    const d = (await docInfo(page))!;
    expect(d.length / d.sampleRate).toBeGreaterThan(2);
    expect(d.peak).toBeGreaterThan(0.01);
    await expect(page.locator('.toast-success').last()).toContainText('Recovered');
  });

  test('closed files can be restored from Recently closed', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openApp(page);
    await generateTone(page, 1);
    await waitSaved(page);
    await page.locator('.doc-tab-x').first().click();
    await expect(page.getByTestId('empty-record')).toBeVisible();
    await waitSaved(page);
    await page.getByRole('button', { name: 'Open from library' }).click();
    const section = page.getByTestId('recently-closed');
    await expect(section).toContainText('Tone');
    await section.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(async () => (await docInfo(page))?.name).toBe('Tone');
    // restored file is open again after a reload, and no longer listed as closed
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipad);
    await expect.poll(async () => (await docInfo(page))?.name).toBe('Tone');
  });

  test('the multitrack session is restored after reload', async ({ page }) => {
    await openApp(page);
    await generateTone(page, 1);
    await page.getByTestId('multitrack-toggle').check();
    await page.getByTestId('mt-add-doc').click();
    await page.getByTestId('mt-add-track').click();
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipadMT);
    await expect.poll(() => page.evaluate(() => (window as any).__vipadMT.getState().session.tracks.length)).toBe(2);
  });
});
