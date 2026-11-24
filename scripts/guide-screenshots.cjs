// Regenerates the screenshots used by guide.html from the real app.
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/guide-screenshots.cjs
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUT = path.join(__dirname, '..', 'public', 'guide');
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

/** Speech/music-like test audio so waveforms look realistic. */
function wav(seconds, kind, sr = 22050) {
  const n = Math.round(seconds * sr);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v;
    if (kind === 'voice') {
      const syll = Math.max(0, Math.sin(t * 2 * Math.PI * 3.1)) * Math.max(0, Math.sin(t * 2 * Math.PI * 0.37 + 1));
      const f0 = 140 + 30 * Math.sin(t * 2.3);
      v = syll * (0.55 * Math.sin(2 * Math.PI * f0 * t) + 0.25 * Math.sin(4 * Math.PI * f0 * t) + 0.12 * rnd()) + 0.01 * rnd();
    } else if (kind === 'drums') {
      const beat = (t * 2) % 1;
      v = Math.exp(-beat * 18) * (0.8 * Math.sin(2 * Math.PI * 60 * t) + 0.4 * rnd()) + (((t * 4) % 1) < 0.05 ? 0.25 * rnd() : 0);
    } else {
      const env = 0.35 + 0.25 * Math.sin(t * 1.3);
      v = env * (Math.sin(2 * Math.PI * 196 * t) * Math.exp(-((t * 1.5) % 1) * 3) + 0.5 * Math.sin(2 * Math.PI * 247 * t) * Math.exp(-((t * 1.5 + 0.5) % 1) * 3));
    }
    b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 26000))), 44 + i * 2);
  }
  return b;
}

async function shot(page, name, clip) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 82, ...(clip ? { clip } : {}) });
  console.log('✓', name);
}

async function select(page, a, b) {
  const box = await page.getByTestId('waveform').boundingBox();
  await page.mouse.move(box.x + box.width * a, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * b, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/app.html`);
  await page.waitForTimeout(800);
  await shot(page, '01-home.jpg');

  await page.getByTestId('empty-record').click();
  await page.waitForTimeout(4500);
  await shot(page, '02-record.jpg');
  await page.getByTestId('rec-stop').click();
  await page.waitForTimeout(400);
  // close that take; use a realistic voice file instead
  await page.keyboard.press('Control+w');
  await page.getByTestId('file-input').setInputFiles({ name: 'Podcast intro.wav', mimeType: 'audio/wav', buffer: wav(14, 'voice') });
  await page.waitForTimeout(600);
  await select(page, 0.32, 0.58);
  await shot(page, '03-edit.jpg');

  await page.getByTestId('tab-effects').click();
  await page.getByTestId('fx-eq').click();
  for (const [band, v] of [['31', 4], ['62', 3], ['125', 1.5], ['2k', 2], ['4k', 4], ['8k', 3], ['500', -2]]) await page.getByLabel(`${band} Hz band`).fill(String(v));
  await shot(page, '04-effects.jpg');
  await page.keyboard.press('Escape');

  await page.getByTestId('tab-home').click();
  await select(page, 0.02, 0.06);
  await page.getByTestId('main-menu').click();
  await page.getByTestId('mm-Restore').click();
  await shot(page, '05-noise.jpg');
  await page.keyboard.press('Escape');

  await page.getByTestId('multitrack-toggle').check();
  await page.getByTestId('mt-file-input').setInputFiles([
    { name: 'Vocals.wav', mimeType: 'audio/wav', buffer: wav(14, 'voice') },
    { name: 'Guitar.wav', mimeType: 'audio/wav', buffer: wav(18, 'guitar') },
    { name: 'Drums.wav', mimeType: 'audio/wav', buffer: wav(16, 'drums') },
  ]);
  await page.waitForTimeout(800);
  await page.locator('[data-testid^="mute-"]').nth(2).click();
  await page.locator('[data-testid^="lane-"]').nth(1).click({ position: { x: 60, y: 46 } });
  await shot(page, '06-multitrack.jpg');
  await page.getByTestId('multitrack-toggle').uncheck();

  await page.getByTestId('export').click();
  await shot(page, '07-export.jpg');
  await page.keyboard.press('Escape');

  await page.getByTestId('file-input').setInputFiles({ name: 'Interview take 2.wav', mimeType: 'audio/wav', buffer: wav(8, 'voice') });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Control+w');
  await page.waitForTimeout(1200);
  await page.getByTestId('tab-tools').click();
  await page.getByRole('button', { name: 'Library' }).click();
  await shot(page, '08-recovery.jpg');
  await page.keyboard.press('Escape');

  await page.getByTestId('rb-settings').click();
  await shot(page, '09-settings.jpg');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await shot(page, '10-shortcuts.jpg');
  await ctx.close();

  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/app.html`);
  await mp.getByTestId('file-input').setInputFiles({ name: 'Voice memo.wav', mimeType: 'audio/wav', buffer: wav(10, 'voice') });
  await mp.waitForTimeout(700);
  const box = await mp.getByTestId('waveform').boundingBox();
  await mp.mouse.move(box.x + box.width * 0.3, box.y + 60);
  await mp.mouse.down();
  await mp.mouse.move(box.x + box.width * 0.62, box.y + 60, { steps: 5 });
  await mp.mouse.up();
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(OUT, '11-mobile.jpg'), type: 'jpeg', quality: 82 });
  console.log('✓ 11-mobile.jpg');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
