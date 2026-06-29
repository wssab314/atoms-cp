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

describe('M7 Supabase project config routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores Supabase public config, encrypts service role, generates schema SQL, and injects client files', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M7 Supabase 项目',
          prompt: '生成一个带预约数据表的 Web 应用。'
        }
      });
      const projectId = created.json().id as string;

      const generatedSpec = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/spec/generate`,
        payload: {}
      });
      const spec = generatedSpec.json().appSpec.spec;
      const editedSpec = {
        ...spec,
        dataModels: [
          {
            name: 'Booking',
            fields: [
              {
                name: 'memberName',
                type: 'string',
                required: true
              },
              {
                name: 'startsAt',
                type: 'datetime',
                required: true
              },
              {
                name: 'isPaid',
                type: 'boolean',
                required: false
              }
            ]
          }
        ]
      };
      const updatedSpec = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/spec/latest`,
        payload: {
          spec: editedSpec
        }
      });
      await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/spec/${updatedSpec.json().id}/confirm`,
        payload: {}
      });

      const invalid = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/supabase/config`,
        payload: {
          supabaseUrl: 'javascript:alert(1)',
          anonKey: 'public-anon-key'
        }
      });
      expect(invalid.statusCode).toBe(400);

      const saved = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/supabase/config`,
        payload: {
          supabaseUrl: 'https://demo.supabase.co',
          anonKey: 'public-anon-key',
          serviceRoleKey: 'service-role-secret'
        }
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        projectId,
        configured: true,
        supabaseUrl: 'https://demo.supabase.co',
        anonKeyConfigured: true,
        serviceRoleKeyConfigured: true,
        envReady: true
      });
      expect(JSON.stringify(saved.json())).not.toContain('service-role-secret');

      const stored = await store.getProjectSupabaseConfig(projectId);
      expect(stored?.serviceRoleKeyEncrypted).toBeTruthy();
      expect(stored?.serviceRoleKeyEncrypted).not.toContain('service-role-secret');

      const latestConfig = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/supabase/config`
      });
      expect(latestConfig.json()).toMatchObject({
        anonKeyMasked: expect.stringContaining('pub')
      });
      expect(JSON.stringify(latestConfig.json())).not.toContain('service-role-secret');

      const sql = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/supabase/schema-sql`
      });
      expect(sql.statusCode).toBe(200);
      expect(sql.json().tables).toEqual(['bookings']);
      expect(sql.json().sql).toContain('create table if not exists public.bookings');
      expect(sql.json().sql).toContain('member_name text not null');
      expect(sql.json().sql).toContain('starts_at timestamptz not null');
      expect(sql.json().sql).toContain('is_paid boolean');
      expect(sql.json().sql).toContain('alter table public.bookings enable row level security');
      expect(sql.json().sql).toContain('This SQL is not a migration system');

      const designs = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/design/generate`,
        payload: {}
      });
      const designId = designs.json().profiles[0].id;
      await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/designs/${designId}/select`,
        payload: {}
      });
      const codegen = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/codegen/react-vite`,
        payload: {
          designId
        }
      });

      expect(codegen.statusCode).toBe(201);
      const filePaths = codegen.json().files.map((file: { path: string }) => file.path);
      expect(filePaths).toContain('src/lib/supabase.ts');
      expect(filePaths.some((path: string) => path.includes('.env'))).toBe(false);
      const supabaseFile = codegen.json().files.find((file: { path: string }) => file.path === 'src/lib/supabase.ts');
      expect(supabaseFile.content).toContain('VITE_SUPABASE_URL');
      expect(supabaseFile.content).not.toContain('service-role-secret');
    });
  });

  it('live-tests Supabase with anon credentials only and gates deploy env confirmation', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M8 Supabase Gate 项目',
          prompt: '验证 Supabase 发布门禁。'
        }
      });
      const projectId = created.json().id as string;

      const missing = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/supabase/test`,
        payload: {}
      });
      expect(missing.statusCode).toBe(200);
      expect(missing.json()).toMatchObject({
        status: 'blocked'
      });
      expect(fetchMock).not.toHaveBeenCalled();

      await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/supabase/config`,
        payload: {
          supabaseUrl: 'https://demo.supabase.co',
          anonKey: 'public-anon-key',
          serviceRoleKey: 'service-role-secret'
        }
      });

      const publishBeforeConfirmation = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/publish`
      });
      const envBefore = publishBeforeConfirmation.json().checklist.find((item: { id: string }) => item.id === 'env');
      const supabaseBefore = publishBeforeConfirmation.json().checklist.find((item: { id: string }) => item.id === 'supabase');
      expect(envBefore).toMatchObject({
        status: 'blocked'
      });
      expect(supabaseBefore).toMatchObject({
        status: 'blocked'
      });

      const blockedDeployment = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/publish/deployment-url`,
        payload: {
          deploymentUrl: 'https://demo.vercel.app'
        }
      });
      expect(blockedDeployment.statusCode).toBe(409);

      const test = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/supabase/test`,
        payload: {}
      });
      expect(test.statusCode).toBe(200);
      expect(test.json()).toMatchObject({
        projectId,
        status: 'passed',
        httpStatus: 200
      });
      expect(JSON.stringify(test.json())).not.toContain('service-role-secret');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://demo.supabase.co/rest/v1/');
      expect(init.headers).toMatchObject({
        apikey: 'public-anon-key',
        Authorization: 'Bearer public-anon-key'
      });
      expect(JSON.stringify(init)).not.toContain('service-role-secret');

      const persistedConfig = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/supabase/config`
      });
      expect(persistedConfig.json()).toMatchObject({
        lastConnectionStatus: 'passed',
        lastConnectionHttpStatus: 200,
        lastConnectionCheckedAt: expect.any(String)
      });
      expect(JSON.stringify(persistedConfig.json())).not.toContain('service-role-secret');

      const confirmation = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/supabase/frontend-env`,
        payload: {
          confirmed: true
        }
      });
      expect(confirmation.statusCode).toBe(200);
      expect(confirmation.json().frontendEnvConfirmedAt).toBe('2026-06-27T00:00:00.000Z');

      const publishAfterConfirmation = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/publish`
      });
      const envAfter = publishAfterConfirmation.json().checklist.find((item: { id: string }) => item.id === 'env');
      const supabaseAfter = publishAfterConfirmation.json().checklist.find((item: { id: string }) => item.id === 'supabase');
      expect(envAfter).toMatchObject({
        status: 'passed'
      });
      expect(supabaseAfter).toMatchObject({
        status: 'passed'
      });
    });
  });

  it('blocks deployment URL when Supabase live test has not passed', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M9 Supabase Deploy Gate 项目',
          prompt: '验证发布前必须通过 Supabase 真实连接测试。'
        }
      });
      const projectId = created.json().id as string;

      await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/supabase/config`,
        payload: {
          supabaseUrl: 'https://demo.supabase.co',
          anonKey: 'public-anon-key'
        }
      });
      await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/supabase/frontend-env`,
        payload: {
          confirmed: true
        }
      });

      const blockedDeployment = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/publish/deployment-url`,
        payload: {
          deploymentUrl: 'https://demo.vercel.app'
        }
      });
      expect(blockedDeployment.statusCode).toBe(409);
      expect(blockedDeployment.json()).toMatchObject({
        error: expect.stringContaining('passing Supabase live connection test')
      });
    });
  });

  it('reports Supabase live test failures without leaking upstream details', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('service-role-secret', {
      status: 401
    })));

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M8 Supabase Failure 项目',
          prompt: '验证 Supabase 失败不泄漏。'
        }
      });
      const projectId = created.json().id as string;

      await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/supabase/config`,
        payload: {
          supabaseUrl: 'https://demo.supabase.co',
          anonKey: 'public-anon-key',
          serviceRoleKey: 'service-role-secret'
        }
      });

      const test = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/supabase/test`,
        payload: {}
      });

      expect(test.statusCode).toBe(200);
      expect(test.json()).toMatchObject({
        status: 'failed',
        httpStatus: 401
      });
      expect(JSON.stringify(test.json())).not.toContain('service-role-secret');

      const persistedConfig = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/supabase/config`
      });
      expect(persistedConfig.json()).toMatchObject({
        lastConnectionStatus: 'failed',
        lastConnectionHttpStatus: 401
      });
      expect(JSON.stringify(persistedConfig.json())).not.toContain('service-role-secret');
    });
  });
});
