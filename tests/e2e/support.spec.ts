import { test, expect } from '@playwright/test';

test('support page: payment methods, free ways to help and business enquiry', async ({ page, context }) => {
  await page.goto('/support.html');
  await expect(page.getByRole('heading', { name: 'Support Vipad' })).toBeVisible();
  // only configured payment methods are shown
  const sponsor = page.locator('[data-link=githubSponsors]');
  await expect(sponsor).toHaveAttribute('href', /github\.com\/sponsors\//);
  await expect(page.locator('[data-method=paystack]')).toHaveCount(0);
  await expect(page.locator('[data-method=flutterwave]')).toHaveCount(0);

  // validation
  await page.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(page.locator('#s-form-err')).toBeVisible();
  await expect(page.locator('input[name=name]')).toHaveAttribute('aria-invalid', 'true');

  await page.fill('input[name=name]', 'Ada');
  await page.fill('input[name=org]', 'Acme Radio');
  await page.fill('input[name=email]', 'ada@acme.test');
  await page.fill('textarea[name=message]', 'We would like to sponsor Vipad Link.');
  let opened = '';
  await context.route('https://github.com/**', (route) => { opened ||= route.request().url(); return route.fulfill({ body: 'ok' }); });
  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Send enquiry' }).click();
  const p = await popup;
  await expect.poll(() => opened).not.toBe('');
  const url = new URL(opened);
  expect(url.hostname).toBe('github.com');
  expect(url.searchParams.get('title')).toBe('Sponsorship enquiry — Acme Radio');
  expect(url.searchParams.get('body')).toContain('We would like to sponsor Vipad Link.');
  await p.close();
});

test('landing links to Support and Vipad Link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#link h2')).toContainText('wireless mic');
  await page.locator('.support-band').getByRole('link', { name: 'Support Vipad' }).click();
  await expect(page).toHaveURL(/support\.html#individuals/);
});
