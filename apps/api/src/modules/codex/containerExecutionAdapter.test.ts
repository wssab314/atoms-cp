import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodexTaskRecord, CodexTaskSpec, WorkspaceRecord } from '@atoms-cp/shared';
import {
  createContainerExecutionAdapter,
  runContainerCommand,
  type ContainerCodexCommand
} from './containerExecutionAdapter.js';

const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-container-adapter-test-'));
  roots.push(root);
  return root;
}

function createTaskSpec(): CodexTaskSpec {
  return {
    goal: 'Create a quiet personal site.',
    appSpec: {
      appName: '个人网站',
      appGoal: '展示个人介绍、作品和联系方式',
      targetUser: '个人访客和潜在合作方',
      pages: [
        {
          id: 'home',
          name: '首页',
          route: '/',
          purpose: '展示个人品牌',
          sections: [
            {
              id: 'hero',
              kind: 'hero',
              title: '个人介绍',
              content: '展示个人简介。'
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
      acceptanceCriteria: ['访客可以了解个人信息']
    },
    designProfile: {
      id: 'quiet-personal',
      name: 'Quiet Personal',
      description: '安静的个人网站。',
      bestFor: '个人主页',
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
      previewDescription: '安静的个人网站。'
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

function createTask(taskSpec: CodexTaskSpec): CodexTaskRecord {
  return {
    id: 'codex-task-1',
    projectId: 'project-1',
    taskType: 'initial_generate',
    status: 'claimed',
    objective: 'Create app shell',
    inputSummary: 'Structured summary',
    taskSpec,
    allowedPaths: taskSpec.allowedPaths,
    forbiddenPaths: taskSpec.forbiddenPaths,
    validationCommands: taskSpec.validationCommands,
    attemptCount: 1,
    claimedBy: 'worker-1',
    claimedAt: '2026-06-28T00:00:00.000Z',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z'
  };
}

function createWorkspace(path: string): WorkspaceRecord {
  return {
    id: 'workspace-1',
    projectId: 'project-1',
    path,
    status: 'locked',
    lockedBy: 'worker-1',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z'
  };
}

describe('ContainerExecutionAdapter', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('runs a real command inside the worker container without exposing prompt or key values in argv', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const commands: ContainerCodexCommand[] = [];
    let taskInstruction = '';
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async (command) => {
        commands.push(command);
        const taskInstructionPath = command.env.CODEX_TASK_INSTRUCTION_FILE;

        if (!taskInstructionPath) {
          throw new Error('CODEX_TASK_INSTRUCTION_FILE was not set.');
        }

        taskInstruction = await readFile(taskInstructionPath, 'utf8');
        await writeFile(join(command.cwd, 'src', 'container-output.ts'), 'export const containerOutput = true;\n', 'utf8');
        return {
          exitCode: 0,
          stdout: 'container command ok',
          stderr: ''
        };
      }
    });

    const result = await adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    });

    expect(result.summary).toContain('Container Codex real executor completed');
    expect(result.changedFiles).toEqual(['src/container-output.ts']);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.cwd).toBe(workspacePath);
    expect(commands[0]?.env.CODEX_CONTAINER_EXECUTION).toBe('1');
    expect(commands[0]?.env.CODEX_PROJECT_DIR).toBe(workspacePath);
    expect(commands[0]?.env.CODEX_SECRET_FILE).toBe('/run/secrets/volcengine_api_key');
    expect(commands[0]?.env.CODEX_TASK_INSTRUCTION_FILE).toMatch(/task-instruction\.json$/);
    expect(commands[0]?.env.PATH).toContain('atoms-cp-blocked-bin-');
    expect(commands[0]?.args.join(' ')).toContain('/app/scripts/codex-doubao21-exec.sh');
    expect(commands[0]?.args.join(' ')).not.toContain(taskSpec.goal);
    expect(commands[0]?.args.join(' ')).not.toContain('个人网站');
    expect(JSON.stringify(commands[0]?.env)).not.toContain('ark-');
    expect(taskInstruction).not.toContain('validationCommands');
    expect(taskInstruction).toContain('platformValidation');
    expect(taskInstruction).toContain('Do not run package installation');
  });

  it('emits heartbeat progress and stops an idle command before the hard timeout', async () => {
    const root = await makeRoot();
    const progressEvents: Array<{ message: string; stepKey: string; status: string }> = [];
    const result = await runContainerCommand({
      file: 'sh',
      args: ['-lc', 'sleep 0.25'],
      cwd: root,
      env: {
        PATH: process.env.PATH ?? ''
      },
      timeoutMs: 2_000,
      idleTimeoutMs: 80,
      heartbeatMs: 30,
      maxLogBytes: 4096
    }, async (event) => {
      progressEvents.push({
        message: event.message,
        stepKey: event.stepKey,
        status: event.status
      });
    });

    expect(result).toMatchObject({
      exitCode: 124,
      timedOut: true,
      timeoutReason: 'idle'
    });
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepKey: 'execution_heartbeat',
        message: '仍在编写应用，请稍候。'
      })
    ]));
  });

  it('does not let raw command output reset the safe-progress idle watchdog', async () => {
    const root = await makeRoot();
    const result = await runContainerCommand({
      file: 'sh',
      args: ['-lc', 'while true; do echo "raw implementation log"; sleep 0.03; done'],
      cwd: root,
      env: {
        PATH: process.env.PATH ?? ''
      },
      timeoutMs: 2_000,
      idleTimeoutMs: 120,
      heartbeatMs: 40,
      maxLogBytes: 4096
    });

    expect(result).toMatchObject({
      exitCode: 124,
      timedOut: true,
      timeoutReason: 'idle'
    });
    expect(result.stdout).toContain('raw implementation log');
  });

  it('salvages valid generated output after a timeout terminates the command', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async (command) => {
        await writeFile(join(command.cwd, 'src', 'container-output.ts'), 'export const containerOutput = true;\n', 'utf8');
        return {
          exitCode: 124,
          stdout: 'still running when stopped',
          stderr: '',
          timedOut: true,
          timeoutReason: 'idle'
        };
      }
    });

    const result = await adapter.execute({
      task: createTask(createTaskSpec()),
      workspace: createWorkspace(workspacePath)
    });

    expect(result.summary).toContain('validated after stopping a stalled execution');
    expect(result.changedFiles).toEqual(['src/container-output.ts']);
  });

  it('fails timed-out output when the generated files violate safety checks', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async (command) => {
        await mkdir(join(command.cwd, 'dist'), { recursive: true });
        await writeFile(join(command.cwd, 'dist', 'bundle.js'), 'unsafe build output', 'utf8');
        return {
          exitCode: 124,
          stdout: '',
          stderr: '',
          timedOut: true,
          timeoutReason: 'idle'
        };
      }
    });

    await expect(adapter.execute({
      task: createTask(createTaskSpec()),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/workspace safety policy: dist/);
  });

  it('forwards only safe ATOMS_PROGRESS events from command output', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const progressEvents: Array<{ message: string; stepKey: string; status: string }> = [];
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async (command) => {
        await writeFile(join(command.cwd, 'src', 'container-output.ts'), 'export const containerOutput = true;\n', 'utf8');
        return {
          exitCode: 0,
          stdout: [
            'ATOMS_PROGRESS {"stage":"coding_app","stepKey":"read_task","status":"progress","message":"正在读取任务说明。"}',
            'ATOMS_PROGRESS {"stage":"coding_app","stepKey":"unsafe","status":"progress","message":"Docker wrote /tmp/workspace with sk-test-secret"}',
            'ordinary CLI output should stay admin-only'
          ].join('\n'),
          stderr: 'ATOMS_PROGRESS {"stage":"validating","stepKey":"check_result","status":"progress","message":"正在检查生成结果。"}'
        };
      }
    });

    await adapter.execute({
      task: createTask(createTaskSpec()),
      workspace: createWorkspace(workspacePath),
      onProgress: async (event) => {
        progressEvents.push({
          message: event.message,
          stepKey: event.stepKey,
          status: event.status
        });
      }
    });

    expect(progressEvents.map((event) => event.message)).toEqual(expect.arrayContaining([
      '正在读取任务说明。',
      '正在检查生成结果。'
    ]));
    expect(JSON.stringify(progressEvents)).not.toMatch(/Docker|workspace|\/tmp|sk-test-secret|ordinary CLI/i);
  });

  it('blocks real execution while preflight-only mode remains enabled', async () => {
    const root = await makeRoot();
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      secretFilePath: '/run/secrets/volcengine_api_key'
    });

    await expect(adapter.execute({
      task: createTask(createTaskSpec()),
      workspace: createWorkspace(join(root, 'workspace'))
    })).rejects.toThrow(/preflight-only/);
  });

  it('normalizes common manifest editable aliases before validating real output', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async (command) => {
        await writeFile(join(command.cwd, 'src', 'container-output.ts'), 'export const containerOutput = true;\n', 'utf8');
        await writeFile(
          join(command.cwd, 'ai-manifest.json'),
          JSON.stringify({
            entries: {
              'home.hero.title': {
                aiId: 'home.hero.title',
                file: 'src/App.tsx',
                component: 'App',
                elementType: 'heading',
                editable: ['label', 'items']
              }
            }
          }),
          'utf8'
        );
        return {
          exitCode: 0,
          stdout: 'container command ok',
          stderr: ''
        };
      }
    });

    await adapter.execute({
      task: createTask(createTaskSpec()),
      workspace: createWorkspace(workspacePath)
    });

    const manifest = JSON.parse(await readFile(join(workspacePath, 'ai-manifest.json'), 'utf8')) as {
      entries: Record<string, { editable: string[] }>;
    };
    expect(manifest.entries['home.hero.title']?.editable).toEqual(['text']);
  });

  it('rejects forbidden artifacts and redacts paths from failed command logs', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      maxLogBytes: 4096,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async (command) => {
        await mkdir(join(command.cwd, 'dist'), { recursive: true });
        await writeFile(join(command.cwd, 'dist', 'bundle.js'), 'unsafe build output', 'utf8');
        return {
          exitCode: 0,
          stdout: `wrote ${command.cwd}`,
          stderr: ''
        };
      }
    });

    await expect(adapter.execute({
      task: createTask(createTaskSpec()),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/workspace safety policy: dist/);

    const failingAdapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      maxLogBytes: 4096,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async (command) => ({
        exitCode: 1,
        stdout: '',
        stderr: `failed inside ${command.cwd} with sk-test-secret and /run/secrets/volcengine_api_key`
      })
    });

    try {
      await failingAdapter.execute({
        task: createTask(createTaskSpec()),
        workspace: createWorkspace(join(root, 'workspace-failure'))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('[workspace]');
      expect(message).toContain('[secret]');
      expect(message).not.toContain(root);
      expect(message).not.toContain('/run/secrets/volcengine_api_key');
    }
  });

  it('writes the controlled template before execution', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const adapter = createContainerExecutionAdapter({
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: '/app/scripts/codex-doubao21-exec.sh',
      realPreflightOnly: false,
      secretFilePath: '/run/secrets/volcengine_api_key',
      runCommand: async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: ''
      })
    });

    await adapter.execute({
      task: createTask(createTaskSpec()),
      workspace: createWorkspace(workspacePath)
    });

    await expect(readFile(join(workspacePath, 'src', 'App.tsx'), 'utf8')).resolves.toContain('个人网站');
  });
});
