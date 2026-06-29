import { describe, expect, it } from 'vitest';
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

describe('M6 GitHub commit handoff routes', () => {
  it('previews files before confirmation, then records commit sha without returning file contents', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
    const app = await createServer({
      store,
      githubClient: {
        async exchangeCodeForToken() {
          throw new Error('not used');
        },
        async getViewer() {
          throw new Error('not used');
        },
        async listRepositories() {
          return [];
        },
        async createRepository() {
          throw new Error('not used');
        },
        async commitFiles(_token, input) {
          return {
            commitSha: '0123456789abcdef0123456789abcdef01234567',
            filesCommitted: input.files.length
          };
        }
      }
    });

    process.env.GITHUB_TOKEN = 'github-test-token';
    try {
      await withApp(app, async (server) => {
      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M6 GitHub 项目',
          prompt: '生成一个可以提交到 GitHub 的 Web 应用。'
        }
      });
      const projectId = created.json().id as string;

      await store.saveGeneratedProject({
        projectId,
        summary: 'Generated files for GitHub handoff test',
        files: [
          {
            path: 'package.json',
            content: '{"private":true}',
            purpose: 'package manifest'
          },
          {
            path: 'src/App.tsx',
            content: 'export function App() { return <main>secret-free app</main>; }',
            purpose: 'app entry'
          }
        ],
        manifest: {
          entries: {}
        }
      });

      const invalid = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/github/commit`,
        payload: {
          repoFullName: '../secret',
          message: 'Publish generated app'
        }
      });
      expect(invalid.statusCode).toBe(400);

      const plan = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/github/commit`,
        payload: {
          repoFullName: 'aibu/atoms-demo',
          branch: 'main',
          message: 'Publish generated app',
          confirmed: false
        }
      });
      expect(plan.statusCode).toBe(200);
      expect(plan.json()).toMatchObject({
        projectId,
        repoFullName: 'aibu/atoms-demo',
        branch: 'main',
        requiresConfirmation: true,
        files: expect.arrayContaining([
          expect.objectContaining({
            path: 'package.json',
            sizeBytes: 16
          }),
          expect.objectContaining({
            path: 'src/App.tsx'
          })
        ])
      });
      expect(JSON.stringify(plan.json())).not.toContain('secret-free app');

      const beforeConfirm = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}`
      });
      expect(beforeConfirm.json().githubCommitSha).toBeUndefined();

      const committed = await server.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/github/commit`,
        payload: {
          repoFullName: 'aibu/atoms-demo',
          branch: 'main',
          message: 'Publish generated app',
          confirmed: true
        }
      });
      expect(committed.statusCode).toBe(201);
      expect(committed.json()).toMatchObject({
        projectId,
        repoFullName: 'aibu/atoms-demo',
        branch: 'main',
        provider: 'github',
        filesCommitted: 2
      });
      expect(committed.json().commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(JSON.stringify(committed.json())).not.toContain('secret-free app');

      const afterConfirm = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}`
      });
      expect(afterConfirm.json()).toMatchObject({
        githubRepoFullName: 'aibu/atoms-demo',
        githubCommitSha: committed.json().commitSha
      });

      const publish = await server.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/publish`
      });
      expect(publish.json()).toMatchObject({
        githubRepoFullName: 'aibu/atoms-demo',
        githubCommitSha: committed.json().commitSha,
        manualVercelImportUrl: expect.stringContaining('https%3A%2F%2Fgithub.com%2Faibu%2Fatoms-demo')
      });
      expect(publish.json().checklist).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'github',
            status: 'passed'
          })
        ])
      );
      });
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });
});
