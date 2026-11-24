import { test, expect, Page } from '@playwright/test';
import { openApp, docInfo, generateTone, makeWav, dragSelect } from './helpers';
import { readFileSync } from 'node:fs';

const mtInfo = (page: Page) =>
  page.evaluate(() => {
    const st = (window as any).__vipadMT.getState();
    const mix = st.mix();
    let peak = 0;
    for (const c of mix.channels) for (let i = 0; i < c.length; i += 11) peak = Math.max(peak, Math.abs(c[i]));
    return {
      tracks: st.session.tracks.map((t: any) => ({ name: t.name, clips: t.clips.length, mute: t.mute, solo: t.solo })),
      length: mix.channels[0].length,
      sampleRate: st.session.sampleRate,
      peak,
    };
  });

test.describe('multitrack', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await openApp(page);
  });

  test('turns on and off, layers tracks, mute/solo, split and mixdown', async ({ page }) => {
    await generateTone(page, 2);
    await page.getByTestId('multitrack-toggle').check();
    await expect(page.getByTestId('multitrack')).toBeVisible();
    await page.getByTestId('mt-add-doc').click();
    await page.getByTestId('mt-file-input').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: makeWav(3, 22050) });
    await expect.poll(async () => (await mtInfo(page)).tracks.length).toBe(2);
    let info = await mtInfo(page);
    expect(info.tracks.map((t) => t.name)).toEqual(['Tone', 'voice']);
    expect(info.length / info.sampleRate).toBeCloseTo(3, 1);
    const fullPeak = info.peak;

    // mute track 1 → mix gets quieter; solo track 1 → only it plays
    await page.getByTestId('mute-0').click();
    info = await mtInfo(page);
    expect(info.tracks[0].mute).toBe(true);
    expect(info.peak).toBeLessThan(fullPeak);
    await page.getByTestId('mute-0').click();
    await page.getByTestId('solo-1').click();
    expect((await mtInfo(page)).tracks[1].solo).toBe(true);
    await page.getByTestId('solo-1').click();

    // play the mix
    await page.getByTestId('play').click();
    await page.waitForTimeout(400);
    expect(await page.getByTestId('clock').textContent()).not.toBe('00:00.000');
    await page.keyboard.press(' ');

    // split clip at cursor (cursor is inside after playing)
    await page.evaluate(() => (window as any).__vipadMT.getState().setCursor(48000));
    await page.locator('[data-testid^="lane-"]').first().click({ position: { x: 10, y: 40 } });
    await page.evaluate(() => (window as any).__vipadMT.getState().setCursor(48000));
    await page.getByTestId('mt-split').click();
    expect((await mtInfo(page)).tracks[0].clips).toBe(2);
    await page.keyboard.press('Control+z');
    expect((await mtInfo(page)).tracks[0].clips).toBe(1);

    // mixdown → new file in editor, multitrack switched off
    await page.getByTestId('mt-mixdown').click();
    await expect(page.getByTestId('waveform')).toBeVisible();
    const d = (await docInfo(page))!;
    expect(d.name).toBe('Mixdown');
    expect(d.channels).toBe(2);
    expect(d.length / d.sampleRate).toBeCloseTo(3, 1);
    // session is kept when toggling back on
    await page.getByTestId('multitrack-toggle').check();
    expect((await mtInfo(page)).tracks.length).toBe(2);
  });

  test('clicking a clip selects it without moving it to another track', async ({ page }) => {
    await page.getByTestId('multitrack-toggle').check();
    await page.getByTestId('mt-file-input').setInputFiles([
      { name: 'A.wav', mimeType: 'audio/wav', buffer: makeWav(1) },
      { name: 'B.wav', mimeType: 'audio/wav', buffer: makeWav(1) },
    ]);
    await expect.poll(async () => (await mtInfo(page)).tracks.length).toBe(2);
    await page.locator('[data-testid^="lane-"]').nth(1).click({ position: { x: 20, y: 40 } });
    expect((await mtInfo(page)).tracks.map((t) => t.clips)).toEqual([1, 1]);
  });

  test('drags a clip later in time', async ({ page }) => {
    await page.getByTestId('multitrack-toggle').check();
    await page.getByTestId('mt-file-input').setInputFiles({ name: 'a.wav', mimeType: 'audio/wav', buffer: makeWav(1) });
    const lane = page.locator('[data-testid^="lane-"]').first();
    const box = (await lane.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 40, { steps: 6 });
    await page.mouse.up();
    const start = await page.evaluate(() => (window as any).__vipadMT.getState().session.tracks[0].clips[0].start);
    expect(start).toBeGreaterThan(0);
  });

  test('records a new track with the fake microphone', async ({ page }) => {
    await page.getByTestId('multitrack-toggle').check();
    await page.getByTestId('mt-record').click();
    await expect(page.getByTestId('live-recording')).toBeVisible();
    await page.waitForTimeout(1200);
    await page.getByTestId('tp-stop').click();
    await expect.poll(async () => (await mtInfo(page)).tracks.length).toBe(1);
    const info = await mtInfo(page);
    expect(info.tracks[0].name).toMatch(/Recording/);
    expect(info.length / info.sampleRate).toBeGreaterThan(0.9);
  });

  test('multitrack setting persists across reloads', async ({ page }) => {
    await page.getByTestId('multitrack-toggle').check();
    await page.reload();
    await expect(page.getByTestId('multitrack')).toBeVisible();
    await page.getByTestId('multitrack-toggle').uncheck();
    await expect(page.getByTestId('multitrack')).toHaveCount(0);
  });
});

test.describe('main menu & restoration', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await openApp(page);
  });

  test('grab noise sample, then apply subtraction from it via the ☰ menu', async ({ page }) => {
    await page.getByTestId('empty-generate').click();
    await page.getByLabel('Waveform').selectOption('sine');
    await page.getByTestId('generate-insert').click();
    await dragSelect(page, 0.1, 0.3);
    await page.getByTestId('main-menu').click();
    await page.getByTestId('mm-Restore').click();
    await expect(page.getByTestId('menu-apply-noise')).toBeDisabled();
    await page.getByTestId('menu-grab-noise').click();
    await expect(page.locator('.toast-success').last()).toContainText('Noise sample captured');
    await page.getByTestId('main-menu').click();
    await page.getByTestId('mm-Restore').click();
    await page.getByTestId('menu-apply-noise').click();
    await page.getByTestId('effect-apply').click();
    await expect(page.locator('.toast-success').last()).toContainText('Noise Reduction (from Sample) applied');
    await page.getByTestId('main-menu').click();
    await page.getByTestId('mm-Restore').click();
    await page.getByTestId('menu-mbgate').click();
    await page.getByTestId('effect-apply').click();
    await expect(page.locator('.toast-success').last()).toContainText('Multi-band Noise Gate applied');
  });

  test('settings dialog changes export defaults', async ({ page }) => {
    await generateTone(page, 1);
    await page.getByTestId('main-menu').click();
    await page.getByTestId('mm-Tools').click();
    await page.getByTestId('menu-settings').click();
    await page.getByLabel('Format').selectOption('wav');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('export').click();
    await expect(page.getByTestId('fmt-wav')).toHaveAttribute('aria-checked', 'true');
  });

  test('saves and re-opens a project file with tracks', async ({ page }) => {
    await generateTone(page, 1);
    await page.getByTestId('multitrack-toggle').check();
    await page.getByTestId('mt-add-doc').click();
    await page.getByTestId('main-menu').click();
    await page.getByTestId('mm-File').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Save Project/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.vipad$/);
    const bytes = readFileSync((await dl.path())!);
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipadMT);
    await page.getByTestId('project-input').setInputFiles({ name: 'p.vipad', mimeType: 'application/json', buffer: bytes });
    await expect.poll(async () => (await mtInfo(page)).tracks.length).toBe(1);
    await expect(page.getByTestId('multitrack')).toBeVisible();
  });
});
