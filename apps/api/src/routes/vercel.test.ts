import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryStore } from '../modules/data/inMemoryStore.js';
import { createServer } from '../server.js';

async function withApp<T>(
  run: Awaited<ReturnType<typeof createServer>>,
  callback: (app: Awaited<ReturnType<typeof createServer>>) => Promise<T>
) {
  try {
    return await callback(run);
  } finally {
    await run.close();
  }
}

describe('M9 Vercel environment checks', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('blocks checks when the backend Vercel token is missing', async () => {
    vi.stubEnv('VERCEL_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = await createServer({
      store: createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'))
    });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Vercel token missing',
          prompt: '验证 Vercel token 缺失时不发起远程请求。'
        }
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/vercel/env/check`,
        payload: {
          vercelProjectIdOrName: 'atoms-demo'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'blocked',
        missingKeys: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('checks Vercel production env vars without decrypting or leaking values', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'vercel-secret-token');
    vi.stubEnv('VERCEL_API_BASE_URL', 'https://api.vercel.test');
    vi.stubEnv('VERCEL_TEAM_ID', 'team_123');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      envs: [
        {
          key: 'VITE_SUPABASE_URL',
          target: ['production'],
          type: 'encrypted',
          value: 'https://leaky.supabase.co'
        },
        {
          key: 'VITE_SUPABASE_ANON_KEY',
          target: ['production', 'preview'],
          type: 'encrypted',
          value: 'secret-value'
        }
      ]
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await createServer({
      store: createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'))
    });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Vercel env pass',
          prompt: '验证 Vercel 生产环境变量齐备。'
        }
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/vercel/env/check`,
        payload: {
          vercelProjectIdOrName: 'atoms-demo'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'passed',
        requiredKeys: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
        missingKeys: []
      });
      expect(JSON.stringify(response.json())).not.toContain('secret-value');
      expect(JSON.stringify(response.json())).not.toContain('vercel-secret-token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall = fetchMock.mock.calls[0];
      if (!firstCall) {
        throw new Error('Expected Vercel env check to call fetch');
      }
      const [url, init] = firstCall;
      expect(url).toBe('https://api.vercel.test/v10/projects/atoms-demo/env?teamId=team_123');
      expect(url).not.toContain('decrypt=true');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer vercel-secret-token'
      });
    });
  });

  it('reports missing Vercel production env vars without exposing upstream values', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'vercel-secret-token');
    vi.stubEnv('VERCEL_API_BASE_URL', 'https://api.vercel.test');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      envs: [
        {
          key: 'VITE_SUPABASE_URL',
          target: ['preview'],
          type: 'encrypted',
          value: 'secret-value'
        }
      ]
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await createServer({
      store: createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'))
    });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Vercel env missing',
          prompt: '验证缺少生产环境变量时给出可操作状态。'
        }
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/vercel/env/check`,
        payload: {
          vercelProjectIdOrName: 'atoms-demo'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'failed',
        missingKeys: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
      });
      expect(JSON.stringify(response.json())).not.toContain('secret-value');
      expect(JSON.stringify(response.json())).not.toContain('vercel-secret-token');
    });
  });
});
