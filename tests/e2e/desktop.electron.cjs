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
  if (process.argv[3]) await win.screenshot({ path: process.argv[3] });
  console.log(JSON.stringify({ ok: true, title: await win.title(), page: win.url().replace(/.*\//, '') }));
  await browser.close().catch(() => {});
  child.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
