import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import {
  collectWorkspaceFiles,
  createWorkspaceFromTemplate,
  validateWorkspaceRelativePath
} from '../workspace/workspaceService.js';
import type { CodexExecutionAdapter, CodexExecutionInput, CodexExecutionResult } from './executionAdapter.js';
import type { WorkspaceFile } from '../workspace/workspaceService.js';
import { normalizeAndValidateAiManifest } from './manifestValidation.js';

export type DockerCodexNetworkMode = 'none' | 'bridge';

export interface DockerCodexCommand {
  file: 'docker';
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
  maxLogBytes: number;
}

export interface DockerCodexCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface DockerExecutionAdapterConfig {
  image: string;
  timeoutMs: number;
  maxLogBytes?: number;
  realExecutionEnabled?: boolean;
  realCommand?: string;
  networkMode?: DockerCodexNetworkMode;
  outputMaxFiles?: number;
  outputMaxBytes?: number;
  executionEnvAllowlist?: string[];
  secretMountPath?: string;
  taskInstructionPath?: string;
  realPreflightOnly?: boolean;
  hostEnv?: NodeJS.ProcessEnv;
  getUid?: () => number;
  getGid?: () => number;
  runCommand?: (command: DockerCodexCommand) => Promise<DockerCodexCommandResult>;
}

const fixtureFilePath = 'src/codex-worker-fixture.ts';
const defaultMaxLogBytes = 65_536;
const defaultOutputMaxFiles = 200;
const defaultOutputMaxBytes = 5 * 1024 * 1024;
const deniedWorkspaceParts = new Set(['node_modules', 'dist', '.git']);
const deniedEnvNamePattern = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|COOKIE|DATABASE_URL|REDIS_URL)/i;
const deniedEnvNames = new Set(['HOME', 'PWD', 'OLDPWD', 'DOCKER_HOST', 'SSH_AUTH_SOCK']);
const containerSecretPath = '/run/secrets/codex_api_key';
const containerTaskInstructionPath = '/workspace/task-instruction.json';
const webAllowedImports = [
  'react',
  'react-dom',
  'react-router-dom',
  'lucide-react',
  'recharts',
  '@tanstack/react-table',
  'react-hook-form',
  'zod',
  'clsx',
  'date-fns',
  'framer-motion'
];
const miniProgramAllowedImports = [
  'react',
  'react-dom',
  '@tarojs/taro',
  '@tarojs/components',
  '@tarojs/react'
];

function truncateLog(value: string, maxLogBytes: number): string {
  return value.length > maxLogBytes ? `${value.slice(0, maxLogBytes)}\n[log truncated]` : value;
}

function assertSafeWorkspacePath(workspacePath: string): void {
  if (!workspacePath || workspacePath.includes('\0') || !isAbsolute(workspacePath)) {
    throw new Error('Docker Codex workspace path must be an absolute safe path.');
  }
}

function assertSafeSecretMountPath(secretMountPath: string): void {
  if (!secretMountPath || secretMountPath.includes('\0') || !isAbsolute(secretMountPath)) {
    throw new Error('Docker Codex secret mount path must be an absolute safe path.');
  }

  if (secretMountPath.includes('/../') || secretMountPath.endsWith('/..') || secretMountPath.includes('.env')) {
    throw new Error('Docker Codex secret mount path is denied by the safety policy.');
  }

  if (process.env.HOME && secretMountPath.startsWith(`${process.env.HOME}/`)) {
    throw new Error('Docker Codex secret mount path must not be inside the host HOME directory.');
  }
}

function toPosixPath(value: string): string {
  return value.split(sep).join('/');
}

function normalizeRelativeWorkspacePath(value: string): string | undefined {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    return undefined;
  }

  const normalized = posix.normalize(value.replace(/\\/g, '/'));

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }

  return normalized;
}

function isDeniedWorkspaceArtifact(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return parts.some((part) => deniedWorkspaceParts.has(part) || part === '.env' || part.startsWith('.env.'));
}

function isSafeEnvName(name: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(name) && !deniedEnvNames.has(name) && !deniedEnvNamePattern.test(name);
}

function buildExecutionEnv(input: {
  allowlist?: string[];
  hostEnv?: NodeJS.ProcessEnv;
}): Record<string, string> {
  const hostEnv = input.hostEnv ?? process.env;
  const env: Record<string, string> = {
    PATH: hostEnv.PATH ?? process.env.PATH ?? ''
  };

  for (const name of input.allowlist ?? []) {
    const key = name.trim();

    if (!isSafeEnvName(key)) {
      continue;
    }

    const value = hostEnv[key];

    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  return env;
}

function containerEnvArgs(env: Record<string, string>): string[] {
  return Object.keys(env)
    .filter((key) => key !== 'PATH')
    .flatMap((key) => ['--env', key]);
}

function secretMountArgs(secretMountPath: string | undefined): string[] {
  if (!secretMountPath) {
    return [];
  }

  assertSafeSecretMountPath(secretMountPath);
  return [
    '--mount',
    `type=bind,source=${secretMountPath},target=${containerSecretPath},readonly`
  ];
}

function assertSafeReadonlyMountPath(filePath: string): void {
  if (!filePath || filePath.includes('\0') || !isAbsolute(filePath)) {
    throw new Error('Docker Codex read-only mount path must be an absolute safe path.');
  }

  if (filePath.includes('/../') || filePath.endsWith('/..') || filePath.includes('.env')) {
    throw new Error('Docker Codex read-only mount path is denied by the safety policy.');
  }
}

function taskInstructionMountArgs(taskInstructionPath: string | undefined): string[] {
  if (!taskInstructionPath) {
    return [];
  }

  assertSafeReadonlyMountPath(taskInstructionPath);
  return [
    '--mount',
    `type=bind,source=${taskInstructionPath},target=${containerTaskInstructionPath},readonly`
  ];
}

function redactSensitiveText(input: {
  value: string;
  workspacePath: string;
  secretMountPath?: string;
  env: Record<string, string>;
  maxLogBytes: number;
}): string {
  const redactionValues = [
    input.workspacePath,
    input.secretMountPath ?? '',
    ...Object.entries(input.env)
      .filter(([key]) => key !== 'PATH')
      .map(([, value]) => value)
      .filter((value) => value.length >= 4)
  ].filter((value) => value.length > 0);
  let output = input.value;

  for (const value of redactionValues) {
    output = output.split(value).join(value === input.workspacePath ? '[workspace]' : '[redacted-env]');
  }

  output = output
    .replace(/sk-[A-Za-z0-9_-]+/g, '[secret]')
    .replace(/\/(?:Users|tmp|private\/tmp)\/[^\s'"`]+/g, '[path]');

  return truncateLog(output, input.maxLogBytes);
}

export function buildDockerCodexCommand(input: {
  image: string;
  workspacePath: string;
  timeoutMs: number;
  maxLogBytes: number;
  realExecutionEnabled?: boolean;
  realCommand?: string;
  networkMode?: DockerCodexNetworkMode;
  executionEnvAllowlist?: string[];
  secretMountPath?: string;
  taskInstructionPath?: string;
  hostEnv?: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
}): DockerCodexCommand {
  assertSafeWorkspacePath(input.workspacePath);
  const realExecutionEnabled = input.realExecutionEnabled ?? false;
  const realCommand = input.realCommand?.trim() ?? '';

  if (realExecutionEnabled && realCommand.length === 0) {
    throw new Error('CODEX_REAL_COMMAND is required when real Docker Codex execution is enabled.');
  }

  const uid = input.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 1000);
  const gid = input.gid ?? (typeof process.getgid === 'function' ? process.getgid() : 1000);
  const env = buildExecutionEnv({
    allowlist: input.executionEnvAllowlist,
    hostEnv: input.hostEnv
  });

  if (realExecutionEnabled && input.taskInstructionPath) {
    env.CODEX_TASK_INSTRUCTION_FILE = containerTaskInstructionPath;
  }

  return {
    file: 'docker',
    timeoutMs: input.timeoutMs,
    maxLogBytes: input.maxLogBytes,
    env,
    args: [
      'run',
      '--rm',
      '--network',
      input.networkMode ?? 'none',
      '--user',
      `${uid}:${gid}`,
      '--workdir',
      '/workspace/project',
      ...containerEnvArgs(env),
      '--mount',
      `type=bind,source=${input.workspacePath},target=/workspace/project`,
      ...secretMountArgs(realExecutionEnabled ? input.secretMountPath : undefined),
      ...taskInstructionMountArgs(realExecutionEnabled ? input.taskInstructionPath : undefined),
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,noexec,size=64m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '256',
      '--memory',
      '1024m',
      '--cpus',
      '1',
      input.image,
      'sh',
      '-lc',
      realExecutionEnabled ? realCommand : 'node -e "console.log(\\"codex docker fixture ok\\")"'
    ]
  };
}

async function writeTaskInstructionFile(input: CodexExecutionInput): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'atoms-cp-codex-task-'));
  const taskInstructionPath = join(directory, 'task-instruction.json');
  await writeFile(taskInstructionPath, `${JSON.stringify({
    taskId: input.task.id,
    projectId: input.task.projectId,
    taskType: input.task.taskType,
    objective: input.task.objective,
    inputSummary: input.task.inputSummary,
    taskSpec: input.task.taskSpec,
    allowedPaths: input.task.allowedPaths,
    forbiddenPaths: input.task.forbiddenPaths,
    dependencyPolicy: {
      allowNewDependencies: false,
      allowedImports: allowedImportsForPlatform(input.task.taskSpec?.platform),
      note: dependencyPolicyNoteForPlatform(input.task.taskSpec?.platform)
    },
    validationCommands: input.task.validationCommands
  }, null, 2)}\n`, 'utf8');

  return {
    path: taskInstructionPath,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

function allowedImportsForPlatform(platform: unknown): string[] {
  return platform === 'mini_program' ? miniProgramAllowedImports : webAllowedImports;
}

function dependencyPolicyNoteForPlatform(platform: unknown): string {
  if (platform === 'mini_program') {
    return 'This is a Taro React WeChat Mini Program. Edit only src/** and ai-manifest.json. Use Taro components and APIs. Manifest entry file values must point to real Taro source files such as src/pages/index/index.tsx, not src/App.tsx. Do not edit package.json, lockfiles, config, tsconfig.json, node_modules, or dist.';
  }

  return 'This is a React/Vite web app. Only edit source, public, index.html, and ai-manifest.json. Do not edit package.json, lockfiles, tsconfig.json, or vite.config.ts.';
}

function runDockerCommand(command: DockerCodexCommand): Promise<DockerCodexCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      env: command.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, command.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = truncateLog(stdout + chunk.toString('utf8'), command.maxLogBytes);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = truncateLog(stderr + chunk.toString('utf8'), command.maxLogBytes);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}

async function writeFixtureMarker(input: CodexExecutionInput): Promise<void> {
  if (!input.task.taskSpec) {
    throw new Error('CodexTask taskSpec is required for Docker execution.');
  }

  const validation = validateWorkspaceRelativePath(fixtureFilePath, input.task.taskSpec);

  if (!validation.allowed) {
    return;
  }

  const absolutePath = join(input.workspace.path, fixtureFilePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    [
      'export const codexWorkerFixture = {',
      `  taskId: ${JSON.stringify(input.task.id)},`,
      `  projectId: ${JSON.stringify(input.task.projectId)},`,
      `  goal: ${JSON.stringify(input.task.taskSpec.goal)}`,
      '};',
      ''
    ].join('\n'),
    'utf8'
  );
}

async function findUnsafeWorkspaceArtifacts(workspacePath: string): Promise<string[]> {
  const unsafe: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);
      const relativePath = normalizeRelativeWorkspacePath(toPosixPath(relative(workspacePath, absolutePath)));

      if (!relativePath) {
        unsafe.push('[invalid]');
        continue;
      }

      if (isDeniedWorkspaceArtifact(relativePath)) {
        unsafe.push(relativePath);
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
      }
    }
  }

  await walk(workspacePath);
  return unsafe.sort((left, right) => left.localeCompare(right));
}

function changedFilesAfterExecution(beforeFiles: WorkspaceFile[], afterFiles: WorkspaceFile[]): WorkspaceFile[] {
  const baseline = new Map(beforeFiles.map((file) => [file.path, file.contentHash]));
  return afterFiles.filter((file) => baseline.get(file.path) !== file.contentHash);
}

async function assertValidManifest(workspacePath: string): Promise<void> {
  await normalizeAndValidateAiManifest({
    workspacePath,
    errorMessage: 'Docker Codex output did not produce a valid ai-manifest.json.'
  });
}

function validateRealExecutionChangedFiles(input: {
  files: WorkspaceFile[];
  taskSpec: NonNullable<CodexExecutionInput['task']['taskSpec']>;
  outputMaxFiles: number;
  outputMaxBytes: number;
}): void {
  if (input.files.length > input.outputMaxFiles) {
    throw new Error(`Docker Codex output changed too many files (${input.files.length}/${input.outputMaxFiles}).`);
  }

  const totalBytes = input.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);

  if (totalBytes > input.outputMaxBytes) {
    throw new Error(`Docker Codex output exceeded the byte limit (${totalBytes}/${input.outputMaxBytes}).`);
  }

  for (const file of input.files) {
    const validation = validateWorkspaceRelativePath(file.path, input.taskSpec);

    if (!validation.allowed) {
      throw new Error(`Docker Codex output changed a forbidden file: ${file.path}.`);
    }
  }
}

async function validateRealExecutionOutput(input: {
  workspacePath: string;
  beforeFiles: WorkspaceFile[];
  taskSpec: NonNullable<CodexExecutionInput['task']['taskSpec']>;
  outputMaxFiles: number;
  outputMaxBytes: number;
}): Promise<WorkspaceFile[]> {
  const unsafeArtifacts = await findUnsafeWorkspaceArtifacts(input.workspacePath);

  if (unsafeArtifacts.length > 0) {
    throw new Error(`Docker Codex output violated workspace safety policy: ${unsafeArtifacts.slice(0, 5).join(', ')}.`);
  }

  await assertValidManifest(input.workspacePath);
  const afterFiles = await collectWorkspaceFiles(input.workspacePath);
  const changedFiles = changedFilesAfterExecution(input.beforeFiles, afterFiles);
  validateRealExecutionChangedFiles({
    files: changedFiles,
    taskSpec: input.taskSpec,
    outputMaxFiles: input.outputMaxFiles,
    outputMaxBytes: input.outputMaxBytes
  });
  return changedFiles;
}

export function createDockerExecutionAdapter(config: DockerExecutionAdapterConfig): CodexExecutionAdapter {
  const runCommand = config.runCommand ?? runDockerCommand;
  const realExecutionEnabled = config.realExecutionEnabled ?? false;
  const maxLogBytes = config.maxLogBytes ?? defaultMaxLogBytes;

  return {
    name: realExecutionEnabled ? 'docker_real' : 'docker_fixture',
    async execute(input): Promise<CodexExecutionResult> {
      if (!input.task.taskSpec) {
        throw new Error('CodexTask taskSpec is required for Docker execution.');
      }

      if (realExecutionEnabled && (config.realPreflightOnly ?? true)) {
        throw new Error('Real Docker Codex execution is in preflight-only mode.');
      }

      await createWorkspaceFromTemplate({
        workspacePath: input.workspace.path,
        taskSpec: input.task.taskSpec
      });

      if (!realExecutionEnabled) {
        await writeFixtureMarker(input);
      }

      const beforeFiles = await collectWorkspaceFiles(input.workspace.path);

      const taskInstruction = realExecutionEnabled ? await writeTaskInstructionFile(input) : undefined;
      let result: DockerCodexCommandResult;
      let command: DockerCodexCommand;

      try {
        command = buildDockerCodexCommand({
          image: config.image,
          workspacePath: input.workspace.path,
          timeoutMs: config.timeoutMs,
          maxLogBytes,
          realExecutionEnabled,
          realCommand: config.realCommand,
          networkMode: config.networkMode,
          executionEnvAllowlist: config.executionEnvAllowlist,
          secretMountPath: config.secretMountPath,
          taskInstructionPath: taskInstruction?.path,
          hostEnv: config.hostEnv,
          uid: config.getUid?.(),
          gid: config.getGid?.()
        });
        result = await runCommand(command);
      } finally {
        await taskInstruction?.cleanup();
      }

      if (result.exitCode !== 0) {
        const detail = result.timedOut
          ? `Docker Codex ${realExecutionEnabled ? 'real' : 'fixture'} executor timed out after ${config.timeoutMs}ms.`
          : `Docker Codex ${realExecutionEnabled ? 'real' : 'fixture'} executor exited with code ${result.exitCode}.`;
        const log = redactSensitiveText({
          value: result.stderr || result.stdout || '',
          workspacePath: input.workspace.path,
          secretMountPath: config.secretMountPath,
          env: command.env,
          maxLogBytes
        }).trim();
        throw new Error(`${detail} ${log}`.trim());
      }

      const files = await collectWorkspaceFiles(input.workspace.path);
      const changedFiles = realExecutionEnabled
        ? await validateRealExecutionOutput({
            workspacePath: input.workspace.path,
            beforeFiles,
            taskSpec: input.task.taskSpec,
            outputMaxFiles: config.outputMaxFiles ?? defaultOutputMaxFiles,
            outputMaxBytes: config.outputMaxBytes ?? defaultOutputMaxBytes
          })
        : files;

      return {
        summary: realExecutionEnabled
          ? `Docker Codex real executor completed with ${changedFiles.length} validated changed files.`
          : `Docker Codex fixture executor completed with ${files.length} controlled files.`,
        changedFiles: changedFiles.map((file) => file.path)
      };
    }
  };
}
