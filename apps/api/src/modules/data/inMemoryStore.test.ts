import { describe, expect, it } from 'vitest';
import { createInMemoryStore } from './inMemoryStore.js';

describe('createInMemoryStore runtime artifacts', () => {
  it('creates, updates, locks, and unlocks workspaces', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const workspace = await store.createWorkspace({
      projectId: 'project-1',
      path: '/tmp/atoms-cp-workspaces/project-1/main',
      status: 'ready'
    });

    expect(await store.listWorkspaces('project-1')).toEqual([workspace]);
    expect((await store.lockWorkspace(workspace.id, 'worker-1'))?.status).toBe('locked');
    expect((await store.unlockWorkspace(workspace.id))?.lockedBy).toBeUndefined();
    expect((await store.updateWorkspace(workspace.id, { errorSummary: 'disk full', status: 'failed' }))?.errorSummary).toBe('disk full');
  });

  it('lists project versions newest first with workspace lineage', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const initial = await store.saveGeneratedProject({
      projectId: 'project-1',
      summary: 'Initial app',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/version-1',
      files: [
        {
          path: 'src/App.tsx',
          content: '<h1 data-ai-id="home.hero.title">Demo</h1>',
          purpose: 'App shell'
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
    const patch = await store.saveProjectFilePatch({
      projectId: 'project-1',
      source: 'selector_edit',
      summary: 'Updated title',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/version-2',
      parentVersionId: initial.projectVersion.id,
      files: [
        {
          path: 'src/App.tsx',
          content: '<h1 data-ai-id="home.hero.title">Updated</h1>',
          purpose: 'Selector patch'
        }
      ]
    });

    expect(await store.listProjectVersions('project-1')).toEqual([patch.projectVersion, initial.projectVersion]);
    expect((await store.listProjectVersions('project-1'))[0]?.parentVersionId).toBe(initial.projectVersion.id);
  });

  it('creates, claims, updates, and lists Codex tasks', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const task = await store.createCodexTask({
      projectId: 'project-1',
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured AppSpec summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });

    expect(await store.listCodexTasks('project-1')).toEqual([task]);
    const claimed = await store.claimNextCodexTask('worker-1');
    expect(claimed?.id).toBe(task.id);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedBy).toBe('worker-1');
    expect(await store.claimNextCodexTask('worker-2')).toBeUndefined();

    const updated = await store.updateCodexTask(task.id, {
      status: 'succeeded',
      resultSummary: 'Generated first shell'
    });
    expect(updated?.status).toBe('succeeded');
    expect(await store.listRecentCodexTasks(1)).toEqual([updated]);
  });

  it('claims a specific queued Codex task without taking older normal work', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const normal = await store.createCodexTask({
      projectId: 'project-normal',
      taskType: 'initial_generate',
      objective: 'Normal user task',
      inputSummary: 'Normal queued work',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    const canary = await store.createCodexTask({
      projectId: 'project-canary',
      taskType: 'initial_generate',
      objective: '[real-canary] Staging task',
      inputSummary: '[real-canary] Internal staging canary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });

    const claimed = await store.claimCodexTask(canary.id, 'real-canary-worker');

    expect(claimed?.id).toBe(canary.id);
    expect((await store.getCodexTask(canary.id))?.status).toBe('claimed');
    expect((await store.getCodexTask(normal.id))?.status).toBe('queued');
  });

  it('lists stale active Codex tasks and stale queued or running build jobs', async () => {
    let current = new Date('2026-06-28T00:00:00.000Z');
    const store = createInMemoryStore(() => current);
    const task = await store.createCodexTask({
      projectId: 'project-1',
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured AppSpec summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    await store.claimNextCodexTask('worker-1');
    const buildJob = await store.createBuildJob('project-1', {});

    current = new Date('2026-06-28T00:20:00.000Z');

    expect(await store.listStaleCodexTasks('2026-06-28T00:15:00.000Z', 10)).toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'claimed'
      })
    ]);
    expect(await store.listStaleBuildJobs('2026-06-28T00:15:00.000Z', 10)).toEqual([
      expect.objectContaining({
        id: buildJob.id,
        status: 'queued'
      })
    ]);
  });

  it('skips queued Codex tasks for projects with an active writer', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const firstProjectTask = await store.createCodexTask({
      projectId: 'project-1',
      taskType: 'initial_generate',
      objective: 'Create first app shell',
      inputSummary: 'First structured summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    const blockedProjectTask = await store.createCodexTask({
      projectId: 'project-1',
      taskType: 'code_edit',
      objective: 'Edit first app shell',
      inputSummary: 'Second structured summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    const otherProjectTask = await store.createCodexTask({
      projectId: 'project-2',
      taskType: 'initial_generate',
      objective: 'Create second app shell',
      inputSummary: 'Other project summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });

    expect((await store.claimNextCodexTask('worker-1'))?.id).toBe(firstProjectTask.id);
    expect((await store.claimNextCodexTask('worker-2'))?.id).toBe(otherProjectTask.id);

    await store.updateCodexTask(firstProjectTask.id, {
      status: 'succeeded',
      resultSummary: 'Generated first shell'
    });

    expect((await store.claimNextCodexTask('worker-3'))?.id).toBe(blockedProjectTask.id);
  });

  it('creates preview snapshots, activates one snapshot, and records trace events', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const first = await store.createPreviewSnapshot({
      projectId: 'project-1',
      projectVersionId: 'version-1',
      status: 'ready',
      path: '/tmp/atoms-cp-previews/project-1/v1',
      url: 'https://preview.example.test/v1',
      active: true
    });
    const second = await store.createPreviewSnapshot({
      projectId: 'project-1',
      projectVersionId: 'version-2',
      status: 'ready',
      path: '/tmp/atoms-cp-previews/project-1/v2',
      url: 'https://preview.example.test/v2'
    });

    expect((await store.getLatestPreviewSnapshot('project-1'))?.id).toBe(second.id);
    expect((await store.activatePreviewSnapshot(second.id))?.active).toBe(true);
    expect((await store.listPreviewSnapshots('project-1')).find((snapshot) => snapshot.id === first.id)?.active).toBe(false);

    const event = await store.appendTraceEvent({
      projectId: 'project-1',
      type: 'preview_snapshot_created',
      visibility: 'admin',
      message: 'Snapshot created',
      payload: {
        snapshotId: second.id
      }
    });
    expect(await store.listTraceEvents('project-1', 5)).toEqual([event]);
    expect((await store.listRecentPreviewSnapshots(1))[0]?.id).toBe(second.id);
    expect(await store.listRecentTraceEvents(1)).toEqual([event]);
  });
});
