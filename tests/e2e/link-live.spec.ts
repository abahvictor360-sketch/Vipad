import { test, expect } from '@playwright/test';

// Optional: the same flow over the real internet signalling server (Supabase Realtime).
// Run with LINK_LIVE=1 (needs network access to the Supabase project).
test.skip(!process.env.LINK_LIVE, 'set LINK_LIVE=1 to test live signalling');

test('live signalling connects a sender and a receiver', async ({ context }) => {
  test.setTimeout(60_000);
  const host = await context.newPage();
  await host.goto('/app.html?e2e');
  await host.waitForFunction(() => (window as any).__vipad);
  await host.getByTestId('tab-tools').click();
  await host.getByTestId('rb-link').click();
  await host.getByTestId('link-start-receive').click();
  const code = await host.getByTestId('link-code').getAttribute('data-code', { timeout: 15_000 });
  await host.getByTestId('link-auto-accept').check();
  const guest = await context.newPage();
  await guest.goto(`/app.html?e2e&link=${code}`);
  await guest.getByTestId('link-join').click();
  await expect(host.getByTestId('link-guest')).toHaveAttribute('data-status', 'connected', { timeout: 30_000 });
  await expect.poll(async () => Number(await host.getByTestId('link-guest-level').getAttribute('data-level')), { timeout: 15_000 }).toBeGreaterThan(0.01);
});
