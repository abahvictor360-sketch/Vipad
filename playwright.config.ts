import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a pre-installed Chromium when available (sandboxed CI/dev containers); otherwise Playwright's own.
const localChromium = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(localChromium) ? localChromium : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    launchOptions: { executablePath, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    permissions: ['microphone'],
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true }, testMatch: /responsive/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
