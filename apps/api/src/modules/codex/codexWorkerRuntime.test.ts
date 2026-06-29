import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryStore } from '../data/inMemoryStore.js';
import { processCodexWorkerTick, startCodexWorkerLoop } from './codexWorkerRuntime.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('codexWorkerRuntime', () => {
  it('runs one deterministic tick with the default adapter path', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const processNextCodexTask = vi.fn().mockResolvedValue(undefined);

    const result = await processCodexWorkerTick(store, {
      workerId: 'codex-worker-1',
      mode: 'deterministic',
      workspaceRoot: '/tmp/atoms-cp-workspaces',
      processNextCodexTask
    });

    expect(result).toBeUndefined();
    expect(processNextCodexTask).toHaveBeenCalledWith(store, {
      workerId: 'codex-worker-1',
      workspaceRoot: '/tmp/atoms-cp-workspaces',
      executionAdapter: undefined
    });
  });

  it('creates a Docker execution adapter only when docker mode is selected', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const processNextCodexTask = vi.fn().mockResolvedValue({
      taskId: 'codex-task-1',
      projectId: 'project-1',
      status: 'succeeded'
    });

    const result = await processCodexWorkerTick(store, {
      workerId: 'codex-worker-1',
      mode: 'docker',
      workspaceRoot: '/tmp/atoms-cp-workspaces',
      dockerImage: 'node:22-alpine',
      dockerTimeoutMs: 90000,
      dockerLogMaxBytes: 4096,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      dockerNetworkMode: 'bridge',
      outputMaxFiles: 50,
      outputMaxBytes: 1048576,
      executionEnvAllowlist: ['SAFE_FLAG'],
      realPreflightOnly: true,
      processNextCodexTask
    });

    expect(result?.status).toBe('succeeded');
    expect(processNextCodexTask).toHaveBeenCalledWith(store, expect.objectContaining({
      workerId: 'codex-worker-1',
      workspaceRoot: '/tmp/atoms-cp-workspaces',
      executionAdapter: expect.objectContaining({
        name: 'docker_real'
      })
    }));
  });

  it('creates a container execution adapter when container mode is selected', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const processNextCodexTask = vi.fn().mockResolvedValue({
      taskId: 'codex-task-1',
      projectId: 'project-1',
      status: 'succeeded'
    });

    const result = await processCodexWorkerTick(store, {
      workerId: 'codex-worker-1',
      mode: 'container',
      workspaceRoot: '/tmp/atoms-cp-workspaces',
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretMountPath: '/run/secrets/volcengine_api_key',
      outputMaxFiles: 50,
      outputMaxBytes: 1048576,
      processNextCodexTask
    });

    expect(result?.status).toBe('succeeded');
    expect(processNextCodexTask).toHaveBeenCalledWith(store, expect.objectContaining({
      workerId: 'codex-worker-1',
      workspaceRoot: '/tmp/atoms-cp-workspaces',
      executionAdapter: expect.objectContaining({
        name: 'container_real'
      })
    }));
  });

  it('continues stale recovery ticks while a long-running task is still processing', async () => {
    vi.useFakeTimers();
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const recoverStaleRuntime = vi.fn().mockResolvedValue({
      codexTasks: [],
      buildJobs: []
    });
    let resolveProcessing: (() => void) | undefined;
    const processNextCodexTask = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveProcessing = () => resolve(undefined);
    }));
    const logs: Array<Record<string, unknown>> = [];
    const timer = startCodexWorkerLoop(store, {
      workerId: 'codex-worker-1',
      mode: 'deterministic',
      intervalMs: 50,
      workspaceRoot: '/tmp/atoms-cp-workspaces',
      codexTaskStaleMs: 900000,
      buildJobStaleMs: 900000,
      recoverStaleRuntime,
      processNextCodexTask,
      onLog: (entry) => logs.push(entry)
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(processNextCodexTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);

    expect(processNextCodexTask).toHaveBeenCalledTimes(1);
    expect(recoverStaleRuntime.mock.calls.length).toBeGreaterThan(1);

    resolveProcessing?.();
    await vi.runOnlyPendingTimersAsync();
    clearInterval(timer);
  });
});
