import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function createProject(server: Awaited<ReturnType<typeof createServer>>) {
  const created = await server.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      name: '个人作品集',
      prompt: '帮我生成一个简单的个人作品集网站，包含首页、作品展示和联系方式。'
    }
  });
  expect(created.statusCode).toBe(201);
  return created.json();
}

async function prepareReadyProject(server: Awaited<ReturnType<typeof createServer>>, store: ReturnType<typeof createInMemoryStore>) {
  const project = await createProject(server);
  const spec = await server.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/spec/generate`
  });
  expect(spec.statusCode).toBe(201);
  const designs = await server.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/design/generate`
  });
  expect(designs.statusCode).toBe(201);
  await store.createPreviewSnapshot({
    projectId: project.id,
    projectVersionId: 'version-ready-1',
    status: 'ready',
    path: `/tmp/atoms-cp-previews/${project.id}/version-ready-1`,
    url: 'https://preview.example.test/version-ready-1',
    active: true
  });
  return project;
}

describe('R9.5 agent stream and messages routes', () => {
  it('streams only user-safe agent events and generation status', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server);
      await store.appendTraceEvent({
        projectId: project.id,
        type: 'agent_started',
        visibility: 'user',
        message: '正在整理需求。',
        payload: {
          stage: 'organizing_requirements'
        }
      });
      await store.appendTraceEvent({
        projectId: project.id,
        type: 'error',
        visibility: 'admin',
        message: 'Docker failed in /tmp/workspace with stderr output.',
        payload: {
          stage: 'internal'
        }
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/agent-stream`
      });
      const body = response.body;

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(body).toContain('正在整理需求。');
      expect(body).not.toMatch(/Docker|Codex|pnpm|stdout|stderr|workspace|\/tmp/i);
    });
  });

  it('persists a deferred user message without creating a duplicate task while work is active', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server);
      await store.createCodexTask({
        projectId: project.id,
        taskType: 'initial_generate',
        objective: 'Active generation',
        inputSummary: 'Active generation',
        allowedPaths: ['src/**'],
        validationCommands: ['pnpm build']
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/agent-messages`,
        payload: {
          content: '把首页标题改得更温柔一些'
        }
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        accepted: true,
        queued: false,
        delivery: 'deferred',
        queuePosition: 1,
        message: '已收到修改需求。当前版本仍在生成中，稍后会继续处理。'
      });
      expect(await store.listCodexTasks(project.id)).toHaveLength(1);
      expect(await store.listAgentMessages(project.id, 10)).toEqual([
        expect.objectContaining({
          projectId: project.id,
          content: '把首页标题改得更温柔一些',
          status: 'deferred'
        })
      ]);
      expect((await store.listTraceEvents(project.id, 10))[0]).toMatchObject({
        visibility: 'user',
        message: '用户提出新的修改需求。'
      });
      expect(JSON.stringify(response.json())).not.toMatch(/Docker|Codex|pnpm|stdout|stderr|workspace/i);
    });
  });

  it('creates a code_edit task when a ready preview exists and no task is active', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await prepareReadyProject(server, store);
      const response = await server.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/agent-messages`,
        payload: {
          content: '把作品展示区域改成三张卡片，并强调联系方式'
        }
      });
      const tasks = await store.listCodexTasks(project.id);

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        accepted: true,
        queued: true,
        delivery: 'queued',
        queuePosition: 0,
        message: '已收到修改需求，正在排队生成新版本。'
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        taskType: 'code_edit',
        projectVersionId: 'version-ready-1'
      });
      expect(JSON.stringify(tasks[0])).not.toContain(project.prompt);
      expect(await store.listAgentMessages(project.id, 10)).toEqual([
        expect.objectContaining({
          projectId: project.id,
          content: '把作品展示区域改成三张卡片，并强调联系方式',
          status: 'processing',
          relatedTaskId: tasks[0]?.id
        })
      ]);
    });
  });

  it('lists persisted agent messages and drains the first deferred message after the active task is done', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await prepareReadyProject(server, store);
      const activeTask = await store.createCodexTask({
        projectId: project.id,
        taskType: 'code_edit',
        objective: 'Active edit',
        inputSummary: 'Active edit',
        allowedPaths: ['src/**', 'ai-manifest.json'],
        validationCommands: ['pnpm build']
      });

      const deferred = await server.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/agent-messages`,
        payload: {
          content: '第一条排队修改'
        }
      });
      await store.updateCodexTask(activeTask.id, {
        status: 'succeeded',
        finishedAt: '2026-06-29T00:00:01.000Z'
      });
      const listedBeforeDrain = await server.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/agent-messages`
      });
      const stream = await server.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/agent-stream`
      });
      const tasks = await store.listCodexTasks(project.id);
      const listedAfterDrain = await server.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/agent-messages`
      });

      expect(deferred.json()).toMatchObject({
        delivery: 'deferred'
      });
      expect(listedBeforeDrain.statusCode).toBe(200);
      expect(listedBeforeDrain.json()[0]).toMatchObject({
        content: '第一条排队修改',
        status: 'deferred'
      });
      expect(stream.statusCode).toBe(200);
      expect(tasks.filter((task) => task.taskType === 'code_edit')).toHaveLength(2);
      expect(listedAfterDrain.json()[0]).toMatchObject({
        content: '第一条排队修改',
        status: 'processing',
        relatedTaskId: tasks[0]?.id
      });
    });
  });

  it('copies the ready version workspace before queueing a code_edit task', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const sourceWorkspace = await mkdtemp(join(tmpdir(), 'atoms-cp-agent-source-'));
    const targetRoot = await mkdtemp(join(tmpdir(), 'atoms-cp-agent-target-'));
    const previousWorkspaceRoot = process.env.CODEX_WORKSPACE_ROOT;
    process.env.CODEX_WORKSPACE_ROOT = targetRoot;
    const app = await createServer({ store });

    try {
      await withApp(app, async (server) => {
        const project = await createProject(server);
        const spec = await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/spec/generate`
        });
        const designs = await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/design/generate`
        });
        expect(spec.statusCode).toBe(201);
        expect(designs.statusCode).toBe(201);

        await mkdir(join(sourceWorkspace, 'src'), { recursive: true });
        await writeFile(
          join(sourceWorkspace, 'src/App.tsx'),
          '<h1 data-ai-id="home.hero.title">当前稳定版本</h1>',
          'utf8'
        );
        await writeFile(
          join(sourceWorkspace, 'ai-manifest.json'),
          JSON.stringify({
            entries: {
              'home.hero.title': {
                aiId: 'home.hero.title',
                file: 'src/App.tsx',
                component: 'App',
                elementType: 'heading',
                editable: ['text']
              }
            }
          }),
          'utf8'
        );
        await writeFile(join(sourceWorkspace, '.env'), 'SHOULD_NOT_COPY=1', 'utf8');

        const saved = await store.saveGeneratedProject({
          projectId: project.id,
          summary: 'Ready app',
          workspacePath: sourceWorkspace,
          files: [
            {
              path: 'src/App.tsx',
              content: '<h1 data-ai-id="home.hero.title">当前稳定版本</h1>',
              purpose: 'Source app'
            }
          ],
          manifest: {
            entries: {
              'home.hero.title': {
                aiId: 'home.hero.title',
                file: 'src/App.tsx',
                component: 'App',
                elementType: 'heading',
                editable: ['text']
              }
            }
          }
        });
        await store.createPreviewSnapshot({
          projectId: project.id,
          projectVersionId: saved.projectVersion.id,
          status: 'ready',
          path: `/tmp/atoms-cp-previews/${project.id}/${saved.projectVersion.id}`,
          url: `https://preview.example.test/${saved.projectVersion.id}`,
          active: true
        });

        const response = await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/agent-messages`,
          payload: {
            content: '把首页标题改成更适合咖啡店店长查看'
          }
        });
        const [task] = await store.listCodexTasks(project.id);
        const workspace = task?.workspaceId ? await store.getWorkspace(task.workspaceId) : undefined;

        expect(response.statusCode).toBe(202);
        expect(response.json()).toMatchObject({
          accepted: true,
          queued: true
        });
        expect(task).toMatchObject({
          taskType: 'code_edit',
          projectVersionId: saved.projectVersion.id
        });
        expect(workspace?.path).toContain(targetRoot);
        await expect(readFile(join(workspace?.path ?? '', 'src/App.tsx'), 'utf8')).resolves.toContain('当前稳定版本');
        await expect(readFile(join(workspace?.path ?? '', '.env'), 'utf8')).rejects.toThrow();
      });
    } finally {
      if (previousWorkspaceRoot === undefined) {
        delete process.env.CODEX_WORKSPACE_ROOT;
      } else {
        process.env.CODEX_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      await rm(sourceWorkspace, { recursive: true, force: true });
      await rm(targetRoot, { recursive: true, force: true });
    }
  });

  it('validates agent message input and project access', async () => {
    const app = await createServer({
      store: createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'))
    });

    await withApp(app, async (server) => {
      const invalid = await server.inject({
        method: 'POST',
        url: '/api/projects/missing/agent-messages',
        payload: {
          content: ''
        }
      });
      const missing = await server.inject({
        method: 'GET',
        url: '/api/projects/missing/agent-stream'
      });

      expect(invalid.statusCode).toBe(400);
      expect(missing.statusCode).toBe(404);
    });
  });
});
