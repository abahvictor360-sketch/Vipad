import { test, expect, Page } from '@playwright/test';

// Two tabs in one browser: a receiver and a sender. Signalling uses BroadcastChannel (?signal=local);
// the audio itself is a real WebRTC/Opus connection carrying Chromium's fake microphone.
async function open(page: Page, extra = '') {
  await page.goto(`/app.html?e2e&signal=local${extra}`);
  await page.waitForFunction(() => (window as any).__vipad);
}

test('a sender streams its microphone to a receiver, which can record it', async ({ context }) => {
  test.setTimeout(60_000);
  const host = await context.newPage();
  await open(host);
  await host.getByTestId('tab-tools').click();
  await host.getByTestId('rb-link').click();
  await host.getByTestId('link-start-receive').click();
  const code = await host.getByTestId('link-code').getAttribute('data-code');
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await expect(host.getByTestId('link-waiting')).toBeVisible();

  // the sender opens the invite link: the panel opens on Send with the code filled in
  const guest = await context.newPage();
  await open(guest, `&link=${code}`);
  await expect(guest.getByTestId('link-join-code')).toHaveValue(`${code!.slice(0, 3)}-${code!.slice(3)}`);
  await guest.getByTestId('link-name').fill('Test phone');
  await guest.getByTestId('link-join').click();
  await expect(guest.getByTestId('link-send-status')).toContainText('Waiting');

  // the receiver approves the request
  const row = host.getByTestId('link-guest');
  await expect(row).toContainText('Test phone');
  await host.getByTestId('link-accept').click();
  await expect(row).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
  await expect(guest.getByTestId('link-send-status')).toContainText('Live', { timeout: 20_000 });

  // audio arrives: the receiver's meter moves and latency is measured
  await expect.poll(async () => Number(await host.getByTestId('link-guest-level').getAttribute('data-level')), { timeout: 15_000 }).toBeGreaterThan(0.01);
  await expect(host.getByTestId('link-latency')).toContainText('ms', { timeout: 10_000 });
  await expect(host.getByTestId('link-badge')).toContainText('1 in');

  // record the guest into Vipad
  await host.getByTestId('link-record-toggle').check();
  await host.keyboard.press('Escape');
  await host.getByTestId('topbar-record').click();
  await host.waitForTimeout(1500);
  await host.getByTestId('rec-badge').click();
  await expect.poll(() => host.evaluate(() => {
    const d = (window as any).__vipad.getState().active();
    if (!d || !d.audio.channels[0].length) return 0;
    let p = 0; for (const c of d.audio.channels) for (let i = 0; i < c.length; i += 5) p = Math.max(p, Math.abs(c[i]));
    return p;
  }), { timeout: 10_000 }).toBeGreaterThan(0.01);

  // the sender disconnects; the receiver drops it
  await guest.getByTestId('link-disconnect').click();
  await host.getByTestId('link-badge').click();
  await expect(host.getByTestId('link-guest')).toHaveCount(0, { timeout: 10_000 });
  await host.getByTestId('link-stop-receive').click();
  await expect(host.getByTestId('link-start-receive')).toBeVisible();
});

test('a declined sender sees why', async ({ context }) => {
  const host = await context.newPage();
  await open(host);
  await host.getByTestId('tab-tools').click();
  await host.getByTestId('rb-link').click();
  await host.getByTestId('link-start-receive').click();
  const code = (await host.getByTestId('link-code').getAttribute('data-code'))!;
  const guest = await context.newPage();
  await open(guest);
  await guest.getByTestId('tab-tools').click();
  await guest.getByTestId('rb-link').click();
  await guest.getByTestId('link-tab-send').click();
  await guest.getByTestId('link-join-code').fill(code.toLowerCase());
  await guest.getByTestId('link-join').click();
  await host.getByTestId('link-decline').click();
  await expect(guest.getByTestId('link-error')).toContainText('declined');
});

test('VBAN explains it needs the desktop app in a browser', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-tools').click();
  await page.getByTestId('rb-link').click();
  await page.getByTestId('link-tab-vban').click();
  await expect(page.getByText('needs the Vipad desktop app')).toBeVisible();
});
