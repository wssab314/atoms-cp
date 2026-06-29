import { describe, expect, it } from 'vitest';
import {
  createGitHubRepositoryInputSchema,
  githubConnectorStatusSchema,
  githubCommitPlanSchema,
  githubCommitRequestSchema,
  githubRepositorySchema,
  githubRepoFullNameSchema
} from './github.js';

describe('GitHub handoff contracts', () => {
  it('validates repo full names and commit requests', () => {
    expect(githubRepoFullNameSchema.parse('aibu/atoms-demo')).toBe('aibu/atoms-demo');
    expect(() => githubRepoFullNameSchema.parse('../secret')).toThrow();

    const request = githubCommitRequestSchema.parse({
      repoFullName: 'aibu/atoms-demo',
      branch: 'main',
      message: 'Publish generated app',
      confirmed: true
    });

    expect(request).toMatchObject({
      repoFullName: 'aibu/atoms-demo',
      branch: 'main',
      message: 'Publish generated app',
      confirmed: true
    });
  });

  it('exposes a commit plan without file contents', () => {
    const plan = githubCommitPlanSchema.parse({
      projectId: 'project-1',
      repoFullName: 'aibu/atoms-demo',
      branch: 'main',
      message: 'Publish generated app',
      requiresConfirmation: true,
      files: [
        {
          path: 'src/App.tsx',
          sizeBytes: 42,
          contentHash: 'a'.repeat(64)
        }
      ]
    });

    expect(plan.files[0]).toEqual({
      path: 'src/App.tsx',
      sizeBytes: 42,
      contentHash: 'a'.repeat(64)
    });
    expect(JSON.stringify(plan)).not.toContain('function App');
  });

  it('validates connector status and repository contracts without secrets', () => {
    const status = githubConnectorStatusSchema.parse({
      configured: true,
      connected: true,
      externalUsername: 'aibu',
      scopes: ['repo', 'user:email']
    });

    expect(status).toEqual({
      configured: true,
      connected: true,
      externalUsername: 'aibu',
      scopes: ['repo', 'user:email']
    });
    expect(JSON.stringify(status)).not.toContain('token');

    expect(githubRepositorySchema.parse({
      id: 123,
      name: 'atoms-demo',
      fullName: 'aibu/atoms-demo',
      private: true,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/aibu/atoms-demo'
    })).toMatchObject({
      fullName: 'aibu/atoms-demo'
    });
  });

  it('validates create repository inputs with repo-name constraints', () => {
    expect(createGitHubRepositoryInputSchema.parse({
      name: 'atoms-demo',
      private: true,
      description: 'Generated app handoff'
    })).toMatchObject({
      name: 'atoms-demo',
      private: true
    });

    expect(() => createGitHubRepositoryInputSchema.parse({
      name: '../secret'
    })).toThrow();
  });
});
