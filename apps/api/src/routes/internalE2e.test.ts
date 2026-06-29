import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../server.js';
import { createInMemoryStore } from '../modules/data/inMemoryStore.js';

const originalEnv = { ...process.env };
const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-r8-e2e-route-'));
  roots.push(root);
  return root;
}

async function withServer<T>(callback: (server: Awaited<ReturnType<typeof createServer>>) => Promise<T>) {
  const server = await createServer({
    logger: false,
    store: createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'))
  });

  try {
    return await callback(server);
  } finally {
    await server.close();
  }
}

describe('internal E2E lifecycle route', () => {
  afterEach(async () => {
    process.env = { ...originalEnv };
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('is closed by default and in production', async () => {
    await withServer(async (server) => {
      const disabled = await server.inject({
        method: 'POST',
        url: '/api/internal/e2e/internal-beta-lifecycle'
      });

      expect(disabled.statusCode).toBe(404);
    });

    process.env.NODE_ENV = 'production';
    process.env.INTERNAL_E2E_ENABLED = 'true';
    process.env.PUBLIC_WEB_ORIGIN = 'https://atoms.example.com';
    process.env.PUBLIC_API_ORIGIN = 'https://atoms-api.example.com';
    process.env.ALLOWED_CORS_ORIGINS = 'https://atoms.example.com';
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = 'prod-github-token-key-32-characters';
    process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = 'prod-connector-token-key-32-chars';
    process.env.PREVIEW_ACCESS_SECRET = 'prod-preview-access-secret-32-chars';

    await withServer(async (server) => {
      const production = await server.inject({
        method: 'POST',
        url: '/api/internal/e2e/internal-beta-lifecycle'
      });

      expect(production.statusCode).toBe(404);
    });
  });

  it('requires the configured internal token before running the lifecycle', async () => {
    process.env.INTERNAL_E2E_ENABLED = 'true';
    process.env.INTERNAL_E2E_TOKEN = 'internal-e2e-token';

    await withServer(async (server) => {
      const missing = await server.inject({
        method: 'POST',
        url: '/api/internal/e2e/internal-beta-lifecycle'
      });
      const bad = await server.inject({
        method: 'POST',
        url: '/api/internal/e2e/internal-beta-lifecycle',
        headers: {
          'x-internal-e2e-token': 'bad-token'
        }
      });

      expect(missing.statusCode).toBe(403);
      expect(bad.statusCode).toBe(403);
    });
  });

  it('runs a sanitized API-level internal beta lifecycle and serves its preview artifact', async () => {
    const root = await makeRoot();
    process.env.INTERNAL_E2E_ENABLED = 'true';
    process.env.INTERNAL_E2E_TOKEN = 'internal-e2e-token';
    process.env.CODEX_WORKSPACE_ROOT = join(root, 'workspaces');
    process.env.PREVIEW_ROOT_DIR = join(root, 'previews');
    process.env.PREVIEW_BASE_URL = 'http://localhost:4000/preview';
    process.env.PREVIEW_ACCESS_SECRET = 'test-preview-secret-32-characters';

    await withServer(async (server) => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/internal/e2e/internal-beta-lifecycle',
        headers: {
          'x-internal-e2e-token': 'internal-e2e-token'
        },
        payload: {
          projectName: 'R8 浏览器验收项目'
        }
      });

      expect(response.statusCode).toBe(201);
      const report = response.json();
      expect(report).toMatchObject({
        status: 'passed',
        projectId: expect.any(String),
        codexTaskId: expect.any(String),
        previewUrl: expect.stringContaining('/preview/'),
        frontendRoutes: expect.objectContaining({
          workbench: expect.stringContaining('/app/'),
          inspector: expect.stringContaining('/inspect'),
          versions: expect.stringContaining('/versions'),
          publish: expect.stringContaining('/publish'),
          admin: '/admin'
        })
      });
      expect(report.traceSummary.length).toBeGreaterThan(0);
      expect(JSON.stringify(report)).not.toContain(root);
      expect(JSON.stringify(report)).not.toContain('test-preview-secret');

      const previewPath = new URL(report.previewUrl).pathname + new URL(report.previewUrl).search;
      const preview = await server.inject({
        method: 'GET',
        url: previewPath
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain('data-ai-id=');
      expect(preview.body).toContain('atoms-cp:preview-element-selected');
    });
  });
});
