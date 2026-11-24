// Smoke test for a packaged desktop build:
//   node tests/e2e/desktop.electron.cjs <path-to-executable> [screenshot.png]
// (on Linux CI wrap with `xvfb-run -a`). Connects over the DevTools protocol because
// packaged Electron apps disable Node inspector flags.
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

(async () => {
  const exe = process.argv[2];
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(exe, ['--no-sandbox', `--remote-debugging-port=${port}`], { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!browser) throw new Error('desktop app did not start');
  let win;
  for (let i = 0; i < 40 && !win; i++) {
    win = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('app.html'));
    if (!win) await new Promise((r) => setTimeout(r, 250));
  }
  await win.waitForSelector('[data-testid=empty-generate]', { timeout: 20000 });
  await win.click('[data-testid=empty-generate]');
  await win.click('[data-testid=generate-insert]');
  await win.waitForSelector('[data-testid=waveform]');
  await win.click('[data-testid=select-all]');
  await win.click('[data-testid=fx-normalize]');
  await win.click('[data-testid=effect-apply]');
  await win.waitForSelector('.toast-success');
  // desktop bridge: preload is loaded and can create a desktop shortcut
  const bridge = await win.evaluate(() => typeof window.vipadDesktop?.createShortcut === 'function');
  if (!bridge) throw new Error('desktop bridge (preload) missing');
  if (process.platform === 'linux') {
    const r = await win.evaluate(() => window.vipadDesktop.createShortcut());
    if (!r.ok) throw new Error('createShortcut failed: ' + r.error);
    console.log('shortcut:', r.path);
  }
  // platform encoders (Opus) must be available in the packaged app too
  const enc = await win.evaluate(async () => ({ secure: isSecureContext, opus: (await window.AudioEncoder?.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }))?.supported ?? false }));
  console.log('encoders:', JSON.stringify(enc));
  if (!enc.opus) throw new Error('Opus encoder unavailable in desktop app');
  // Vipad Link VBAN: send a packet to ourselves over UDP through the main process and receive it back
  const vbanRes = await win.evaluate(() => new Promise((resolve) => {
    const l = window.vipadDesktop.link;
    const off = l.onVbanAudio((p) => { off(); resolve({ ok: true, sampleRate: p.sampleRate, channels: p.channels, n: p.samples.length, last: p.samples[p.samples.length - 1] }); });
    setTimeout(() => resolve({ ok: false }), 4000);
    void l.vbanRecvStart({ port: 26980, streamName: '' }).then(() => l.vbanSendStart({ host: '127.0.0.1', port: 26980, streamName: 'Smoke' })).then(() => {
      const pcm = Int16Array.from({ length: 512 }, (_, i) => i);
      l.vbanPacket(48000, 2, pcm);
    });
  }));
  console.log('vban:', JSON.stringify(vbanRes));
  if (!vbanRes.ok || vbanRes.n !== 512 || vbanRes.last !== 511) throw new Error('VBAN loopback failed');
  if (process.argv[3]) await win.screenshot({ path: process.argv[3] });
  console.log(JSON.stringify({ ok: true, title: await win.title(), page: win.url().replace(/.*\//, '') }));
  await browser.close().catch(() => {});
  child.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
