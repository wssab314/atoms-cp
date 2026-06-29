import { describe, expect, it } from 'vitest';
import { createServer } from '../server.js';
import { createInMemoryStore } from '../modules/data/inMemoryStore.js';

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

async function createProjectWithSpecAndDesign(server: Awaited<ReturnType<typeof createServer>>, prompt: string) {
  const created = await server.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      name: 'R1 客户成功工作台',
      prompt
    }
  });
  const projectId = created.json().id as string;
  const generatedSpec = await server.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/spec/generate`
  });
  const generatedDesigns = await server.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/design/generate`
  });
  const designId = generatedDesigns.json().profiles[0].id as string;
  await server.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/designs/${designId}/select`
  });

  return {
    projectId,
    appSpecId: generatedSpec.json().appSpec.id as string,
    designId
  };
}

describe('CodexTask runtime API routes', () => {
  it('creates a structured CodexTask from AppSpec and DesignProfile without raw prompt leakage', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const rawPromptMarker = 'RAW_PROMPT_SHOULD_NOT_LEAK';
      const { projectId } = await createProjectWithSpecAndDesign(
        server,
        `${rawPromptMarker}: 帮我做一个客户成功工作台，能跟踪续费风险和待办事项。`
      );
      const created = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/codex-tasks`
      });

      expect(created.statusCode).toBe(201);
      expect(created.json().workspace).toMatchObject({
        projectId,
        status: 'ready'
      });
      expect(created.json().codexTask).toMatchObject({
        projectId,
        taskType: 'initial_generate',
        status: 'queued',
        allowedPaths: expect.arrayContaining(['src/**']),
        forbiddenPaths: expect.arrayContaining(['.env']),
        validationCommands: ['pnpm typecheck', 'pnpm build']
      });
      expect(JSON.stringify(created.json().codexTask)).not.toContain(rawPromptMarker);
      expect(created.json().traceEvent).toMatchObject({
        projectId,
        codexTaskId: created.json().codexTask.id,
        type: 'codex_task_created'
      });

      const tasks = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/codex-tasks`
      });
      const workspaces = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/workspaces`
      });
      const traceEvents = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/trace-events?limit=5`
      });

      expect(tasks.json()).toHaveLength(1);
      expect(workspaces.json()).toHaveLength(1);
      expect(traceEvents.json()[0]).toMatchObject({
        type: 'codex_task_created'
      });
    });
  });

  it('returns project preview snapshots and keeps project access errors explicit', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const { projectId } = await createProjectWithSpecAndDesign(
        server,
        '帮我做一个销售线索管理应用，能查看线索状态和跟进优先级。'
      );
      const snapshot = store.createPreviewSnapshot({
        projectId,
        projectVersionId: 'project-version-1',
        status: 'ready',
        path: `/tmp/atoms-cp-previews/${projectId}/v1`,
        url: 'https://preview.example.test/project-version-1',
        active: true
      });
      const snapshots = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/preview-snapshots`
      });
      const missingProject = await server.inject({
        method: 'GET',
        url: '/api/projects/missing-project/codex-tasks'
      });
      const invalidTask = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/codex-tasks`,
        payload: {
          taskType: 'selector_patch'
        }
      });

      expect(snapshots.statusCode).toBe(200);
      expect(snapshots.json()).toEqual([snapshot]);
      expect(missingProject.statusCode).toBe(404);
      expect(invalidTask.statusCode).toBe(400);
    });
  });

  it('requires AppSpec and DesignProfile before creating CodexTasks', async () => {
    const app = await createServer({
      store: createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'))
    });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: '空项目',
          prompt: '帮我做一个还没有生成规格的项目，用于测试缺少 AppSpec 的状态。'
        }
      });
      const codexTask = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/codex-tasks`
      });

      expect(codexTask.statusCode).toBe(409);
      expect(codexTask.json().error).toContain('AppSpec');
    });
  });
});
