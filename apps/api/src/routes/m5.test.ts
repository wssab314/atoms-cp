import { describe, expect, it } from 'vitest';
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

async function createGeneratedProject(server: Awaited<ReturnType<typeof createServer>>) {
  const created = await server.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      name: 'M5 私教预约',
      prompt: '帮我做一个私教预约 Web 应用。用户可以查看教练、选择课程、提交预约。管理员可以查看预约列表。'
    }
  });
  const projectId = created.json().id as string;

  const generatedSpec = await server.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/spec/generate`
  });
  await server.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/spec/${generatedSpec.json().appSpec.id}/confirm`
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
  const codegen = await server.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/codegen/react-vite`,
    payload: { designId }
  });

  return {
    projectId,
    manifest: codegen.json().manifest as {
      entries: Record<string, { aiId: string; elementType: string; editable: string[]; file: string }>;
    }
  };
}

describe('M5 selector text patch routes', () => {
  it('returns the latest manifest and project versions without exposing workspace paths', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const { projectId, manifest } = await createGeneratedProject(server);
      const manifestResponse = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/manifest`
      });
      const versionsResponse = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/versions`
      });

      expect(manifestResponse.statusCode).toBe(200);
      expect(manifestResponse.json()).toMatchObject({
        projectId,
        manifest
      });
      expect(manifestResponse.json().entries.length).toBe(Object.keys(manifest.entries).length);
      expect(versionsResponse.statusCode).toBe(200);
      expect(versionsResponse.json()[0]).toMatchObject({
        projectId,
        version: 1,
        source: 'initial_generate'
      });
      expect(versionsResponse.json()[0].workspacePath).toBeUndefined();
    });
  });

  it('patches a manifest-backed button label, creates a selector_edit version, and queues a rebuild', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const { projectId, manifest } = await createGeneratedProject(server);
      const ctaEntry = Object.values(manifest.entries).find((entry) => entry.elementType === 'button');

      expect(ctaEntry).toBeDefined();

      const patched = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/selector/text-patch`,
        payload: {
          aiId: ctaEntry?.aiId,
          text: '立即预约'
        }
      });

      expect(patched.statusCode).toBe(201);
      expect(patched.json().manifestEntry).toMatchObject({
        aiId: ctaEntry?.aiId,
        file: 'src/App.tsx',
        elementType: 'button'
      });
      expect(patched.json().projectVersion).toMatchObject({
        projectId,
        version: 2,
        source: 'selector_edit',
        changedFiles: ['src/App.tsx']
      });
      expect(patched.json().projectVersion.workspacePath).toBeUndefined();
      expect(patched.json().traceEvent).toMatchObject({
        projectId,
        type: 'build_queued'
      });
      expect(patched.json().buildJob).toMatchObject({
        projectId,
        projectVersionId: patched.json().projectVersion.id,
        status: 'queued'
      });

      const appFile = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/files?path=src%2FApp.tsx`
      });
      expect(appFile.json().content).toContain(`data-ai-id="${ctaEntry?.aiId}">{"立即预约"}</button>`);
    });
  });

  it('rejects manifest entries that are not text-editable', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const { projectId, manifest } = await createGeneratedProject(server);
      const sectionEntry = Object.values(manifest.entries).find((entry) => !entry.editable.includes('text'));

      expect(sectionEntry).toBeDefined();

      const patched = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/selector/text-patch`,
        payload: {
          aiId: sectionEntry?.aiId,
          text: '立即预约'
        }
      });

      expect(patched.statusCode).toBe(409);
      expect(patched.json()).toMatchObject({
        error: 'Selected element is not text editable'
      });
    });
  });

  it('runs the Selector Patch Agent, creates an agent_patch version, and queues a rebuild', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const { projectId, manifest } = await createGeneratedProject(server);
      const ctaEntry = Object.values(manifest.entries).find((entry) => entry.elementType === 'button');

      expect(ctaEntry).toBeDefined();

      const patched = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/selector/ai-patch`,
        payload: {
          aiId: ctaEntry?.aiId,
          instruction: '把按钮文案改成“马上预约”'
        }
      });

      expect(patched.statusCode).toBe(201);
      expect(patched.json().manifestEntry).toMatchObject({
        aiId: ctaEntry?.aiId,
        file: 'src/App.tsx',
        elementType: 'button'
      });
      expect(patched.json().projectVersion).toMatchObject({
        projectId,
        version: 2,
        source: 'agent_patch',
        changedFiles: ['src/App.tsx']
      });
      expect(patched.json().projectVersion.workspacePath).toBeUndefined();
      expect(patched.json().agentRun).toMatchObject({
        projectId,
        purpose: 'selector_patch',
        provider: 'volcengine',
        status: 'succeeded'
      });
      expect(patched.json().modelInvocation).toMatchObject({
        projectId,
        agentRunId: patched.json().agentRun.id,
        purpose: 'selector_patch',
        status: 'succeeded'
      });
      expect(patched.json().buildJob).toMatchObject({
        projectId,
        projectVersionId: patched.json().projectVersion.id,
        status: 'queued'
      });

      const appFile = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/files?path=src%2FApp.tsx`
      });
      expect(appFile.json().content).toContain(`data-ai-id="${ctaEntry?.aiId}">{"马上预约"}</button>`);
    });
  });

  it('routes style AI selector patch into a constrained selector_patch task', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const { projectId, manifest } = await createGeneratedProject(server);
      const headingEntry = Object.values(manifest.entries).find((entry) => entry.elementType === 'heading');

      expect(headingEntry).toBeDefined();

      const patched = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/selector/ai-patch`,
        payload: {
          aiId: headingEntry?.aiId,
          instruction: '让这个标题更醒目，字体更大，颜色更接近品牌蓝'
        }
      });
      expect(patched.statusCode).toBe(202);
      expect(patched.json()).toMatchObject({
        queued: true,
        operation: 'update_style',
        manifestEntry: {
          aiId: headingEntry?.aiId,
          file: 'src/App.tsx'
        },
        task: {
          taskType: 'selector_patch',
          status: 'queued',
          allowedPaths: ['src/App.tsx', 'ai-manifest.json']
        }
      });
      expect(JSON.stringify(patched.json())).not.toMatch(/Docker|Codex|pnpm|stdout|stderr|workspace|\/tmp/i);
    });
  });

  it('downloads a zip archive for the current project code without exposing unsafe paths', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const { projectId } = await createGeneratedProject(server);
      const downloaded = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/code/download`
      });

      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers['content-type']).toContain('application/zip');
      const archiveText = downloaded.rawPayload.toString('latin1');
      expect(archiveText).toContain('ai-manifest.json');
      expect(archiveText).toContain('src/App.tsx');
      expect(archiveText).not.toContain('.env');
      expect(archiveText).not.toContain('node_modules');
      expect(archiveText).not.toContain('dist/');
    });
  });
});
