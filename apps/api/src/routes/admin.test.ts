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

const adminHeaders = {
  'x-user-email': 'admin@example.local',
  'x-user-role': 'admin'
};

describe('Admin operations routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('requires admin role for the operations snapshot', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const forbidden = await server.inject({
        method: 'GET',
        url: '/api/admin/operations'
      });

      expect(forbidden.statusCode).toBe(403);
    });
  });

  it('rejects forged admin role headers for local creator sessions', async () => {
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-local-auth-session-secret-32');
    const app = await createServer();

    await withApp(app, async (server) => {
      const registered = await server.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'creator-forged-admin@example.com',
          password: 'correct horse battery staple',
          name: 'Creator'
        }
      });
      expect(registered.statusCode).toBe(201);
      expect(registered.json()).toMatchObject({ role: 'creator' });

      const cookie = registered.headers['set-cookie'];
      const response = await server.inject({
        method: 'GET',
        url: '/api/admin/operations',
        headers: {
          cookie: Array.isArray(cookie) ? cookie[0] : String(cookie),
          'x-user-role': 'admin'
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'Admin role required' });
    });
  });

  it('returns users, projects, build jobs, connectors, masked config, and model usage', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Admin 运营项目',
          prompt: '生成一个支持后台运营查看的预约管理 Web 应用。'
        }
      });
      expect(created.statusCode).toBe(201);

      const generated = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/generate`
      });
      expect(generated.statusCode).toBe(201);

      const response = await server.inject({
        method: 'GET',
        url: '/api/admin/operations',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        dataSource: 'memory',
        modelUsage: {
          provider: 'volcengine',
          budgetCny: 25,
          estimatedSpendCny: expect.any(Number)
        }
      });
      expect(response.json().users).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            email: 'admin@example.local',
            role: 'admin'
          })
        ])
      );
      expect(response.json().projects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.json().id,
            status: 'spec_ready'
          })
        ])
      );
      expect(response.json().agentRuns[0]).toMatchObject({
        projectId: created.json().id,
        status: 'succeeded'
      });
      expect(response.json().modelInvocations[0]).toMatchObject({
        model: 'doubao-seed-2-1-turbo-260628',
        status: 'succeeded'
      });
      expect(response.json().buildJobs).toEqual([
        expect.objectContaining({
          status: 'idle'
        })
      ]);
      expect(response.json().connectors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'model-provider',
            status: 'configured',
            secretState: 'configured'
          }),
          expect.objectContaining({
            id: 'github',
            status: 'not_configured',
            secretState: 'missing'
          })
        ])
      );
      expect(response.json().systemConfig).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'DEEPSEEK_API_KEY',
            value: 'not_configured',
            sensitive: true
          }),
          expect.objectContaining({
            key: 'DATABASE_URL',
            value: 'configured',
            sensitive: true
          }),
          expect.objectContaining({
            key: 'CODEX_REAL_EXECUTION_ENABLED',
            value: 'disabled',
            sensitive: false
          }),
          expect.objectContaining({
            key: 'CODEX_REAL_COMMAND',
            value: 'not_configured',
            sensitive: true
          }),
          expect.objectContaining({
            key: 'CODEX_DOCKER_NETWORK_MODE',
            value: 'none',
            sensitive: false
          }),
          expect.objectContaining({
            key: 'CODEX_REAL_CANARY_ENABLED',
            value: 'disabled',
            sensitive: false
          }),
          expect.objectContaining({
            key: 'CODEX_SECRET_MOUNT_PATH',
            value: 'not_configured',
            sensitive: true
          }),
          expect.objectContaining({
            key: 'CODEX_REAL_DAILY_BUDGET_TASKS',
            value: '3',
            sensitive: false
          })
        ])
      );
      expect(JSON.stringify(response.json())).not.toContain('postgres://');
      expect(JSON.stringify(response.json())).not.toContain('sk-');
    });
  });

  it('surfaces Codex tasks, preview snapshots, and trace events without leaking secrets', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const workspace = await store.createWorkspace({
      projectId: 'demo-fitness',
      path: '/tmp/atoms-cp-workspaces/demo-fitness/main',
      status: 'ready'
    });
    const task = await store.createCodexTask({
      projectId: 'demo-fitness',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create first app shell',
      inputSummary: 'Structured AppSpec summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    const snapshot = await store.createPreviewSnapshot({
      projectId: 'demo-fitness',
      projectVersionId: 'project-version-1',
      status: 'ready',
      path: '/tmp/atoms-cp-previews/demo-fitness/v1',
      url: 'https://preview.example.test/demo-fitness/v1',
      active: true
    });
    const traceEvent = await store.appendTraceEvent({
      projectId: 'demo-fitness',
      codexTaskId: task.id,
      type: 'codex_task_created',
      visibility: 'admin',
      message: 'CodexTask created.',
      payload: {
        snapshotId: snapshot.id
      }
    });
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/admin/operations',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().codexTasks).toEqual([
        expect.objectContaining({
          id: task.id,
          status: 'queued'
        })
      ]);
      expect(response.json().previewSnapshots).toEqual([
        expect.objectContaining({
          id: snapshot.id,
          active: true
        })
      ]);
      expect(response.json().traceEvents).toEqual([
        expect.objectContaining({
          id: traceEvent.id,
          type: 'codex_task_created'
        })
      ]);
      expect(response.json().runtimeSummary).toMatchObject({
        activeCodexTasks: 0,
        failedCodexTasks: 0,
        activeBuildJobs: 0,
        failedBuildJobs: 0,
        readyPreviewSnapshots: 1,
        activePreviewSnapshots: 1,
        recoveredEvents: 0
      });
      expect(JSON.stringify(response.json())).not.toContain('sk-proj-');
      expect(JSON.stringify(response.json())).not.toContain('service-role-secret');
    });
  });

  it('summarizes runtime failures and stale recovery events for operators', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const task = await store.createCodexTask({
      projectId: 'demo-fitness',
      taskType: 'initial_generate',
      objective: 'Create first app shell',
      inputSummary: 'Structured AppSpec summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    await store.updateCodexTask(task.id, {
      status: 'failed',
      errorSummary: 'CodexTask exceeded stale timeout after 900000ms.'
    });
    const buildJob = await store.createBuildJob('demo-fitness', {});
    await store.updateBuildJob(buildJob.id, {
      status: 'failed',
      errorSummary: 'BuildJob exceeded stale timeout after 900000ms.'
    });
    await store.appendTraceEvent({
      projectId: 'demo-fitness',
      codexTaskId: task.id,
      type: 'error',
      visibility: 'admin',
      message: 'Recovered stale CodexTask.',
      payload: {
        stale: true
      }
    });
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/admin/operations',
        headers: adminHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().runtimeSummary).toMatchObject({
        activeCodexTasks: 0,
        failedCodexTasks: 1,
        activeBuildJobs: 0,
        failedBuildJobs: 1,
        recoveredEvents: 1,
        lastFailureSummary: 'CodexTask exceeded stale timeout after 900000ms.'
      });
      expect(JSON.stringify(response.json())).not.toContain('/tmp/atoms-cp-workspaces');
    });
  });

  it('surfaces project-level Supabase live test health in operations', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    })));

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Admin Supabase health',
          prompt: '验证后台能看到 Supabase 项目级健康状态。'
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
      await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/supabase/test`,
        payload: {}
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/admin/operations',
        headers: adminHeaders
      });

      const supabase = response.json().connectors.find((connector: { id: string }) => connector.id === 'supabase');
      expect(supabase).toMatchObject({
        id: 'supabase',
        status: 'configured',
        secretState: 'configured',
        projectsAffected: 1,
        lastCheckStatus: 'passed',
        lastCheckedAt: expect.any(String)
      });
      expect(JSON.stringify(response.json())).not.toContain('service-role-secret');
      expect(JSON.stringify(response.json())).not.toContain('public-anon-key');
    });
  });
});
