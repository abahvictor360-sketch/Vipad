import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { openApp, docInfo, generateTone, dragSelect } from './helpers';

let hasFfprobe = false;
try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); hasFfprobe = true; } catch { /* optional */ }
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());

async function exportAs(page: Page, format: string, extra?: (p: Page) => Promise<void>) {
  await page.getByTestId('export').click();
  await page.getByTestId('export-format').selectOption(format);
  if (extra) await extra(page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByTestId('export-confirm').click()]);
  return { name: dl.suggestedFilename(), path: (await dl.path())! };
}

test.describe('export formats', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await openApp(page);
    await generateTone(page, 2);
  });

  const cases: [string, string, string, ((p: Page) => Promise<void>)?][] = [
    ['flac', 'flac', 'flac'],
    ['ogg', 'ogg', 'opus'],
    ['webm', 'webm', 'opus'],
    ['aiff', 'aiff', 'pcm_s16be'],
    ['au', 'au', 'pcm_s16be'],
    ['wav', 'wav', 'pcm_mulaw', async (p) => { await p.getByTestId('export-depth').selectOption('ulaw'); }],
    ['wav', 'wav', 'pcm_s24le', async (p) => { await p.getByTestId('export-depth').selectOption('24'); }],
    ['mp3', 'mp3', 'mp3'],
  ];
  for (const [fmt, ext, codec, extra] of cases) {
    test(`exports ${fmt.toUpperCase()} (${codec}) that ffprobe can read`, async ({ page }) => {
      const out = await exportAs(page, fmt, extra);
      expect(out.name).toBe(`Tone.${ext}`);
      test.skip(!hasFfprobe, 'ffprobe not installed');
      const p = probe(out.path);
      expect(p.streams[0].codec_name).toBe(codec);
      expect(Number(p.format.duration)).toBeGreaterThan(1.9);
      expect(Number(p.format.duration)).toBeLessThan(2.2);
    });
  }

  test('raw PCM has exactly samples × channels × bytes and no header', async ({ page }) => {
    const out = await exportAs(page, 'raw', async (p) => { await p.getByTestId('ch-mono').click(); });
    const { size } = await import('node:fs').then((fs) => fs.statSync(out.path));
    expect(size).toBe(48000 * 2 * 2); // 2 s mono 16-bit
  });

  test('metadata tags are written into MP3, FLAC and OGG', async ({ page }) => {
    test.skip(!hasFfprobe, 'ffprobe not installed');
    for (const fmt of ['mp3', 'flac', 'ogg']) {
      const out = await exportAs(page, fmt, async (p) => {
        await p.locator('.tags-box summary').click();
        await p.getByTestId('tag-title').fill(`My ${fmt} title`);
        await p.getByTestId('tag-artist').fill('Vipad Tester');
      });
      const tags = Object.fromEntries(Object.entries(probe(out.path).format.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const streamTags = Object.fromEntries(Object.entries(probe(out.path).streams[0].tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      expect(tags.title ?? streamTags.title).toBe(`My ${fmt} title`);
      expect(tags.artist ?? streamTags.artist).toBe('Vipad Tester');
    }
  });

  test('formats the device cannot encode are not offered; fixed-rate formats explain the limit', async ({ page }) => {
    await page.getByTestId('export').click();
    const options = await page.getByTestId('export-format').locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(options).toEqual(expect.arrayContaining(['mp3', 'wav', 'flac', 'aiff', 'ogg', 'webm', 'au', 'raw']));
    const aac = await page.evaluate(async () => (await (window as any).AudioEncoder?.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 128000 }))?.supported ?? false);
    expect(options.includes('m4a')).toBe(aac);
    await page.getByTestId('export-format').selectOption('ogg');
    await page.getByTestId('export-rate').selectOption('96000');
    await expect(page.getByTestId('mp3-rate-note')).toContainText('always uses 48 kHz');
  });
});

test.describe('professional editing features', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await openApp(page);
  });

  test('spectrogram view and amplitude zoom', async ({ page }) => {
    await generateTone(page, 2);
    await page.getByTestId('tab-view').click();
    await page.getByTestId('rb-spectrogram').click();
    expect(await page.evaluate(() => (window as any).__vipad.getState().active().view)).toBe('spectral');
    // the 440 Hz tone shows up as a bright horizontal line in the spectrogram canvas
    const bright = await page.getByTestId('waveform').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      const d = ctx.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i + 1]);
      return max;
    });
    expect(bright).toBeGreaterThan(200);
    await page.getByTestId('rb-spectrogram').click();
    await page.getByRole('button', { name: 'Amp +' }).click();
    expect(await page.evaluate(() => (window as any).__vipad.getState().ampZoom)).toBe(2);
  });

  test('analysis shows the dominant frequency, note and LUFS', async ({ page }) => {
    await generateTone(page, 3);
    await page.getByTestId('tab-tools').click();
    await page.getByTestId('rb-analysis').click();
    const f = parseFloat((await page.getByTestId('peak-freq').textContent())!);
    expect(Math.abs(f - 440)).toBeLessThan(2);
    await expect(page.getByTestId('analysis-stats')).toContainText('A4');
    await expect(page.getByTestId('lufs')).toContainText('LUFS');
  });

  test('loudness normalize reaches the chosen LUFS target', async ({ page }) => {
    await generateTone(page, 4);
    await page.getByTestId('tab-levels').click();
    await page.getByTestId('fx-loudnorm').click();
    await page.getByLabel('Target').selectOption('-16');
    await page.getByTestId('effect-apply').click();
    await expect(page.locator('.toast-success').last()).toContainText('Loudness Normalize');
    await page.locator('.sb-tabs button', { hasText: 'Info' }).click();
    const lufs = parseFloat((await page.getByTestId('info-lufs').textContent())!);
    expect(Math.abs(lufs + 16)).toBeLessThan(0.6);
  });

  test('split at cursor, split by silence, join and extract channel', async ({ page }) => {
    await generateTone(page, 3);
    await page.evaluate(() => {
      const st = (window as any).__vipad.getState();
      const d = st.active();
      for (const c of d.audio.channels) c.fill(0, 48000, 96000); // a 1 s pause in the middle
      st.setCursor(24000);
    });
    await page.getByTestId('tab-tools').click();
    await page.getByTestId('rb-split-cursor').click();
    await expect(page.locator('.doc-tab')).toHaveCount(3);
    await page.locator('.doc-tab-name', { hasText: /^Tone$/ }).click();
    await page.getByTestId('rb-split-silence').click();
    await expect(page.locator('.doc-tab')).toHaveCount(5);
    const names = await page.locator('.doc-tab-name').allTextContents();
    expect(names).toEqual(expect.arrayContaining(['Tone (1)', 'Tone (2)']));
    await page.getByTestId('rb-join').click();
    const joined = (await docInfo(page))!;
    expect(joined.name).toBe('Joined');
    await page.getByTestId('main-menu').click();
    await page.getByTestId('mm-Edit').click();
    await page.getByRole('menuitem', { name: 'Extract Left Channel' }).click();
    const left = (await docInfo(page))!;
    expect(left.name).toBe('Joined (Left)');
    expect(left.channels).toBe(1);
  });

  test('history panel jumps back and forward through edits', async ({ page }) => {
    await generateTone(page, 2);
    const n0 = (await docInfo(page))!.length;
    await dragSelect(page, 0.1, 0.3);
    await page.getByTestId('delete').click();
    await page.getByTestId('tab-effects').click();
    await page.getByTestId('fx-reverse').click();
    await page.getByTestId('effect-apply').click();
    await page.locator('.sb-tabs button', { hasText: 'History' }).click();
    await expect(page.getByTestId('history-list').locator('li')).toHaveCount(3);
    await page.getByTestId('hist-0').click();
    expect((await docInfo(page))!.length).toBe(n0);
    await expect(page.getByTestId('hist-0')).toHaveClass(/current/);
    await page.getByTestId('hist-2').click();
    expect((await docInfo(page))!.length).toBeLessThan(n0);
  });

  test('effect presets: built-in presets load and user presets persist', async ({ page }) => {
    await generateTone(page, 1);
    await page.getByTestId('tab-effects').click();
    await page.getByTestId('fx-eq').click();
    await page.getByTestId('preset-select').selectOption('b:Bass boost');
    await expect(page.getByLabel('31 Hz band')).toHaveValue('6');
    await page.getByLabel('1k Hz band').fill('5');
    page.once('dialog', (d) => d.accept('My EQ'));
    await page.getByTestId('preset-save').click();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipad);
    await expect.poll(async () => (await docInfo(page))?.name).toBe('Tone');
    await page.getByTestId('tab-effects').click();
    await page.getByTestId('fx-eq').click();
    await page.getByTestId('preset-select').selectOption('u:My EQ');
    await expect(page.getByLabel('1k Hz band')).toHaveValue('5');
  });

  test('snap to zero crossings puts selection edges on zero crossings', async ({ page }) => {
    await generateTone(page, 1);
    await page.evaluate(() => (window as any).__vipadSettings.getState().set({ snapToZero: true }));
    await page.getByTestId('tab-view').click();
    await page.getByRole('button', { name: 'Zoom In' }).first().click();
    await dragSelect(page, 0.2, 0.6);
    const ok = await page.evaluate(() => {
      const d = (window as any).__vipad.getState().active();
      const c = d.audio.channels[0];
      const zc = (i: number) => (c[i - 1] <= 0) !== (c[i] <= 0);
      return zc(d.selection.start) && zc(d.selection.end);
    });
    expect(ok).toBe(true);
  });

  test('recording countdown and sound-activated mode', async ({ page }) => {
    await page.evaluate(() => (window as any).__vipadSettings.getState().set({ recordCountdown: 3, soundActivated: true, soundThresholdDb: -40 }));
    await page.getByTestId('record').click();
    await expect(page.getByTestId('countdown')).toHaveText('3');
    await expect(page.getByTestId('countdown')).toHaveText('2');
    await expect(page.getByTestId('countdown')).toHaveCount(0, { timeout: 5000 });
    expect(await page.evaluate(() => (window as any).__vipadRec.getState().recorder.gateDb)).toBe(-40);
    await page.waitForTimeout(1500);
    await page.getByTestId('rec-stop').click();
    await expect(page.getByTestId('waveform').or(page.getByTestId('empty-record'))).toBeVisible();
  });
});
