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

describe('M3 design and codegen routes', () => {
  it('generates design profiles, selects one, generates React/Vite files, and exposes the file tree', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M3 私教预约',
          prompt: '帮我做一个私教预约 Web 应用。用户可以查看教练、选择课程、提交预约。管理员可以查看预约列表。'
        }
      });
      expect(created.statusCode).toBe(201);

      const generatedSpec = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/generate`
      });
      expect(generatedSpec.statusCode).toBe(201);

      const confirmedSpec = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/spec/${generatedSpec.json().appSpec.id}/confirm`
      });
      expect(confirmedSpec.statusCode).toBe(200);

      const generatedDesigns = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/design/generate`
      });
      expect(generatedDesigns.statusCode).toBe(201);
      expect(generatedDesigns.json().profiles).toHaveLength(5);

      const designId = generatedDesigns.json().profiles[0].id;
      const selectedDesign = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/designs/${designId}/select`
      });
      expect(selectedDesign.statusCode).toBe(200);
      expect(selectedDesign.json()).toMatchObject({
        id: designId,
        selected: true
      });

      const codegen = await server.inject({
        method: 'POST',
        url: `/api/projects/${created.json().id}/codegen/react-vite`,
        payload: {
          designId
        }
      });
      expect(codegen.statusCode).toBe(201);
      expect(codegen.json().projectVersion).toMatchObject({
        projectId: created.json().id,
        version: 1,
        source: 'initial_generate'
      });
      expect(codegen.json().files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'src/App.tsx',
            version: 1
          }),
          expect.objectContaining({
            path: 'ai-manifest.json',
            version: 1
          })
        ])
      );
      expect(codegen.json().manifest.entries['home.hero.title']).toMatchObject({
        file: 'src/App.tsx',
        elementType: 'heading'
      });

      const files = await server.inject({
        method: 'GET',
        url: `/api/projects/${created.json().id}/files`
      });
      expect(files.statusCode).toBe(200);
      expect(files.json().map((file: { path: string }) => file.path)).toContain('src/App.tsx');

      const appFile = await server.inject({
        method: 'GET',
        url: `/api/projects/${created.json().id}/files?path=src%2FApp.tsx`
      });
      expect(appFile.statusCode).toBe(200);
      expect(appFile.json().content).toContain('data-ai-id="home.hero.title"');
    });
  });
});
