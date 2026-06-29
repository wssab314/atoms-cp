import { describe, expect, it, vi } from 'vitest';
import { createInMemoryStore } from '../modules/data/inMemoryStore.js';
import type { GitHubApiClient } from '../modules/github/githubClient.js';
import { createServer } from '../server.js';

async function withEnv<T>(env: Record<string, string | undefined>, callback: () => Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

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

function createMockGitHubClient(): GitHubApiClient {
  return {
    exchangeCodeForToken: vi.fn(async () => ({
      accessToken: 'gho_test_access_token',
      scope: ['repo', 'user:email'],
      tokenType: 'bearer'
    })),
    getViewer: vi.fn(async () => ({
      id: 'github-user-1',
      login: 'aibu'
    })),
    listRepositories: vi.fn(async () => [
      {
        id: 1,
        name: 'atoms-demo',
        fullName: 'aibu/atoms-demo',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/aibu/atoms-demo'
      }
    ]),
    createRepository: vi.fn(async (_token, input) => ({
      id: 2,
      name: input.name,
      fullName: `aibu/${input.name}`,
      private: input.private,
      defaultBranch: 'main',
      htmlUrl: `https://github.com/aibu/${input.name}`
    })),
    commitFiles: vi.fn(async () => ({
      commitSha: 'b'.repeat(40),
      filesCommitted: 2
    }))
  };
}

describe('GitHub connector routes', () => {
  it('reports OAuth configuration without leaking secrets', async () => {
    await withEnv({
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'test-encryption-key'
    }, async () => {
      const app = await createServer({
        store: createInMemoryStore(),
        githubClient: createMockGitHubClient()
      });

      await withApp(app, async (server) => {
        const status = await server.inject({
          method: 'GET',
          url: '/api/connectors/github/status'
        });

        expect(status.statusCode).toBe(200);
        expect(status.json()).toMatchObject({
          configured: true,
          connected: false,
          scopes: []
        });
        expect(JSON.stringify(status.json())).not.toContain('client-secret');
      });
    });
  });

  it('completes OAuth callback, stores only encrypted token state, then lists and creates repositories', async () => {
    await withEnv({
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'test-encryption-key'
    }, async () => {
      const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
      const githubClient = createMockGitHubClient();
      const app = await createServer({
        store,
        githubClient
      });

      await withApp(app, async (server) => {
        const start = await server.inject({
          method: 'GET',
          url: '/api/connectors/github/oauth/start?returnTo=/app/new'
        });
        expect(start.statusCode).toBe(200);
        const state = new URL(start.json().authorizationUrl).searchParams.get('state');
        expect(state).toBeTruthy();

        const callback = await server.inject({
          method: 'GET',
          url: `/api/connectors/github/oauth/callback?code=oauth-code&state=${encodeURIComponent(state ?? '')}`
        });
        expect(callback.statusCode).toBe(302);
        expect(callback.headers.location).toContain('/app/new');

        const account = await store.getConnectorAccount('user-creator', 'github');
        expect(account).toMatchObject({
          connector: 'github',
          externalUsername: 'aibu',
          scopes: ['repo', 'user:email']
        });
        expect(account?.tokenEncrypted).not.toContain('gho_test_access_token');

        const repos = await server.inject({
          method: 'GET',
          url: '/api/connectors/github/repos'
        });
        expect(repos.statusCode).toBe(200);
        expect(repos.json()).toEqual([
          expect.objectContaining({
            fullName: 'aibu/atoms-demo'
          })
        ]);

        const invalidRepo = await server.inject({
          method: 'POST',
          url: '/api/connectors/github/repos',
          payload: {
            name: '../secret'
          }
        });
        expect(invalidRepo.statusCode).toBe(400);

        const createdRepo = await server.inject({
          method: 'POST',
          url: '/api/connectors/github/repos',
          payload: {
            name: 'new-demo',
            private: true
          }
        });
        expect(createdRepo.statusCode).toBe(201);
        expect(createdRepo.json()).toMatchObject({
          fullName: 'aibu/new-demo',
          private: true
        });
      });
    });
  });

  it('uses the connected GitHub provider for confirmed commits without returning file contents', async () => {
    await withEnv({
      GITHUB_CLIENT_ID: 'client-id',
      GITHUB_CLIENT_SECRET: 'client-secret',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'test-encryption-key'
    }, async () => {
      const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
      const githubClient = createMockGitHubClient();
      const app = await createServer({
        store,
        githubClient
      });

      await withApp(app, async (server) => {
        const start = await server.inject({
          method: 'GET',
          url: '/api/connectors/github/oauth/start'
        });
        const state = new URL(start.json().authorizationUrl).searchParams.get('state');
        await server.inject({
          method: 'GET',
          url: `/api/connectors/github/oauth/callback?code=oauth-code&state=${encodeURIComponent(state ?? '')}`
        });

        const created = await server.inject({
          method: 'POST',
          url: '/api/projects',
          payload: {
            name: 'GitHub connected project',
            prompt: '生成一个可提交 GitHub 的 Web 应用。'
          }
        });
        const projectId = created.json().id as string;
        await store.saveGeneratedProject({
          projectId,
          summary: 'Generated files',
          files: [
            {
              path: 'package.json',
              content: '{"private":true}',
              purpose: 'manifest'
            },
            {
              path: 'src/App.tsx',
              content: 'export function App() { return <main>secret-free connected app</main>; }',
              purpose: 'entry'
            }
          ],
          manifest: {
            entries: {}
          }
        });

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
          provider: 'github',
          commitSha: 'b'.repeat(40),
          filesCommitted: 2
        });
        expect(JSON.stringify(committed.json())).not.toContain('secret-free connected app');
        expect(githubClient.commitFiles).toHaveBeenCalledWith(
          'gho_test_access_token',
          expect.objectContaining({
            repoFullName: 'aibu/atoms-demo',
            files: expect.arrayContaining([
              expect.objectContaining({
                path: 'src/App.tsx',
                content: expect.stringContaining('secret-free connected app')
              })
            ])
          })
        );
      });
    });
  });
});
