import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodexTaskSpec } from '@atoms-cp/shared';
import { createInMemoryStore } from '../data/inMemoryStore.js';
import { createDockerExecutionAdapter, type DockerCodexCommand } from './dockerExecutionAdapter.js';
import { processNextCodexTask } from './dryRunCodexWorker.js';

const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-codex-worker-test-'));
  roots.push(root);
  return root;
}

function createTaskSpec(): CodexTaskSpec {
  return {
    goal: 'Create a quiet dashboard.',
    appSpec: {
      appName: '销售数据看板',
      appGoal: '帮助运营团队查看销售趋势',
      targetUser: '运营团队',
      pages: [
        {
          id: 'home',
          name: '首页',
          route: '/',
          purpose: '展示销售指标',
          sections: [
            {
              id: 'hero',
              kind: 'stats',
              title: '销售总览',
              content: '展示核心销售指标。'
            }
          ],
          actions: []
        }
      ],
      styleIntent: {
        tone: 'calm',
        layoutDensity: 'comfortable'
      },
      dataModels: [],
      integrations: [],
      constraints: [],
      nonGoals: [],
      acceptanceCriteria: ['可以看到销售指标']
    },
    designProfile: {
      id: 'quiet-dashboard',
      name: 'Quiet Dashboard',
      description: '低噪音运营看板。',
      bestFor: '运营后台',
      designTokens: {
        colors: {
          background: '#F8F8F6',
          foreground: '#171A1F',
          primary: '#315CF6',
          secondary: '#EEF3FF',
          muted: '#667085',
          border: '#E7E8EC',
          accent: '#20B26B'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          scale: 'comfortable'
        },
        radius: 'lg',
        shadow: 'subtle',
        density: 'balanced'
      },
      layoutGuidelines: ['Use quiet hierarchy.'],
      componentGuidelines: ['Use light cards.'],
      previewDescription: '安静的看板界面。'
    },
    targetChange: {
      type: 'initial_generate',
      summary: 'Generate initial app.'
    },
    allowedPaths: ['src/**', 'index.html', 'ai-manifest.json'],
    forbiddenPaths: ['.env', 'node_modules/**', 'dist/**', '.git/**', '../**', '/**'],
    dependencyPolicy: 'forbid_new_dependencies',
    validationCommands: ['pnpm typecheck', 'pnpm build'],
    expectedOutputs: ['Vite app files', 'ai-manifest.json']
  };
}

function mountedWorkspacePath(command: DockerCodexCommand): string {
  const mount = command.args.find((arg) => arg.startsWith('type=bind,source='));
  const source = mount?.match(/source=([^,]+)/)?.[1];

  if (!source) {
    throw new Error('Missing workspace mount in test Docker command.');
  }

  return source;
}

describe('processNextCodexTask deterministic worker', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('turns a queued CodexTask into a versioned workspace, project files, trace events, and build job', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-fitness',
      path: join(root, 'demo-fitness', 'workspace'),
      status: 'ready'
    });
    const taskSpec = createTaskSpec();
    const task = await store.createCodexTask({
      projectId: 'demo-fitness',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured task summary',
      taskSpec,
      allowedPaths: taskSpec.allowedPaths,
      forbiddenPaths: taskSpec.forbiddenPaths,
      validationCommands: taskSpec.validationCommands
    });

    const processed = await processNextCodexTask(store, {
      workerId: 'deterministic-worker-1',
      workspaceRoot: root
    });

    const updatedTask = await store.getCodexTask(task.id);
    const updatedWorkspace = await store.getWorkspace(workspace.id);
    const files = await store.listProjectFiles('demo-fitness');
    const buildJob = await store.getLatestBuildJob('demo-fitness');
    const traces = await store.listTraceEvents('demo-fitness', 10);

    expect(processed).toMatchObject({
      taskId: task.id,
      projectId: 'demo-fitness',
      status: 'succeeded'
    });
    expect(updatedTask).toMatchObject({
      status: 'succeeded',
      resultSummary: expect.stringContaining('Codex worker prepared')
    });
    expect(updatedTask?.projectVersionId).toBeDefined();
    expect(updatedWorkspace).toMatchObject({
      status: 'ready',
      projectVersionId: updatedTask?.projectVersionId
    });
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining(['src/App.tsx', 'ai-manifest.json']));
    expect(files.some((file) => file.path === '.env')).toBe(false);
    expect(buildJob).toMatchObject({
      projectVersionId: updatedTask?.projectVersionId,
      status: 'queued'
    });
    expect(traces.map((event) => event.type)).toEqual(
      expect.arrayContaining(['codex_task_claimed', 'workspace_locked', 'codex_task_completed'])
    );
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'codex_task_claimed',
        visibility: 'user',
        message: '正在编写应用。'
      }),
      expect.objectContaining({
        type: 'codex_task_completed',
        visibility: 'user',
        message: '应用代码已生成，正在准备预览快照。'
      })
    ]));
  });

  it('writes safe execution progress callbacks as user-visible trace events', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-progress',
      path: join(root, 'demo-progress', 'workspace'),
      status: 'ready'
    });
    const taskSpec = createTaskSpec();
    await store.createCodexTask({
      projectId: 'demo-progress',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured task summary',
      taskSpec,
      allowedPaths: taskSpec.allowedPaths,
      forbiddenPaths: taskSpec.forbiddenPaths,
      validationCommands: taskSpec.validationCommands
    });

    await processNextCodexTask(store, {
      workerId: 'progress-worker-1',
      workspaceRoot: root,
      executionAdapter: {
        name: 'progress-test-adapter',
        execute: async ({ workspace: activeWorkspace, onProgress }) => {
          await onProgress?.({
            stage: 'coding_app',
            stepKey: 'read_task',
            status: 'progress',
            message: '正在读取任务说明。'
          });
          await onProgress?.({
            stage: 'coding_app',
            stepKey: 'unsafe',
            status: 'progress',
            message: 'Docker wrote /tmp/workspace with sk-test-secret'
          });
          await mkdir(join(activeWorkspace.path, 'src'), { recursive: true });
          await writeFile(join(activeWorkspace.path, 'src/App.tsx'), '<main data-ai-id="home.title">销售数据看板</main>', 'utf8');
          await writeFile(join(activeWorkspace.path, 'ai-manifest.json'), JSON.stringify({
            entries: {
              'home.title': {
                aiId: 'home.title',
                file: 'src/App.tsx',
                component: 'App',
                elementType: 'heading',
                editable: ['text']
              }
            }
          }), 'utf8');
          return {
            summary: 'progress test completed',
            changedFiles: ['src/App.tsx', 'ai-manifest.json']
          };
        }
      }
    });

    const userTraces = (await store.listTraceEvents('demo-progress', 20)).filter((event) => event.visibility === 'user');
    expect(userTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'codex_task_progress',
        message: '正在读取任务说明。',
        payload: expect.objectContaining({
          stepKey: 'read_task',
          status: 'progress'
        })
      })
    ]));
    expect(JSON.stringify(userTraces)).not.toMatch(/Docker|workspace|\/tmp|sk-test-secret/i);
  });

  it('marks the task failed and unlocks workspace when taskSpec is missing', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-fitness',
      path: join(root, 'demo-fitness', 'workspace'),
      status: 'ready'
    });
    const task = await store.createCodexTask({
      projectId: 'demo-fitness',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured task summary',
      allowedPaths: ['src/**'],
      forbiddenPaths: ['.env'],
      validationCommands: ['pnpm build']
    });

    const processed = await processNextCodexTask(store, {
      workerId: 'deterministic-worker-1',
      workspaceRoot: root
    });

    expect(processed).toMatchObject({
      taskId: task.id,
      status: 'failed'
    });
    expect((await store.getCodexTask(task.id))?.errorSummary).toContain('taskSpec');
    expect((await store.getWorkspace(workspace.id))?.status).toBe('ready');
    expect(await store.listTraceEvents('demo-fitness', 10)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        visibility: 'user',
        message: '应用生成失败，请稍后重试。'
      })
    ]));
  });

  it('queues a bounded repair task when initial generation fails before build', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-fitness',
      path: join(root, 'demo-fitness', 'workspace'),
      status: 'ready'
    });
    const taskSpec = createTaskSpec();
    const task = await store.createCodexTask({
      projectId: 'demo-fitness',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured task summary',
      taskSpec,
      allowedPaths: taskSpec.allowedPaths,
      forbiddenPaths: taskSpec.forbiddenPaths,
      validationCommands: taskSpec.validationCommands
    });

    const processed = await processNextCodexTask(store, {
      workerId: 'repair-worker-1',
      workspaceRoot: root,
      executionAdapter: {
        name: 'failing-repair-test-adapter',
        execute: async () => {
          throw new Error('Container wrote invalid output under /tmp/workspace with stdout');
        }
      }
    });
    const tasks = await store.listCodexTasks('demo-fitness');
    const repairTask = tasks.find((item) => item.taskType === 'repair');
    const userTraces = (await store.listTraceEvents('demo-fitness', 20)).filter((event) => event.visibility === 'user');

    expect(processed).toMatchObject({
      taskId: task.id,
      status: 'failed'
    });
    expect(repairTask).toMatchObject({
      taskType: 'repair',
      status: 'queued',
      projectVersionId: task.projectVersionId
    });
    expect(repairTask?.allowedPaths).toEqual(['src/**', 'index.html', 'ai-manifest.json']);
    expect(JSON.stringify(repairTask)).not.toMatch(/\/tmp|stdout/i);
    expect(userTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: '正在自动修复生成结果。'
      })
    ]));
  });

  it('does not create another repair task when a repair task fails', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-fitness',
      path: join(root, 'demo-fitness', 'repair-workspace'),
      status: 'ready'
    });
    const taskSpec = createTaskSpec();
    const repairSpec = {
      ...taskSpec,
      targetChange: {
        type: 'repair' as const,
        summary: 'Repair invalid output.'
      }
    };
    const repairTask = await store.createCodexTask({
      projectId: 'demo-fitness',
      workspaceId: workspace.id,
      taskType: 'repair',
      objective: 'Repair app shell',
      inputSummary: 'Repair failed generation',
      taskSpec: repairSpec,
      allowedPaths: repairSpec.allowedPaths,
      forbiddenPaths: repairSpec.forbiddenPaths,
      validationCommands: repairSpec.validationCommands
    });

    await processNextCodexTask(store, {
      workerId: 'repair-worker-1',
      workspaceRoot: root,
      executionAdapter: {
        name: 'failing-repair-test-adapter',
        execute: async () => {
          throw new Error('Repair failed with secret-looking TOKEN text');
        }
      }
    });
    const tasks = await store.listCodexTasks('demo-fitness');
    const userTraces = (await store.listTraceEvents('demo-fitness', 20)).filter((event) => event.visibility === 'user');

    expect((await store.getCodexTask(repairTask.id))?.status).toBe('failed');
    expect(tasks.filter((item) => item.taskType === 'repair')).toHaveLength(1);
    expect(userTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: '自动修复未完成，请简化需求或分步修改。'
      })
    ]));
    expect(JSON.stringify(userTraces)).not.toMatch(/TOKEN|secret|stdout|stderr|workspace/i);
  });

  it('fails low-quality generic output and schedules repair before saving a preview build', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-real',
      path: join(root, 'demo-real', 'workspace'),
      status: 'ready'
    });
    const taskSpec = createTaskSpec();
    await store.createCodexTask({
      projectId: 'demo-real',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured task summary',
      taskSpec,
      allowedPaths: taskSpec.allowedPaths,
      forbiddenPaths: taskSpec.forbiddenPaths,
      validationCommands: taskSpec.validationCommands
    });

    const processed = await processNextCodexTask(store, {
      workerId: 'quality-worker-1',
      workspaceRoot: root,
      executionAdapter: {
        name: 'generic-output-test-adapter',
        execute: async ({ workspace: activeWorkspace }) => {
          await mkdir(join(activeWorkspace.path, 'src'), { recursive: true });
          await writeFile(join(activeWorkspace.path, 'src/App.tsx'), '<main data-ai-id="home.generic">用户需求已整理为结构化产品规格。</main>', 'utf8');
          await writeFile(join(activeWorkspace.path, 'ai-manifest.json'), JSON.stringify({
            entries: {
              'home.generic': {
                aiId: 'home.generic',
                file: 'src/App.tsx',
                component: 'App',
                elementType: 'paragraph',
                editable: ['text']
              }
            }
          }), 'utf8');
          return {
            summary: 'Generic output',
            changedFiles: ['src/App.tsx', 'ai-manifest.json']
          };
        }
      }
    });

    expect(processed).toMatchObject({
      status: 'failed'
    });
    expect(await store.getLatestBuildJob('demo-real')).toBeUndefined();
    expect((await store.listCodexTasks('demo-real')).some((item) => item.taskType === 'repair')).toBe(true);
  });

  it('processes a fake real Docker adapter result through version and build queue creation', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-real',
      path: join(root, 'demo-real', 'workspace'),
      status: 'ready'
    });
    const taskSpec = createTaskSpec();
    const task = await store.createCodexTask({
      projectId: 'demo-real',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured task summary',
      taskSpec,
      allowedPaths: taskSpec.allowedPaths,
      forbiddenPaths: taskSpec.forbiddenPaths,
      validationCommands: taskSpec.validationCommands
    });
    const executionAdapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      runCommand: async (command) => {
        await writeFile(join(mountedWorkspacePath(command), 'src', 'real-output.ts'), 'export const realOutput = true;\n', 'utf8');
        return {
          exitCode: 0,
          stdout: 'ok',
          stderr: ''
        };
      }
    });

    const processed = await processNextCodexTask(store, {
      workerId: 'docker-worker-1',
      workspaceRoot: root,
      executionAdapter
    });

    const updatedTask = await store.getCodexTask(task.id);
    const buildJob = await store.getLatestBuildJob('demo-real');

    expect(processed).toMatchObject({
      taskId: task.id,
      status: 'succeeded',
      buildJobId: buildJob?.id
    });
    expect(updatedTask?.resultSummary).toContain('Docker Codex real executor completed');
    expect(buildJob).toMatchObject({
      projectVersionId: updatedTask?.projectVersionId,
      status: 'queued'
    });
  });

  it('fails and unlocks the workspace when real Docker output violates policy', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const root = await makeRoot();
    const workspace = await store.createWorkspace({
      projectId: 'demo-real-fail',
      path: join(root, 'demo-real-fail', 'workspace'),
      status: 'ready'
    });
    const taskSpec = createTaskSpec();
    const task = await store.createCodexTask({
      projectId: 'demo-real-fail',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured task summary',
      taskSpec,
      allowedPaths: taskSpec.allowedPaths,
      forbiddenPaths: taskSpec.forbiddenPaths,
      validationCommands: taskSpec.validationCommands
    });
    const executionAdapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      runCommand: async (command) => {
        const mountedWorkspace = mountedWorkspacePath(command);
        await mkdir(join(mountedWorkspace, 'dist'), { recursive: true });
        await writeFile(join(mountedWorkspace, 'dist', 'bundle.js'), 'unsafe', 'utf8');
        return {
          exitCode: 0,
          stdout: 'ok',
          stderr: ''
        };
      }
    });

    const processed = await processNextCodexTask(store, {
      workerId: 'docker-worker-1',
      workspaceRoot: root,
      executionAdapter
    });

    const updatedTask = await store.getCodexTask(task.id);
    const updatedWorkspace = await store.getWorkspace(workspace.id);
    const traces = await store.listTraceEvents('demo-real-fail', 10);

    expect(processed).toMatchObject({
      taskId: task.id,
      status: 'failed'
    });
    expect(updatedTask?.errorSummary).toContain('workspace safety policy');
    expect(updatedTask?.errorSummary).not.toContain(root);
    expect(updatedWorkspace?.status).toBe('ready');
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        visibility: 'admin'
      })
    ]));
    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        visibility: 'user',
        message: '生成结果未通过安全检查，已停止本次修改。'
      })
    ]));
    expect(JSON.stringify(traces.filter((trace) => trace.visibility === 'user'))).not.toMatch(/Docker|pnpm|stdout|stderr|workspace|node_modules|\/tmp/i);
  });
});
