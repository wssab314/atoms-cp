import { describe, expect, it } from 'vitest';
import { createProjectPublishState } from './publishState.js';

const project = {
  id: 'project-1',
  ownerId: 'user-1',
  name: 'Release Ready App',
  prompt: 'Release gate test project',
  status: 'preview_ready',
  target: 'web',
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z'
} as const;

describe('createProjectPublishState', () => {
  it('requires an active ready preview snapshot for publish readiness', () => {
    const blocked = createProjectPublishState({
      project: {
        ...project,
        githubRepoFullName: 'aibu/release-ready-app',
        githubCommitSha: 'a'.repeat(40),
        deploymentUrl: 'https://release-ready-app.vercel.app'
      },
      latestBuildJob: {
        id: 'build-job-1',
        projectId: project.id,
        projectVersionId: 'project-version-1',
        status: 'success',
        previewUrl: 'https://atoms-api.example.test/preview/build-job-1/index.html',
        createdAt: '2026-06-27T00:00:00.000Z'
      },
      currentVersionId: 'project-version-1',
      githubConfigured: true,
      supabaseConfigured: false,
      supabaseFrontendEnvConfirmed: false
    });

    expect(blocked.canPublish).toBe(false);
    expect(blocked.blockingReasons).toContain('Create an active ready preview snapshot before release.');
    expect(blocked.checklist.find((item) => item.id === 'build')).toMatchObject({
      status: 'blocked'
    });

    const ready = createProjectPublishState({
      project: {
        ...project,
        githubRepoFullName: 'aibu/release-ready-app',
        githubCommitSha: 'a'.repeat(40),
        deploymentUrl: 'https://release-ready-app.vercel.app'
      },
      latestBuildJob: {
        id: 'build-job-1',
        projectId: project.id,
        projectVersionId: 'project-version-1',
        status: 'success',
        previewUrl: 'https://atoms-api.example.test/preview/build-job-1/index.html',
        createdAt: '2026-06-27T00:00:00.000Z'
      },
      currentVersionId: 'project-version-1',
      activePreviewSnapshot: {
        id: 'preview-snapshot-1',
        projectId: project.id,
        projectVersionId: 'project-version-1',
        buildJobId: 'build-job-1',
        status: 'ready',
        path: '/tmp/atoms-cp-previews/project-1/v1',
        url: 'https://atoms-api.example.test/preview/preview-snapshot-1/index.html',
        active: true,
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:00.000Z'
      },
      githubConfigured: true,
      supabaseConfigured: false,
      supabaseFrontendEnvConfirmed: false
    });

    expect(ready).toMatchObject({
      canPublish: true,
      activePreviewSnapshotId: 'preview-snapshot-1',
      currentVersionId: 'project-version-1',
      blockingReasons: []
    });
  });

  it('blocks deploy env readiness until Supabase frontend env vars are confirmed', () => {
    const blocked = createProjectPublishState({
      project,
      currentVersionId: 'project-version-1',
      githubConfigured: true,
      supabaseConfigured: true,
      supabaseFrontendEnvConfirmed: false
    });
    expect(blocked.checklist.find((item) => item.id === 'env')).toMatchObject({
      status: 'blocked'
    });

    const passed = createProjectPublishState({
      project,
      currentVersionId: 'project-version-1',
      githubConfigured: true,
      supabaseConfigured: true,
      supabaseFrontendEnvConfirmed: true
    });
    expect(passed.checklist.find((item) => item.id === 'env')).toMatchObject({
      status: 'passed'
    });
  });
});
