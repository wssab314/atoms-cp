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
      name: 'M4 私教预约',
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
    projectVersionId: codegen.json().projectVersion.id as string
  };
}

describe('M4 build and preview routes', () => {
  it('creates a queued build job, exposes it, and returns read-only logs', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const { projectId, projectVersionId } = await createGeneratedProject(server);
      const createdBuild = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/builds`,
        payload: { projectVersionId }
      });

      expect(createdBuild.statusCode).toBe(201);
      expect(createdBuild.json()).toMatchObject({
        projectId,
        projectVersionId,
        status: 'queued'
      });
      expect(createdBuild.json().previewUrl).toBeUndefined();

      const loadedBuild = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/builds/${createdBuild.json().id}`
      });
      expect(loadedBuild.statusCode).toBe(200);
      expect(loadedBuild.json()).toMatchObject({
        id: createdBuild.json().id,
        status: 'queued'
      });

      const logs = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/builds/${createdBuild.json().id}/logs`
      });
      expect(logs.statusCode).toBe(200);
      expect(logs.json()).toEqual([]);
    });
  });
});
