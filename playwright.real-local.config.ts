import { defineConfig, devices } from '@playwright/test';

const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://127.0.0.1:18180';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    ...devices['Desktop Chrome']
  },
  webServer: undefined
});
