import { Page, expect } from '@playwright/test';

export interface DocInfo { name: string; length: number; sampleRate: number; channels: number; selection: { start: number; end: number } | null; cursor: number; canUndo: boolean; canRedo: boolean; peak: number }

export async function openApp(page: Page) {
  await page.goto('/app.html?e2e');
  await page.waitForFunction(() => (window as any).__vipad);
}

export async function docInfo(page: Page): Promise<DocInfo | null> {
  return page.evaluate(() => {
    const st = (window as any).__vipad.getState();
    const d = st.active();
    if (!d) return null;
    let peak = 0;
    for (const c of d.audio.channels) for (let i = 0; i < c.length; i += 7) peak = Math.max(peak, Math.abs(c[i]));
    return { name: d.name, length: d.audio.channels[0].length, sampleRate: d.audio.sampleRate, channels: d.audio.channels.length, selection: d.selection, cursor: d.cursor, canUndo: d.history.canUndo, canRedo: d.history.canRedo, peak };
  });
}

/** Generate a tone through the real UI. */
export async function generateTone(page: Page, seconds = 3) {
  await page.getByTestId('empty-generate').click();
  const dur = page.getByLabel('Duration value');
  await dur.fill(String(seconds));
  await page.getByTestId('generate-insert').click();
  await expect(page.getByTestId('waveform')).toBeVisible();
}

export async function dragSelect(page: Page, fromFrac: number, toFrac: number) {
  const box = (await page.getByTestId('waveform').boundingBox())!;
  await page.mouse.move(box.x + box.width * fromFrac, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toFrac, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

/** Build a small 16-bit mono WAV in Node for upload tests. */
export function makeWav(seconds = 1, sr = 22050, freq = 330): Buffer {
  const n = Math.round(seconds * sr);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 12000), 44 + i * 2);
  return buf;
}
