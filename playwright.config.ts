import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production web build (`npm run build` first) served by `vite preview`,
// in a Pixel 7 viewport with the Indian locale and timezone the app is designed for.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4173',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    serviceWorkers: 'block',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
