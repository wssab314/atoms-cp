import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodexTaskRecord, CodexTaskSpec, WorkspaceRecord } from '@atoms-cp/shared';
import {
  buildDockerCodexCommand,
  createDockerExecutionAdapter,
  type DockerCodexCommand
} from './dockerExecutionAdapter.js';

const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-docker-adapter-test-'));
  roots.push(root);
  return root;
}

function createTaskSpec(): CodexTaskSpec {
  return {
    goal: 'Create a quiet dashboard.',
    platform: 'web',
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

function mountedWorkspacePath(command: DockerCodexCommand): string {
  const mount = command.args.find((arg) => arg.startsWith('type=bind,source='));
  const source = mount?.match(/source=([^,]+)/)?.[1];

  if (!source) {
    throw new Error('Missing workspace mount in test Docker command.');
  }

  return source;
}

describe('DockerExecutionAdapter', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('builds a Docker command with only the current workspace mounted and no host secrets', () => {
    const command = buildDockerCodexCommand({
      image: 'node:22-alpine',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/task-1',
      timeoutMs: 120000,
      maxLogBytes: 65536,
      uid: 501,
      gid: 20
    });
    const serialized = command.args.join(' ');

    expect(command.file).toBe('docker');
    expect(command.timeoutMs).toBe(120000);
    expect(command.maxLogBytes).toBe(65536);
    expect(command.env).toEqual({ PATH: process.env.PATH ?? '' });
    expect(command.args).toEqual(expect.arrayContaining(['run', '--rm', '--network', 'none', '--user', '501:20']));
    expect(serialized).toContain('type=bind,source=/tmp/atoms-cp-workspaces/project-1/task-1,target=/workspace/project');
    expect(serialized).not.toContain('/var/run/docker.sock');
    expect(serialized).not.toContain('.env');
    expect(serialized).not.toContain(process.env.HOME ?? '__no_home__');
  });

  it('keeps real Docker Codex execution disabled unless the explicit feature flag is set', () => {
    const command = buildDockerCodexCommand({
      image: 'node:22-alpine',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/task-1',
      timeoutMs: 120000,
      maxLogBytes: 65536,
      realExecutionEnabled: false,
      uid: 501,
      gid: 20
    });

    expect(command.args.join(' ')).toContain('codex docker fixture ok');
    expect(command.args.join(' ')).not.toContain('npx codex');
    expect(command.args.join(' ')).not.toContain('codex exec');
  });

  it('requires an explicit real command before building a real execution command', () => {
    expect(() => buildDockerCodexCommand({
      image: 'node:22-alpine',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/task-1',
      timeoutMs: 120000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      uid: 501,
      gid: 20
    })).toThrow(/CODEX_REAL_COMMAND/);
  });

  it('builds the real command with network gating and a non-secret env allowlist', () => {
    const command = buildDockerCodexCommand({
      image: 'node:22-alpine',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/task-1',
      timeoutMs: 120000,
      maxLogBytes: 4096,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      networkMode: 'bridge',
      executionEnvAllowlist: ['SAFE_FLAG', 'HOME', 'MODEL_API_KEY', 'DOCKER_HOST'],
      hostEnv: {
        PATH: '/usr/bin',
        SAFE_FLAG: 'enabled',
        HOME: '/Users/aibu',
        MODEL_API_KEY: 'sk-secret-value',
        DOCKER_HOST: 'unix:///var/run/docker.sock'
      },
      uid: 501,
      gid: 20
    });
    const serialized = command.args.join(' ');

    expect(command.env).toEqual({
      PATH: '/usr/bin',
      SAFE_FLAG: 'enabled'
    });
    expect(command.args).toEqual(expect.arrayContaining(['--network', 'bridge', '--env', 'SAFE_FLAG']));
    expect(serialized).toContain('node /runner/real-codex.js');
    expect(serialized).not.toContain('sk-secret-value');
    expect(serialized).not.toContain('/Users/aibu');
    expect(serialized).not.toContain('/var/run/docker.sock');
  });

  it('mounts a configured real execution secret as a read-only file without exposing secret values', () => {
    const command = buildDockerCodexCommand({
      image: 'node:22-alpine',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/task-1',
      timeoutMs: 120000,
      maxLogBytes: 4096,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      networkMode: 'bridge',
      secretMountPath: '/run/secrets/atoms-cp-codex-api-key',
      hostEnv: {
        PATH: '/usr/bin'
      },
      uid: 501,
      gid: 20
    });
    const serialized = command.args.join(' ');

    expect(serialized).toContain('source=/run/secrets/atoms-cp-codex-api-key,target=/run/secrets/codex_api_key,readonly');
    expect(serialized).not.toContain('sk-test-secret');
    expect(serialized).not.toContain('.env');
    expect(command.env).toEqual({ PATH: '/usr/bin' });
  });

  it('rejects unsafe real execution secret mount paths', () => {
    expect(() => buildDockerCodexCommand({
      image: 'node:22-alpine',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/task-1',
      timeoutMs: 120000,
      maxLogBytes: 4096,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      networkMode: 'bridge',
      secretMountPath: '/tmp/.env',
      uid: 501,
      gid: 20
    })).toThrow(/secret mount path/i);
  });

  it('creates the controlled template before invoking the deterministic Docker executor', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const commands: DockerCodexCommand[] = [];
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      maxLogBytes: 65536,
      getUid: () => 501,
      getGid: () => 20,
      runCommand: async (command) => {
        commands.push(command);
        return {
          exitCode: 0,
          stdout: 'fixture ok',
          stderr: ''
        };
      }
    });

    const result = await adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    });

    expect(result.summary).toContain('Docker Codex fixture executor completed');
    expect(result.changedFiles).toEqual(expect.arrayContaining(['src/App.tsx', 'ai-manifest.json', 'src/codex-worker-fixture.ts']));
    expect(commands).toHaveLength(1);
    expect(commands[0]?.args).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']));
    await expect(readFile(join(workspacePath, 'src', 'App.tsx'), 'utf8')).resolves.toContain('销售数据看板');
  });

  it('runs a fake real command and accepts only allowed changed files with a valid manifest', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const commands: DockerCodexCommand[] = [];
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      getUid: () => 501,
      getGid: () => 20,
      runCommand: async (command) => {
        commands.push(command);
        const mountedWorkspace = mountedWorkspacePath(command);
        await writeFile(join(mountedWorkspace, 'src', 'real-output.ts'), 'export const realOutput = true;\n', 'utf8');
        return {
          exitCode: 0,
          stdout: 'real command ok',
          stderr: ''
        };
      }
    });

    const result = await adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    });

    expect(result.summary).toContain('Docker Codex real executor completed');
    expect(result.changedFiles).toEqual(['src/real-output.ts']);
    const serialized = commands[0]?.args.join(' ') ?? '';
    expect(commands[0]?.env.CODEX_TASK_INSTRUCTION_FILE).toBe('/workspace/task-instruction.json');
    expect(serialized).toContain('target=/workspace/task-instruction.json,readonly');
    expect(serialized).not.toContain(taskSpec.goal);
    expect(serialized).not.toContain('销售数据看板');
  });

  it('normalizes common manifest editable aliases before validating real Docker output', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      maxLogBytes: 65536,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      getUid: () => 501,
      getGid: () => 20,
      runCommand: async (command) => {
        const mountedWorkspace = mountedWorkspacePath(command);
        await writeFile(join(mountedWorkspace, 'src', 'real-output.ts'), 'export const realOutput = true;\n', 'utf8');
        await writeFile(
          join(mountedWorkspace, 'ai-manifest.json'),
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
          stdout: 'real command ok',
          stderr: ''
        };
      }
    });

    await adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    });

    const manifest = JSON.parse(await readFile(join(workspacePath, 'ai-manifest.json'), 'utf8')) as {
      entries: Record<string, { editable: string[] }>;
    };
    expect(manifest.entries['home.hero.title']?.editable).toEqual(['text']);
  });

  it('blocks real execution while preflight-only mode remains enabled', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js'
    });

    await expect(adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/preflight-only/);
  });

  it('rejects forbidden real command artifacts that collectWorkspaceFiles would otherwise ignore', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      runCommand: async (command) => {
        const mountedWorkspace = mountedWorkspacePath(command);
        await mkdir(join(mountedWorkspace, 'dist'), { recursive: true });
        await writeFile(join(mountedWorkspace, 'dist', 'bundle.js'), 'unsafe build output', 'utf8');
        return {
          exitCode: 0,
          stdout: 'ok',
          stderr: ''
        };
      }
    });

    await expect(adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/workspace safety policy: dist/);
  });

  it('rejects invalid real command manifests', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      runCommand: async (command) => {
        await writeFile(join(mountedWorkspacePath(command), 'ai-manifest.json'), '{ invalid json', 'utf8');
        return {
          exitCode: 0,
          stdout: 'ok',
          stderr: ''
        };
      }
    });

    await expect(adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/valid ai-manifest/);
  });

  it('rejects output file count and byte limit violations', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      outputMaxFiles: 1,
      outputMaxBytes: 128,
      runCommand: async (command) => {
        const mountedWorkspace = mountedWorkspacePath(command);
        await writeFile(join(mountedWorkspace, 'src', 'a.ts'), 'export const a = true;\n', 'utf8');
        await writeFile(join(mountedWorkspace, 'src', 'b.ts'), 'export const b = true;\n', 'utf8');
        return {
          exitCode: 0,
          stdout: 'ok',
          stderr: ''
        };
      }
    });

    await expect(adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/too many files/);
  });

  it('rejects real command output that exceeds the byte limit', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      outputMaxFiles: 5,
      outputMaxBytes: 16,
      runCommand: async (command) => {
        await writeFile(join(mountedWorkspacePath(command), 'src', 'large.ts'), 'export const large = "too many bytes";\n', 'utf8');
        return {
          exitCode: 0,
          stdout: 'ok',
          stderr: ''
        };
      }
    });

    await expect(adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/byte limit/);
  });

  it('redacts workspace paths and allowed env values from real command failures', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'workspace');
    const taskSpec = createTaskSpec();
    const adapter = createDockerExecutionAdapter({
      image: 'node:22-alpine',
      timeoutMs: 90000,
      maxLogBytes: 80,
      realExecutionEnabled: true,
      realCommand: 'node /runner/real-codex.js',
      realPreflightOnly: false,
      executionEnvAllowlist: ['SAFE_FLAG'],
      secretMountPath: join(root, 'codex-api-key.secret'),
      hostEnv: {
        PATH: '/usr/bin',
        SAFE_FLAG: 'safe-value-to-redact'
      },
      runCommand: async (command) => ({
        exitCode: 1,
        stdout: '',
        stderr: `failure inside ${mountedWorkspacePath(command)} using safe-value-to-redact ${join(root, 'codex-api-key.secret')} and sk-test-secret`
      })
    });

    await expect(adapter.execute({
      task: createTask(taskSpec),
      workspace: createWorkspace(workspacePath)
    })).rejects.toThrow(/\[workspace\]/);

    try {
      await adapter.execute({
        task: createTask(taskSpec),
        workspace: createWorkspace(join(root, 'workspace-redaction-second-run'))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(root);
      expect(message).not.toContain('safe-value-to-redact');
      expect(message).not.toContain('sk-test-secret');
      expect(message).not.toContain('codex-api-key.secret');
      expect(message).toContain('[redacted-env]');
      expect(message).toContain('[secret]');
    }
  });
});
