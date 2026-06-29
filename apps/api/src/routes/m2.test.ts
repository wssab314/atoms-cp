import { describe, expect, it } from 'vitest';
import { createServer } from '../server.js';

async function withApp<T>(run: Awaited<ReturnType<typeof createServer>>, callback: (app: Awaited<ReturnType<typeof createServer>>) => Promise<T>) {
  try {
    return await callback(run);
  } finally {
    await run.close();
  }
}

describe('M2 AppSpec generation routes', () => {
  it('generates a validated AppSpec and records the AgentRun', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M2 私教预约',
          prompt: '帮我做一个私教预约 Web 应用。用户可以查看教练、选择课程、提交预约。管理员可以查看预约列表。'
        }
      });
      expect(created.statusCode).toBe(201);

      const generated = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/generate`
      });

      expect(generated.statusCode).toBe(201);
      expect(generated.json()).toMatchObject({
        appSpec: {
          projectId: created.json().id,
          version: 1,
          status: 'validated',
          spec: {
            appName: 'M2 私教预约'
          }
        },
        agentRun: {
          projectId: created.json().id,
          purpose: 'app_spec_generation',
          status: 'succeeded',
          provider: 'volcengine'
        },
        modelInvocation: {
          projectId: created.json().id,
          purpose: 'app_spec_generation',
          status: 'succeeded',
          budgetLimitCny: 25
        }
      });
    });
  });

  it('returns the latest generated AppSpec for a project', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Latest Spec 项目',
          prompt: '生成一个课程预约应用，需要首页、课程列表和预约提交。'
        }
      });

      await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/generate`
      });

      const latest = await server.inject({
        method: 'GET',
        url: `/api/projects/${created.json().id}/spec/latest`
      });

      expect(latest.statusCode).toBe(200);
      expect(latest.json()).toMatchObject({
        projectId: created.json().id,
        version: 1,
        status: 'validated'
      });
    });
  });

  it('creates a new AppSpec version from user edits and confirms it', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Spec 编辑确认项目',
          prompt: '生成一个课程预约应用，需要首页、课程列表和预约提交。'
        }
      });

      const generated = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/generate`
      });
      expect(generated.statusCode).toBe(201);

      const editedSpec = {
        ...generated.json().appSpec.spec,
        appGoal: '让用户完成课程预约并让管理员确认预约'
      };
      const updated = await server.inject({
        method: 'PUT',
        url: `/api/projects/${created.json().id}/spec/latest`,
        payload: {
          spec: editedSpec
        }
      });

      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        projectId: created.json().id,
        version: 2,
        status: 'validated',
        spec: {
          appGoal: '让用户完成课程预约并让管理员确认预约'
        }
      });

      const confirmed = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/${updated.json().id}/confirm`
      });

      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json()).toMatchObject({
        id: updated.json().id,
        version: 2,
        status: 'confirmed'
      });
    });
  });

  it('surfaces AgentRun and ModelInvocation status in Admin overview', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Admin 可观测项目',
          prompt: '生成一个管理员可观测的预约应用。'
        }
      });

      await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/generate`
      });

      const overview = await server.inject({
        method: 'GET',
        url: '/api/admin/overview',
        headers: {
          'x-user-email': 'admin@example.local',
          'x-user-role': 'admin'
        }
      });

      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toMatchObject({
        appSpecsCount: 1,
        agentRunsCount: 1,
        modelInvocationsCount: 1,
        modelCallsToday: 1
      });
      expect(overview.json().recentAgentRuns[0]).toMatchObject({
        projectId: created.json().id,
        status: 'succeeded'
      });
      expect(overview.json().recentModelInvocations[0]).toMatchObject({
        provider: 'volcengine',
        status: 'succeeded'
      });
    });
  });
});
