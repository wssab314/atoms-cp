import { defineConfig, devices } from '@playwright/test';

const apiOrigin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:4108';
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://127.0.0.1:5178';
const internalToken = process.env.INTERNAL_E2E_TOKEN ?? 'atoms-cp-local-e2e-token';
const previewRoot = process.env.PREVIEW_ROOT_DIR ?? '/tmp/atoms-cp-e2e-previews';
const workspaceRoot = process.env.CODEX_WORKSPACE_ROOT ?? '/tmp/atoms-cp-e2e-workspaces';
const apiPort = new URL(apiOrigin).port || '4108';
const webPort = new URL(webOrigin).port || '5178';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: webOrigin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ],
  webServer: [
    {
      command: [
        'NODE_ENV=test',
        'DATA_STORE=memory',
        'AUTH_MODE=local',
        'MODEL_PROVIDER=volcengine',
        'VOLCENGINE_MODEL=doubao-seed-2-1-turbo-260628',
        'INTERNAL_BETA_SMOKE_MODE=deterministic',
        'ADMIN_BOOTSTRAP_EMAILS=e2e-admin@example.local',
        `PORT=${apiPort}`,
        'INTERNAL_E2E_ENABLED=true',
        `INTERNAL_E2E_TOKEN=${internalToken}`,
        `E2E_API_ORIGIN=${apiOrigin}`,
        `E2E_WEB_ORIGIN=${webOrigin}`,
        `PREVIEW_BASE_URL=${apiOrigin}/preview`,
        `PREVIEW_ROOT_DIR=${previewRoot}`,
        `CODEX_WORKSPACE_ROOT=${workspaceRoot}`,
        'PREVIEW_ACCESS_SECRET=local-e2e-preview-secret-32-chars',
        'pnpm --filter @atoms-cp/api dev'
      ].join(' '),
      url: `${apiOrigin}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: [
        `WEB_PORT=${webPort}`,
        `VITE_API_BASE_URL=${apiOrigin}`,
        `API_PROXY_TARGET=${apiOrigin}`,
        'pnpm --filter @atoms-cp/web dev --host 127.0.0.1'
      ].join(' '),
      url: `${webOrigin}/login`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
