import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('M6 publish center routes', () => {
  it('requires an active ready preview snapshot before publish and saves a validated Vercel deployment URL', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M6 发布项目',
          prompt: '生成一个可以预览、提交并发布到 Vercel 的 Web 应用。'
        }
      });
      const projectId = created.json().id as string;

      const initial = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/publish`
      });
      expect(initial.statusCode).toBe(200);
      expect(initial.json()).toMatchObject({
        projectId,
        checklist: expect.arrayContaining([
          expect.objectContaining({
            id: 'build',
            status: 'blocked'
          }),
          expect.objectContaining({
            id: 'vercel',
            status: 'blocked'
          })
        ])
      });

      const savedProject = await store.saveGeneratedProject({
        projectId,
        summary: 'Generated files for publish center test',
        files: [
          {
            path: 'package.json',
            content: '{"scripts":{"build":"vite build"}}',
            purpose: 'package manifest'
          },
          {
            path: 'src/App.tsx',
            content: 'export function App() { return <main />; }',
            purpose: 'app entry'
          }
        ],
        manifest: {
          entries: {}
        }
      });
      const buildJob = await store.createBuildJob(projectId, {
        projectVersionId: savedProject.projectVersion.id
      });
      await store.updateBuildJob(buildJob.id, {
        status: 'success',
        previewUrl: 'http://localhost:4000/preview/build-job-1/index.html?token=test'
      });

      const noSnapshot = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/publish`
      });
      expect(noSnapshot.statusCode).toBe(200);
      expect(noSnapshot.json()).toMatchObject({
        currentVersionId: savedProject.projectVersion.id,
        canPublish: false,
        blockingReasons: expect.arrayContaining(['Create an active ready preview snapshot before release.'])
      });
      expect(noSnapshot.json().checklist).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'build',
            status: 'blocked'
          })
        ])
      );

      const snapshot = await store.createPreviewSnapshot({
        projectId,
        projectVersionId: savedProject.projectVersion.id,
        buildJobId: buildJob.id,
        status: 'ready',
        path: '/tmp/atoms-cp-previews/project-1/v1',
        url: 'https://atoms-api.example.test/preview/preview-snapshot-1/index.html',
        active: true
      });

      const ready = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/publish`
      });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toMatchObject({
        currentVersionId: savedProject.projectVersion.id,
        activePreviewSnapshotId: snapshot.id,
        canPublish: false
      });
      expect(ready.json().checklist).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'build',
            status: 'passed'
          })
        ])
      );

      const invalid = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/publish/deployment-url`,
        payload: {
          deploymentUrl: 'javascript:alert(1)'
        }
      });
      expect(invalid.statusCode).toBe(400);

      const deployed = await server.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/publish/deployment-url`,
        payload: {
          deploymentUrl: 'https://atoms-demo.vercel.app'
        }
      });
      expect(deployed.statusCode).toBe(200);
      expect(deployed.json()).toMatchObject({
        projectId,
        deploymentUrl: 'https://atoms-demo.vercel.app',
        checklist: expect.arrayContaining([
          expect.objectContaining({
            id: 'vercel',
            status: 'passed'
          })
        ])
      });

      const project = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}`
      });
      expect(project.json()).toMatchObject({
        id: projectId,
        status: 'deployed',
        deploymentUrl: 'https://atoms-demo.vercel.app'
      });
    });
  });

  it('activates only ready preview snapshots for a project', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });

    await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'Snapshot 切换项目',
          prompt: '生成一个需要切换稳定快照的 Web 应用。'
        }
      });
      const projectId = created.json().id as string;
      const savedProject = await store.saveGeneratedProject({
        projectId,
        summary: 'Initial version',
        files: [
          {
            path: 'src/App.tsx',
            content: 'export function App() { return <main>v1</main>; }',
            purpose: 'app entry'
          }
        ],
        manifest: {
          entries: {}
        }
      });
      const active = await store.createPreviewSnapshot({
        projectId,
        projectVersionId: savedProject.projectVersion.id,
        status: 'ready',
        path: '/tmp/atoms-cp-previews/project-1/v1',
        url: 'https://atoms-api.example.test/preview/preview-snapshot-1/index.html',
        active: true
      });
      const creating = await store.createPreviewSnapshot({
        projectId,
        projectVersionId: savedProject.projectVersion.id,
        status: 'creating',
        path: '/tmp/atoms-cp-previews/project-1/v2',
        url: 'https://atoms-api.example.test/preview/preview-snapshot-2/index.html'
      });

      const rejected = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/preview-snapshots/${creating.id}/activate`
      });
      expect(rejected.statusCode).toBe(409);

      const activated = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/preview-snapshots/${active.id}/activate`
      });
      expect(activated.statusCode).toBe(200);
      expect(activated.json()).toMatchObject({
        previewSnapshot: {
          id: active.id,
          active: true,
          status: 'ready'
        },
        traceEvent: {
          type: 'preview_snapshot_activated',
          projectId
        }
      });
    });
  });

  it('rolls back to a prior version by creating a new version and queued build without exposing workspace paths', async () => {
    const workspaceRoot = join(tmpdir(), `atoms-cp-r6-${Date.now()}`);
    await mkdir(workspaceRoot, { recursive: true });
    process.env.CODEX_WORKSPACE_ROOT = workspaceRoot;
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({ store });

    try {
      await withApp(app, async (server) => {
        const created = await server.inject({
          method: 'POST',
          url: '/api/projects',
          payload: {
            name: 'Rollback 项目',
            prompt: '生成一个需要版本回退的 Web 应用。'
          }
        });
        const projectId = created.json().id as string;
        const v1Workspace = join(workspaceRoot, projectId, 'v1');
        const v2Workspace = join(workspaceRoot, projectId, 'v2');
        await mkdir(join(v1Workspace, 'src'), { recursive: true });
        await mkdir(join(v2Workspace, 'src'), { recursive: true });
        await writeFile(join(v1Workspace, 'src/App.tsx'), 'export function App() { return <main>stable v1</main>; }', 'utf8');
        await writeFile(join(v2Workspace, 'src/App.tsx'), 'export function App() { return <main>broken v2</main>; }', 'utf8');

        const initial = await store.saveGeneratedProject({
          projectId,
          summary: 'Stable version',
          workspacePath: v1Workspace,
          files: [
            {
              path: 'src/App.tsx',
              content: 'export function App() { return <main>stable v1</main>; }',
              purpose: 'stable app'
            }
          ],
          manifest: {
            entries: {}
          }
        });
        await store.saveProjectFilePatch({
          projectId,
          source: 'selector_edit',
          summary: 'Broken edit',
          workspacePath: v2Workspace,
          parentVersionId: initial.projectVersion.id,
          files: [
            {
              path: 'src/App.tsx',
              content: 'export function App() { return <main>broken v2</main>; }',
              purpose: 'broken app'
            }
          ]
        });

        const rolledBack = await server.inject({
          method: 'POST',
          url: `/api/projects/${projectId}/versions/${initial.projectVersion.id}/rollback`
        });

        expect(rolledBack.statusCode).toBe(201);
        expect(rolledBack.json()).toMatchObject({
          projectVersion: {
            projectId,
            version: 3,
            source: 'rollback',
            parentVersionId: initial.projectVersion.id,
            changedFiles: expect.arrayContaining(['src/App.tsx'])
          },
          buildJob: {
            projectId,
            status: 'queued'
          },
          traceEvent: {
            projectId,
            type: 'build_queued'
          }
        });
        expect(rolledBack.json().projectVersion.workspacePath).toBeUndefined();

        const appFile = await server.inject({
          method: 'GET',
          url: `/api/projects/${projectId}/files?path=src%2FApp.tsx`
        });
        expect(appFile.json().content).toContain('stable v1');
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      delete process.env.CODEX_WORKSPACE_ROOT;
    }
  });
});
