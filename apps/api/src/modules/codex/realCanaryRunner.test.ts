import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryStore } from '../data/inMemoryStore.js';
import type { DockerCodexCommand } from './dockerExecutionAdapter.js';
import {
  reportRealCanary,
  runRealCanary,
  type RealCanaryConfig
} from './realCanaryRunner.js';

const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-real-canary-test-'));
  roots.push(root);
  return root;
}

function mountedWorkspacePath(command: DockerCodexCommand): string {
  const mount = command.args.find((arg) => arg.startsWith('type=bind,source=') && arg.includes('target=/workspace/project'));
  const source = mount?.match(/source=([^,]+)/)?.[1];

  if (!source) {
    throw new Error('Missing workspace mount in test Docker command.');
  }

  return source;
}

function createConfig(root: string, overrides: Partial<RealCanaryConfig> = {}): RealCanaryConfig {
  return {
    workerId: 'real-canary-worker',
    workspaceRoot: join(root, 'workspaces'),
    workerMode: 'docker',
    dockerImage: 'node:22-alpine',
    dockerTimeoutMs: 120000,
    dockerLogMaxBytes: 65536,
    realExecutionEnabled: true,
    realCommand: 'node /runner/real-codex.js',
    dockerNetworkMode: 'bridge',
    outputMaxFiles: 200,
    outputMaxBytes: 5242880,
    executionEnvAllowlist: [],
    realPreflightOnly: false,
    realCanaryEnabled: true,
    secretMountPath: join(root, 'codex-api-key.secret'),
    taskLimitPerRun: 1,
    dailyBudgetTasks: 3,
    realMaxRuntimeMs: 600000,
    autoDisableOnFailure: true,
    ...overrides
  };
}

describe('real canary runner', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('creates and processes a dedicated real canary task without claiming normal queued work', async () => {
    const root = await makeRoot();
    const store = createInMemoryStore(() => new Date());
    const config = createConfig(root);
    await writeFile(config.secretMountPath, 'sk-test-secret-value', 'utf8');
    const normal = await store.createCodexTask({
      projectId: 'project-normal',
      taskType: 'initial_generate',
      objective: 'Normal queued user task',
      inputSummary: 'Normal task should not be claimed by real canary.',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });

    const result = await runRealCanary(store, config, {
      runCommand: async (command) => {
        const serialized = command.args.join(' ');
        expect(serialized).toContain('target=/run/secrets/codex_api_key,readonly');
        expect(serialized).not.toContain('sk-test-secret-value');
        await writeFile(join(mountedWorkspacePath(command), 'src', 'real-canary-output.ts'), 'export const canary = true;\n', 'utf8');
        return {
          exitCode: 0,
          stdout: 'real canary ok',
          stderr: ''
        };
      }
    });

    const normalAfter = await store.getCodexTask(normal.id);
    const canaryTask = result.taskId ? await store.getCodexTask(result.taskId) : undefined;
    const canaryReport = await reportRealCanary(store);

    expect(result).toMatchObject({
      status: 'succeeded',
      buildJobId: expect.any(String),
      projectVersionId: expect.any(String)
    });
    expect(normalAfter?.status).toBe('queued');
    expect(canaryTask?.objective).toContain('[real-canary]');
    expect(canaryTask?.resultSummary).toContain('Docker Codex real executor completed');
    expect(JSON.stringify(canaryReport)).not.toContain('sk-test-secret-value');
    expect(canaryReport.latestTask).toMatchObject({
      id: result.taskId,
      status: 'succeeded'
    });
  });

  it('blocks canary runs after the daily task budget is consumed', async () => {
    const root = await makeRoot();
    const store = createInMemoryStore(() => new Date());
    const config = createConfig(root, {
      dailyBudgetTasks: 1,
      autoDisableOnFailure: false
    });
    await writeFile(config.secretMountPath, 'sk-test-secret-value', 'utf8');
    const existing = await store.createCodexTask({
      projectId: 'project-canary-existing',
      taskType: 'initial_generate',
      objective: '[real-canary] Existing staging task',
      inputSummary: '[real-canary] Existing canary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    await store.updateCodexTask(existing.id, {
      status: 'succeeded',
      resultSummary: 'Docker Codex real executor completed.'
    });

    await expect(runRealCanary(store, config)).rejects.toThrow(/daily canary budget/i);
  });

  it('auto-disables canary runs after the latest canary failure', async () => {
    const root = await makeRoot();
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const failed = await store.createCodexTask({
      projectId: 'project-canary-failed',
      taskType: 'initial_generate',
      objective: '[real-canary] Failed staging task',
      inputSummary: '[real-canary] Existing failed canary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    await store.updateCodexTask(failed.id, {
      status: 'failed',
      errorSummary: 'Previous canary failed.'
    });

    await expect(runRealCanary(store, createConfig(root))).rejects.toThrow(/auto-disabled/i);
  });
});
