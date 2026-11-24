import { test, expect } from '@playwright/test';
import { openApp, docInfo, generateTone, dragSelect, makeWav } from './helpers';
import { readFileSync } from 'node:fs';

test.describe('editor', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await openApp(page);
  });

  test('generates a tone and shows correct duration', async ({ page }) => {
    await generateTone(page, 3);
    const d = (await docInfo(page))!;
    expect(d.length / d.sampleRate).toBeCloseTo(3, 2);
    await expect(page.getByTestId('clock')).toBeVisible();
    await expect(page.locator('.clock-sub')).toContainText('00:03.000');
  });

  test('drag-selects, cuts, pastes, undoes and redoes', async ({ page }) => {
    await generateTone(page, 4);
    const before = (await docInfo(page))!;
    await dragSelect(page, 0.25, 0.5);
    const sel = (await docInfo(page))!.selection!;
    expect(sel.end - sel.start).toBeGreaterThan(before.length * 0.2);
    await page.getByTestId('cut').click();
    const afterCut = (await docInfo(page))!;
    expect(afterCut.length).toBe(before.length - (sel.end - sel.start));
    await page.getByTestId('paste').click();
    expect((await docInfo(page))!.length).toBe(before.length);
    await page.getByTestId('undo').click();
    expect((await docInfo(page))!.length).toBe(afterCut.length);
    await page.getByTestId('undo').click();
    expect((await docInfo(page))!.length).toBe(before.length);
    await page.getByTestId('redo').click();
    expect((await docInfo(page))!.length).toBe(afterCut.length);
  });

  test('trim keeps only the selection; delete removes it', async ({ page }) => {
    await generateTone(page, 4);
    await page.getByTestId('sel-start').fill('1');
    await page.getByTestId('sel-start').press('Enter');
    await page.getByTestId('sel-end').fill('2.5');
    await page.getByTestId('sel-end').press('Enter');
    const d = (await docInfo(page))!;
    expect(d.selection).toEqual({ start: d.sampleRate, end: d.sampleRate * 2.5 });
    await page.getByTestId('trim').click();
    expect((await docInfo(page))!.length).toBe(d.sampleRate * 1.5);
    await page.getByTestId('select-all').click();
    await page.keyboard.press('Delete');
    expect((await docInfo(page))!.length).toBe(0);
  });

  test('applies effects through dialogs (amplify, normalize, reverse, EQ)', async ({ page }) => {
    await generateTone(page, 2);
    const p0 = (await docInfo(page))!.peak;
    await page.getByTestId('fx-amplify').click();
    await page.getByLabel('Gain value').fill('-6');
    await page.getByTestId('effect-apply').click();
    await expect.poll(async () => (await docInfo(page))!.peak).toBeLessThan(p0 * 0.6);
    await page.getByTestId('fx-normalize').click();
    await page.getByTestId('effect-apply').click();
    await expect.poll(async () => (await docInfo(page))!.peak).toBeGreaterThan(0.85);
    await page.getByTestId('tab-effects').click();
    await page.getByTestId('fx-reverse').click();
    await page.getByTestId('effect-apply').click();
    await page.getByTestId('fx-eq').click();
    await page.getByLabel('1k Hz band').fill('6');
    await page.getByTestId('effect-apply').click();
    await expect(page.locator('.toast-success').last()).toContainText('Graphic Equalizer applied');
    expect((await docInfo(page))!.canUndo).toBe(true);
  });

  test('every effect in the side panel applies without errors', async ({ page }) => {
    test.setTimeout(120_000);
    await generateTone(page, 1);
    const ids = await page.locator('[data-testid^="sb-fx-"]:not([disabled])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
    expect(ids.length).toBeGreaterThan(25);
    for (const id of ids) {
      await page.getByTestId(id).click();
      await page.getByTestId('effect-apply').click();
      await expect(page.getByTestId('busy')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.locator('.toast-error')).toHaveCount(0);
      // keep the file short: undo between effects
      await page.keyboard.press('Control+z');
    }
  });

  test('plays audio and advances the clock; space toggles', async ({ page }) => {
    await generateTone(page, 3);
    await page.getByTestId('play').click();
    await page.waitForTimeout(600);
    const t = await page.getByTestId('clock').textContent();
    expect(t).not.toBe('00:00.000');
    await page.keyboard.press(' ');
    const paused = (await docInfo(page))!.cursor;
    expect(paused).toBeGreaterThan(0);
  });

  test('exports WAV and MP3 files', async ({ page }) => {
    await generateTone(page, 1);
    await page.getByTestId('export').click();
    await page.getByTestId('fmt-wav').click();
    await page.getByTestId('export-name').fill('my-tone');
    const [wav] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-confirm').click()]);
    expect(wav.suggestedFilename()).toBe('my-tone.wav');
    const wbytes = readFileSync((await wav.path())!);
    expect(wbytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(wbytes.length).toBeGreaterThan(48000 * 2 * 2);

    await page.getByTestId('export').click();
    await page.getByTestId('fmt-mp3').click();
    const [mp3] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-confirm').click()]);
    expect(mp3.suggestedFilename()).toMatch(/\.mp3$/);
    const mbytes = readFileSync((await mp3.path())!);
    expect(mbytes.length).toBeGreaterThan(10_000);
  });

  test('opens audio files via the file picker', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: makeWav(1.5, 22050) });
    await expect.poll(async () => (await docInfo(page))?.name).toBe('voice');
    const d = (await docInfo(page))!;
    expect(d.sampleRate).toBe(22050);
    expect(d.length).toBe(Math.round(1.5 * 22050));
  });

  test('records from the microphone (fake device), with pause/resume', async ({ page }) => {
    await page.getByTestId('empty-record').click();
    await expect(page.getByTestId('live-recording')).toBeVisible();
    await expect(page.getByTestId('rec-time')).toBeVisible();
    await page.waitForTimeout(1200);
    await page.getByTestId('rec-pause').click();
    await page.waitForTimeout(400);
    await page.getByTestId('rec-pause').click();
    await page.waitForTimeout(600);
    await page.getByTestId('rec-stop').click();
    await expect.poll(async () => (await docInfo(page))?.name ?? '').toMatch(/^Recording/);
    const d = (await docInfo(page))!;
    const secs = d.length / d.sampleRate;
    expect(secs).toBeGreaterThan(1.2);
    expect(secs).toBeLessThan(3);
    expect(d.peak).toBeGreaterThan(0.01); // fake device produces a beep tone
  });

  test('saves to the library and reopens', async ({ page }) => {
    await generateTone(page, 1);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast-success').last()).toContainText('library');
    await page.getByTestId('tab-tools').click();
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.locator('.lib-list li')).toHaveCount(1);
    await page.locator('.lib-list').getByRole('button', { name: 'Open' }).click();
    await expect.poll(async () => (await docInfo(page))?.name).toBe('Tone');
  });

  test('keyboard shortcuts: select all, copy, paste, undo', async ({ page }) => {
    await generateTone(page, 1);
    const n = (await docInfo(page))!.length;
    await page.getByTestId('waveform').click({ position: { x: 5, y: 50 } });
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+v');
    expect((await docInfo(page))!.length).toBe(n * 2);
    await page.keyboard.press('Control+z');
    expect((await docInfo(page))!.length).toBe(n);
  });
});

test.describe('export channels & sample rate', () => {
  const header = (b: Buffer) => ({ channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34) });

  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await generateTone(page, 1);
  });

  test('saves mono WAV at 225 kHz (maximum)', async ({ page }) => {
    await page.getByTestId('export').click();
    await page.getByTestId('fmt-wav').click();
    await page.getByTestId('ch-mono').click();
    await page.getByTestId('export-rate').selectOption('225000');
    await expect(page.locator('.modal-head p')).toContainText('Mono · 225 kHz');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-confirm').click()]);
    const h = header(readFileSync((await dl.path())!));
    expect(h).toEqual({ channels: 1, rate: 225000, bits: 16 });
  });

  test('saves stereo WAV at a custom 10 kHz rate, rejects out-of-range values', async ({ page }) => {
    await page.getByTestId('export').click();
    await page.getByTestId('fmt-wav').click();
    await page.getByTestId('ch-stereo').click();
    await page.getByTestId('export-rate').selectOption('custom');
    const input = page.getByTestId('export-rate-custom');
    await input.fill('5000');
    await expect(page.getByRole('alert')).toContainText('10,000 to 225,000 Hz');
    await input.fill('300000');
    await expect(page.getByRole('alert')).toBeVisible();
    await input.fill('10000');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-confirm').click()]);
    const b = readFileSync((await dl.path())!);
    expect(header(b)).toEqual({ channels: 2, rate: 10000, bits: 16 });
    expect(b.length).toBe(44 + 10000 * 2 * 2);
  });

  test('explains the 48 kHz MP3 limit and switches to WAV', async ({ page }) => {
    await page.getByTestId('export').click();
    await page.getByTestId('fmt-mp3').click();
    await page.getByTestId('export-rate').selectOption('192000');
    await expect(page.getByTestId('mp3-rate-note')).toContainText('48 kHz');
    await page.getByTestId('mp3-rate-note').getByRole('button', { name: 'WAV' }).click();
    await expect(page.getByTestId('fmt-wav')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('mp3-rate-note')).toHaveCount(0);
  });
});
