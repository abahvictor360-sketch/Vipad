import { test, expect } from '@playwright/test';
import { openApp, docInfo, generateTone } from './helpers';

const recStatus = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__vipadRec?.getState().status);

test.describe('live recording (in the editor)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await openApp(page);
  });

  test('records live in the editor with a moving meter, REC badge and red clock', async ({ page }) => {
    await page.getByTestId('record').click(); // transport record button
    await expect(page.getByTestId('live-recording')).toBeVisible();
    await expect(page.getByTestId('rec-badge')).toBeVisible();
    await expect(page.getByTestId('clock')).toHaveClass(/rec/);
    await page.waitForTimeout(1500);
    // live waveform has data and the input level moved
    expect(await page.evaluate(() => (window as any).__vipadRec.getState().recorder.peakCount)).toBeGreaterThan(100);
    // the fake microphone beeps with gaps: the meter must move during a beep
    await expect.poll(() => page.evaluate(() => Math.max(...(window as any).__vipadRec.getState().recorder.levels)), { timeout: 5000, intervals: [50] }).toBeGreaterThan(0.01);
    // pause via transport, resume, stop via transport stop
    await page.getByTestId('tp-rec-pause').click();
    expect(await recStatus(page)).toBe('paused');
    await page.getByTestId('tp-rec-pause').click();
    expect(await recStatus(page)).toBe('recording');
    await page.getByTestId('tp-stop').click();
    await expect(page.getByTestId('waveform')).toBeVisible();
    const d = (await docInfo(page))!;
    expect(d.length / d.sampleRate).toBeGreaterThan(1.2);
    await expect(page.getByTestId('rec-badge')).toHaveCount(0);
  });

  test('keyboard: R starts, P pauses, Space stops', async ({ page }) => {
    await page.keyboard.press('r');
    await expect(page.getByTestId('live-recording')).toBeVisible();
    await page.waitForTimeout(600);
    await page.keyboard.press('p');
    expect(await recStatus(page)).toBe('paused');
    await page.keyboard.press('p');
    await page.waitForTimeout(400);
    await page.keyboard.press(' ');
    await expect(page.getByTestId('waveform')).toBeVisible();
    expect(await recStatus(page)).toBe('idle');
  });

  test('the + tab opens a new tab ready to record, and recording starts only when asked', async ({ page }) => {
    await generateTone(page, 1);
    const before = (await docInfo(page))!;
    await page.getByTestId('new-tab').click();
    await expect(page.locator('.doc-tab')).toHaveCount(2);
    await expect(page.getByTestId('empty-doc')).toBeVisible();
    await expect(page.getByTestId('empty-doc')).toHaveText('');
    // a big faded logo watermark fills the blank tab
    await expect(page.getByTestId('empty-watermark')).toBeVisible();
    // nothing is recording yet
    await page.waitForTimeout(600);
    expect(await recStatus(page)).toBe('idle');
    await expect(page.getByTestId('live-recording')).toHaveCount(0);
    // the user starts it
    await page.getByTestId('topbar-record').click();
    await expect(page.getByTestId('live-recording')).toBeVisible();
    await expect(page.getByTestId('empty-watermark')).toHaveCount(0); // the watermark goes once recording starts
    await expect(page.locator('.doc-tab')).toHaveCount(2); // records into the new tab, no extra tab
    await page.waitForTimeout(1000);
    await page.getByTestId('tp-stop').click();
    const d = (await docInfo(page))!;
    expect(d.name).toMatch(/^Recording/);
    expect(d.length).toBeGreaterThan(0);
    // the original file is untouched
    await page.locator('.doc-tab-name').first().click();
    expect((await docInfo(page))!.length).toBe(before.length);
  });

  test('record options dialog: insert into current file at the cursor', async ({ page }) => {
    await generateTone(page, 1);
    const n = (await docInfo(page))!.length;
    await page.getByTestId('main-menu').click();
    await page.getByTestId('mm-Control').click();
    await page.getByRole('menuitem', { name: 'Record Options…' }).click();
    await page.getByTestId('rec-dest').selectOption('insert');
    await page.getByTestId('rec-start').click();
    await page.waitForTimeout(800);
    await page.getByTestId('tp-stop').click();
    await expect.poll(async () => (await docInfo(page))!.length).toBeGreaterThan(n);
    expect(await page.locator('.doc-tab').count()).toBe(1);
  });

  test('discarding a short take closes its empty tab', async ({ page }) => {
    await page.getByTestId('empty-record').click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('empty-record')).toBeVisible();
  });
});

test.describe('settings: microphone, master volume, side panel', () => {
  test('microphone choice and master volume are remembered', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    await page.getByTestId('mic-test').click();
    await expect.poll(() => page.getByTestId('mic-test-meter').getAttribute('aria-valuenow').then(Number)).toBeGreaterThan(-60);
    const options = await page.getByTestId('mic-select').locator('option').allTextContents();
    expect(options[0]).toBe('System default');
    expect(options.length).toBeGreaterThan(1); // fake device listed with its name after permission
    await page.getByTestId('mic-select').selectOption({ index: 1 });
    await page.getByTestId('mic-test').click();
    await page.getByTestId('master-volume').fill('0.4');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByLabel('Master volume')).toHaveValue('0.4');
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipadSettings);
    const s = await page.evaluate(() => (window as any).__vipadSettings.getState());
    expect(s.micDeviceId).not.toBe('');
    expect(s.masterVolume).toBe(0.4);
    // recording uses the chosen microphone
    await page.getByTestId('empty-record').click();
    await expect(page.getByTestId('live-recording')).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByTestId('tp-stop').click();
    expect((await docInfo(page))!.length).toBeGreaterThan(0);
  });

  test('effects/info/markers panel can be hidden and stays hidden', async ({ page }) => {
    await openApp(page);
    await generateTone(page, 1);
    await expect(page.locator('.sidebar')).toBeVisible();
    await page.locator('.sb-close').click();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.getByTestId('autosave')).toHaveAttribute('data-status', 'saved');
    await page.reload();
    await page.waitForFunction(() => (window as any).__vipad);
    await expect.poll(async () => (await docInfo(page))?.name).toBe('Tone');
    await expect(page.locator('.sidebar')).toBeHidden();
    await page.getByTestId('toggle-panel').click();
    await expect(page.locator('.sidebar')).toBeVisible();
  });
});

test('recordings are stereo by default, and older saved settings move to stereo once', async ({ page }) => {
  // a user from an older version whose saved settings still say mono
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('vipad.settings.v1', JSON.stringify({ recordChannels: 1, multitrack: false }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await openApp(page);
  expect(await page.evaluate(() => (window as any).__vipadSettings.getState().recordChannels)).toBe(2);
  await page.getByTestId('record').click();
  await page.waitForTimeout(1200);
  await page.getByTestId('tp-stop').click();
  await expect(page.getByTestId('waveform')).toBeVisible();
  expect((await docInfo(page))!.channels).toBe(2);
  // choosing mono afterwards sticks across reloads
  await page.evaluate(() => (window as any).__vipadSettings.getState().set({ recordChannels: 1 }));
  await page.reload();
  await page.waitForFunction(() => (window as any).__vipadSettings);
  expect(await page.evaluate(() => (window as any).__vipadSettings.getState().recordChannels)).toBe(1);
});
