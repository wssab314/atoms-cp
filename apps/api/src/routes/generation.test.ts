import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../server.js';
import { createInMemoryStore } from '../modules/data/inMemoryStore.js';
import { getProjectGenerationStatus, runProjectGenerationOnce } from '../modules/generation/generationOrchestrator.js';

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

async function createProject(server: Awaited<ReturnType<typeof createServer>>, prompt = '帮我生成一个简单的个人简历网站') {
  const created = await server.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      name: '个人简历网站',
      prompt
    }
  });
  expect(created.statusCode).toBe(201);
  return created.json();
}

describe('R9.4 generation orchestration routes', () => {
  it('accepts generation-runs quickly and exposes a safe generation status', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server);
      const accepted = await server.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/generation-runs`
      });

      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toMatchObject({
        accepted: true,
        status: {
          projectId: project.id
        }
      });

      await waitFor(async () => {
        const tasks = await store.listCodexTasks(project.id);
        expect(tasks).toHaveLength(1);
      });

      const refreshedProject = await server.inject({
        method: 'GET',
        url: `/api/projects/${project.id}`
      });
      expect(refreshedProject.json().status).toBe('code_generating');

      const status = await server.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/generation-status`
      });
      const body = status.json();

      expect(status.statusCode).toBe(200);
      expect(body.stage).toBe('queueing_app_build');
      expect(JSON.stringify(body)).not.toMatch(/Docker|Codex|pnpm|stdout|stderr|workspace/i);
    });
  });

  it('resumes a spec_ready project from design generation and task queueing without duplicate work', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server, '帮我做一个课程报名页面，展示课程介绍和报名入口。');
      const spec = await server.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/spec/generate`
      });
      expect(spec.statusCode).toBe(201);

      await runProjectGenerationOnce({
        store,
        project
      });
      await runProjectGenerationOnce({
        store,
        project
      });

      expect(await store.listDesignProfiles(project.id)).toHaveLength(5);
      expect(await store.listCodexTasks(project.id)).toHaveLength(1);
    });
  });

  it('reports model failures as retryable user-safe failed status', async () => {
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      model: 'doubao-seed-2-1-turbo-260628',
      choices: [{ message: { content: '不是 JSON' } }],
      usage: { prompt_tokens: 10, completion_tokens: 3 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as typeof fetch);

    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server, '帮我生成一个简单的个人简历网站');
      await expect(runProjectGenerationOnce({
        store,
        project
      })).rejects.toMatchObject({
        errorType: 'MODEL_INVALID_JSON'
      });

      const status = await getProjectGenerationStatus({
        store,
        project
      });

      expect(status).toMatchObject({
        stage: 'failed',
        running: false,
        canRetry: true,
        errorMessage: '需求整理失败，请稍后重试。'
      });
      expect(JSON.stringify(status)).not.toMatch(/Docker|Codex|pnpm|stdout|stderr|workspace/i);
    });
  });

  it('prefers user-visible stale recovery errors in generation-status', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server, '帮我生成一个简单的个人简历网站');
      await store.setProjectStatus(project.id, 'build_failed');
      await store.createCodexTask({
        projectId: project.id,
        taskType: 'initial_generate',
        objective: 'Create initial app',
        inputSummary: 'Create initial app',
        allowedPaths: ['src/**', 'ai-manifest.json'],
        forbiddenPaths: ['.env', 'node_modules/**'],
        validationCommands: ['pnpm build']
      });
      const [task] = await store.listCodexTasks(project.id);
      await store.updateCodexTask(task!.id, {
        status: 'failed',
        errorSummary: 'CodexTask exceeded stale timeout after 900000ms.'
      });
      await store.appendTraceEvent({
        projectId: project.id,
        codexTaskId: task!.id,
        type: 'error',
        visibility: 'user',
        message: '生成任务已中断，请点击重试生成。',
        payload: {
          stage: 'failed',
          stale: true
        }
      });

      const status = await server.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/generation-status`
      });

      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        stage: 'failed',
        running: false,
        canRetry: true,
        errorMessage: '生成任务已中断，请点击重试生成。'
      });
      expect(JSON.stringify(status.json())).not.toMatch(/CodexTask|Docker|pnpm|stdout|stderr|workspace/i);
    });
  });

  it('keeps generation running for queued edits even when an older ready snapshot exists', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server, '帮我生成一个简单的个人简历网站');
      await store.createPreviewSnapshot({
        projectId: project.id,
        projectVersionId: 'project-version-old',
        buildJobId: 'build-job-old',
        status: 'ready',
        active: true,
        path: '/tmp/old-preview',
        url: 'http://127.0.0.1:18180/preview/old/index.html'
      });
      await store.createCodexTask({
        projectId: project.id,
        taskType: 'code_edit',
        objective: 'Apply user edit',
        inputSummary: 'User asked for a safer hero title.',
        allowedPaths: ['src/**', 'ai-manifest.json'],
        forbiddenPaths: ['.env', 'node_modules/**'],
        validationCommands: ['pnpm build']
      });

      const status = await getProjectGenerationStatus({
        store,
        project
      });

      expect(status).toMatchObject({
        stage: 'queueing_app_build',
        running: true
      });
      expect(status.stage).not.toBe('preview_ready');
      expect(JSON.stringify(status)).not.toMatch(/Docker|Codex|pnpm|stdout|stderr|workspace/i);
    });
  });

  it('returns preview_ready after a succeeded task has a ready snapshot', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-29T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const project = await createProject(server, '帮我生成一个简单的个人简历网站');
      const previewReadyProject = await store.setProjectStatus(project.id, 'preview_ready');
      await store.createCodexTask({
        projectId: project.id,
        taskType: 'initial_generate',
        objective: 'Create initial app',
        inputSummary: 'Create initial app',
        allowedPaths: ['src/**', 'ai-manifest.json'],
        forbiddenPaths: ['.env', 'node_modules/**'],
        validationCommands: ['pnpm build']
      });
      const [task] = await store.listCodexTasks(project.id);
      await store.updateCodexTask(task!.id, { status: 'succeeded' });
      const buildJob = await store.createBuildJob(project.id, {
        projectVersionId: 'project-version-ready'
      });
      await store.updateBuildJob(buildJob.id, {
        status: 'success',
        previewUrl: 'http://127.0.0.1:18180/preview/ready/index.html'
      });
      await store.createPreviewSnapshot({
        projectId: project.id,
        projectVersionId: 'project-version-ready',
        buildJobId: buildJob.id,
        status: 'ready',
        active: true,
        path: '/tmp/ready-preview',
        url: 'http://127.0.0.1:18180/preview/ready/index.html'
      });
      const status = await getProjectGenerationStatus({
        store,
        project: previewReadyProject ?? project
      });

      expect(status).toMatchObject({
        stage: 'preview_ready',
        running: false,
        previewUrl: 'http://127.0.0.1:18180/preview/ready/index.html'
      });
    });
  });
});

async function waitFor(assertion: () => Promise<void>, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  throw lastError;
}
