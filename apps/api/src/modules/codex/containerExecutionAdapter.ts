import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import {
  collectWorkspaceFiles,
  createWorkspaceFromTemplate,
  validateWorkspaceRelativePath,
  type WorkspaceFile
} from '../workspace/workspaceService.js';
import type {
  CodexExecutionAdapter,
  CodexExecutionInput,
  CodexExecutionProgressEvent,
  CodexExecutionResult
} from './executionAdapter.js';
import { normalizeAndValidateAiManifest } from './manifestValidation.js';

export interface ContainerCodexCommand {
  file: 'sh';
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  idleTimeoutMs?: number;
  heartbeatMs?: number;
  maxLogBytes: number;
}

export interface ContainerCodexCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  timeoutReason?: 'hard' | 'idle';
}

export interface ContainerExecutionAdapterConfig {
  timeoutMs: number;
  idleTimeoutMs?: number;
  heartbeatMs?: number;
  maxLogBytes?: number;
  realExecutionEnabled?: boolean;
  realCommand?: string;
  secretFilePath?: string;
  outputMaxFiles?: number;
  outputMaxBytes?: number;
  realPreflightOnly?: boolean;
  hostEnv?: NodeJS.ProcessEnv;
  runCommand?: (command: ContainerCodexCommand) => Promise<ContainerCodexCommandResult>;
}

const defaultMaxLogBytes = 65_536;
const defaultHeartbeatMs = 30_000;
const defaultOutputMaxFiles = 200;
const defaultOutputMaxBytes = 5 * 1024 * 1024;
const deniedWorkspaceParts = new Set(['node_modules', 'dist', '.git']);
const deniedEnvNamePattern = /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|COOKIE|DATABASE_URL|REDIS_URL)/i;
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
const progressMarker = 'ATOMS_PROGRESS ';
const allowedProgressStages = new Set<CodexExecutionProgressEvent['stage']>([
  'coding_app',
  'validating',
  'repairing_app',
  'building_preview'
]);
const allowedProgressStatuses = new Set<CodexExecutionProgressEvent['status']>([
  'start',
  'progress',
  'done',
  'failed'
]);
const allowedProgressMessages = new Set([
  '正在准备工程模板。',
  '正在读取任务说明。',
  '正在创建安全任务说明。',
  '正在准备受限执行环境。',
  '正在启动编程执行。',
  '正在分析当前应用结构。',
  '正在修改页面内容。',
  '正在更新可编辑元素标记。',
  '正在收集修改结果。',
  '正在检查生成结果。',
  '正在检查生成文件安全性。',
  '正在校验可编辑元素标记。',
  '正在校验修改范围和大小。',
  '生成结果已通过校验。',
  '仍在编写应用，请稍候。'
]);
const forbiddenUserProgressPattern =
  /mock|dry-run|docker|codex|pnpm|stdout|stderr|workspace|node_modules|\/tmp|\/Users|\/private|ark-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+/i;

function truncateLog(value: string, maxLogBytes: number): string {
  return value.length > maxLogBytes ? `${value.slice(0, maxLogBytes)}\n[log truncated]` : value;
}

function normalizeProgressEvent(value: unknown): CodexExecutionProgressEvent | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const event = value as {
    stage?: unknown;
    stepKey?: unknown;
    status?: unknown;
    message?: unknown;
    nextAction?: unknown;
  };

  if (
    typeof event.stage !== 'string'
    || !allowedProgressStages.has(event.stage as CodexExecutionProgressEvent['stage'])
    || typeof event.status !== 'string'
    || !allowedProgressStatuses.has(event.status as CodexExecutionProgressEvent['status'])
    || typeof event.stepKey !== 'string'
    || !/^[a-z][a-z0-9_:-]{1,63}$/i.test(event.stepKey)
    || typeof event.message !== 'string'
  ) {
    return undefined;
  }

  const message = event.message.trim();
  const stepKey = event.stepKey.trim();
  const nextAction = typeof event.nextAction === 'string' ? event.nextAction.trim() : undefined;

  if (
    !allowedProgressMessages.has(message)
    || forbiddenUserProgressPattern.test(message)
    || forbiddenUserProgressPattern.test(stepKey)
    || (nextAction && (nextAction.length > 120 || forbiddenUserProgressPattern.test(nextAction)))
  ) {
    return undefined;
  }

  return {
    stage: event.stage as CodexExecutionProgressEvent['stage'],
    stepKey,
    status: event.status as CodexExecutionProgressEvent['status'],
    message,
    ...(nextAction ? { nextAction } : {})
  };
}

function parseProgressLine(line: string): CodexExecutionProgressEvent | undefined {
  if (!line.startsWith(progressMarker)) {
    return undefined;
  }

  try {
    return normalizeProgressEvent(JSON.parse(line.slice(progressMarker.length)));
  } catch {
    return undefined;
  }
}

async function emitProgress(
  onProgress: CodexExecutionInput['onProgress'] | undefined,
  event: CodexExecutionProgressEvent
): Promise<void> {
  if (!onProgress) {
    return;
  }

  await onProgress(event);
}

function createProgressLineConsumer(
  onProgress: CodexExecutionInput['onProgress'] | undefined,
  onAcceptedProgress?: () => void
) {
  let buffered = '';
  let pending = Promise.resolve();

  return (chunk: string, flush = false): Promise<void> => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = flush ? '' : lines.pop() ?? '';

    for (const line of flush ? lines.filter(Boolean) : lines) {
      const event = parseProgressLine(line.trim());

      if (event) {
        onAcceptedProgress?.();
        pending = pending.then(() => emitProgress(onProgress, event)).catch(() => {
          // Progress is best-effort; command execution must not fail because SSE backpressure or a trace write failed.
        });
      }
    }

    if (flush && buffered) {
      const event = parseProgressLine(buffered.trim());

      if (event) {
        onAcceptedProgress?.();
        pending = pending.then(() => emitProgress(onProgress, event)).catch(() => {});
      }
      buffered = '';
    }

    return pending;
  };
}

async function replayProgressFromCommandResult(
  result: ContainerCodexCommandResult,
  onProgress: CodexExecutionInput['onProgress'] | undefined
): Promise<void> {
  if (!onProgress) {
    return;
  }

  for (const line of `${result.stdout}\n${result.stderr}`.split(/\r?\n/)) {
    const event = parseProgressLine(line.trim());

    if (event) {
      await emitProgress(onProgress, event);
    }
  }
}

function assertSafeAbsolutePath(input: { value: string; label: string }): void {
  if (!input.value || input.value.includes('\0') || !isAbsolute(input.value)) {
    throw new Error(`${input.label} must be an absolute safe path.`);
  }

  if (input.value.includes('/../') || input.value.endsWith('/..') || input.value.includes('.env')) {
    throw new Error(`${input.label} is denied by the safety policy.`);
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
    errorMessage: 'Container Codex output did not produce a valid ai-manifest.json.'
  });
}

function validateChangedFiles(input: {
  files: WorkspaceFile[];
  taskSpec: NonNullable<CodexExecutionInput['task']['taskSpec']>;
  outputMaxFiles: number;
  outputMaxBytes: number;
}): void {
  if (input.files.length > input.outputMaxFiles) {
    throw new Error(`Container Codex output changed too many files (${input.files.length}/${input.outputMaxFiles}).`);
  }

  const totalBytes = input.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);

  if (totalBytes > input.outputMaxBytes) {
    throw new Error(`Container Codex output exceeded the byte limit (${totalBytes}/${input.outputMaxBytes}).`);
  }

  for (const file of input.files) {
    const validation = validateWorkspaceRelativePath(file.path, input.taskSpec);

    if (!validation.allowed) {
      throw new Error(`Container Codex output changed a forbidden file: ${file.path}.`);
    }
  }
}

async function validateOutput(input: {
  workspacePath: string;
  beforeFiles: WorkspaceFile[];
  taskSpec: NonNullable<CodexExecutionInput['task']['taskSpec']>;
  outputMaxFiles: number;
  outputMaxBytes: number;
  onProgress?: CodexExecutionInput['onProgress'];
}): Promise<WorkspaceFile[]> {
  await emitProgress(input.onProgress, {
    stage: 'validating',
    stepKey: 'check_safety',
    status: 'progress',
    message: '正在检查生成文件安全性。'
  });
  const unsafeArtifacts = await findUnsafeWorkspaceArtifacts(input.workspacePath);

  if (unsafeArtifacts.length > 0) {
    throw new Error(`Container Codex output violated workspace safety policy: ${unsafeArtifacts.slice(0, 5).join(', ')}.`);
  }

  await emitProgress(input.onProgress, {
    stage: 'validating',
    stepKey: 'validate_manifest',
    status: 'progress',
    message: '正在校验可编辑元素标记。'
  });
  await assertValidManifest(input.workspacePath);
  const afterFiles = await collectWorkspaceFiles(input.workspacePath);
  const changedFiles = changedFilesAfterExecution(input.beforeFiles, afterFiles);
  await emitProgress(input.onProgress, {
    stage: 'validating',
    stepKey: 'validate_changes',
    status: 'progress',
    message: '正在校验修改范围和大小。'
  });
  validateChangedFiles({
    files: changedFiles,
    taskSpec: input.taskSpec,
    outputMaxFiles: input.outputMaxFiles,
    outputMaxBytes: input.outputMaxBytes
  });
  await emitProgress(input.onProgress, {
    stage: 'validating',
    stepKey: 'output_valid',
    status: 'done',
    message: '生成结果已通过校验。'
  });
  return changedFiles;
}

async function writeTaskInstructionFile(input: CodexExecutionInput): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'atoms-cp-container-task-'));
  const taskInstructionPath = join(directory, 'task-instruction.json');
  const { validationCommands: _platformValidationCommands, ...taskSpecForExecutor } = input.task.taskSpec ?? {};
  await writeFile(taskInstructionPath, `${JSON.stringify({
    taskId: input.task.id,
    projectId: input.task.projectId,
    taskType: input.task.taskType,
    objective: input.task.objective,
    inputSummary: input.task.inputSummary,
    taskSpec: taskSpecForExecutor,
    allowedPaths: input.task.allowedPaths,
    forbiddenPaths: input.task.forbiddenPaths,
    dependencyPolicy: {
      allowNewDependencies: false,
      allowedImports: allowedImportsForPlatform(input.task.taskSpec?.platform),
      note: dependencyPolicyNoteForPlatform(input.task.taskSpec?.platform)
    },
    platformValidation: {
      handledByAtomsCp: true,
      note: 'Do not run package installation, build, typecheck, test, dev server, or preview commands. The platform validates and builds after this editing step.'
    }
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

function isSafeForwardedEnvName(name: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(name) && !deniedEnvNamePattern.test(name);
}

function buildCommandEnv(input: {
  workspacePath: string;
  taskInstructionPath: string;
  secretFilePath: string;
  blockedBinPath?: string;
  hostEnv?: NodeJS.ProcessEnv;
}): Record<string, string> {
  const hostEnv = input.hostEnv ?? process.env;
  const pathValue = hostEnv.PATH ?? process.env.PATH ?? '';
  const env: Record<string, string> = {
    PATH: input.blockedBinPath ? `${input.blockedBinPath}:${pathValue}` : pathValue,
    CODEX_CONTAINER_EXECUTION: '1',
    CODEX_PROJECT_DIR: input.workspacePath,
    CODEX_TASK_INSTRUCTION_FILE: input.taskInstructionPath,
    CODEX_SECRET_FILE: input.secretFilePath
  };

  for (const name of ['CODEX_DOUBAO_MODEL', 'CODEX_DOUBAO_BASE_URL', 'CODEX_PROFILE_NAME', 'CODEX_DOUBAO_EXECUTOR']) {
    const value = hostEnv[name];

    if (isSafeForwardedEnvName(name) && typeof value === 'string') {
      env[name] = value;
    }
  }

  return env;
}

export function buildContainerCodexCommand(input: {
  workspacePath: string;
  taskInstructionPath: string;
  secretFilePath: string;
  blockedBinPath?: string;
  timeoutMs: number;
  idleTimeoutMs?: number;
  heartbeatMs?: number;
  maxLogBytes: number;
  realCommand: string;
  hostEnv?: NodeJS.ProcessEnv;
}): ContainerCodexCommand {
  assertSafeAbsolutePath({ value: input.workspacePath, label: 'Container Codex workspace path' });
  assertSafeAbsolutePath({ value: input.taskInstructionPath, label: 'Container Codex task instruction path' });
  assertSafeAbsolutePath({ value: input.secretFilePath, label: 'Container Codex secret file path' });

  const realCommand = input.realCommand.trim();

  if (realCommand.length === 0) {
    throw new Error('CODEX_REAL_COMMAND is required when container Codex execution is enabled.');
  }

  return {
    file: 'sh',
    args: ['-lc', realCommand],
    cwd: input.workspacePath,
    env: buildCommandEnv({
      workspacePath: input.workspacePath,
      taskInstructionPath: input.taskInstructionPath,
      secretFilePath: input.secretFilePath,
      blockedBinPath: input.blockedBinPath,
      hostEnv: input.hostEnv
    }),
    timeoutMs: input.timeoutMs,
    idleTimeoutMs: input.idleTimeoutMs,
    heartbeatMs: input.heartbeatMs,
    maxLogBytes: input.maxLogBytes
  };
}

function killProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // The process group already exited after SIGTERM.
        }
      }, 2_000).unref();
      return;
    } catch {
      // Fall through to killing the direct child below.
    }
  }

  child.kill('SIGTERM');
  setTimeout(() => {
    child.kill('SIGKILL');
  }, 2_000).unref();
}

async function emitHeartbeat(onProgress: CodexExecutionInput['onProgress'] | undefined): Promise<void> {
  await emitProgress(onProgress, {
    stage: 'coding_app',
    stepKey: 'execution_heartbeat',
    status: 'progress',
    message: '仍在编写应用，请稍候。'
  });
}

export function runContainerCommand(
  command: ContainerCodexCommand,
  onProgress?: CodexExecutionInput['onProgress']
): Promise<ContainerCodexCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutReason: ContainerCodexCommandResult['timeoutReason'];
    let lastSafeProgressAt = Date.now();
    let lastHeartbeatAt = lastSafeProgressAt;
    const consumeProgress = createProgressLineConsumer(onProgress, () => {
      lastSafeProgressAt = Date.now();
    });
    const finishByTimeout = (reason: NonNullable<ContainerCodexCommandResult['timeoutReason']>) => {
      if (timedOut) {
        return;
      }
      timedOut = true;
      timeoutReason = reason;
      killProcessTree(child);
    };
    const timer = setTimeout(() => {
      finishByTimeout('hard');
    }, command.timeoutMs);
    const heartbeatIntervalMs = command.heartbeatMs ?? defaultHeartbeatMs;
    const idleTimeoutMs = command.idleTimeoutMs;
    const heartbeatTimer = setInterval(() => {
      const now = Date.now();

      if (idleTimeoutMs && now - lastSafeProgressAt >= idleTimeoutMs) {
        finishByTimeout('idle');
        return;
      }

      if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
        lastHeartbeatAt = now;
        void emitHeartbeat(onProgress).catch(() => {});
      }
    }, Math.max(25, Math.min(heartbeatIntervalMs, idleTimeoutMs ?? heartbeatIntervalMs)));

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout = truncateLog(stdout + text, command.maxLogBytes);
      consumeProgress(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr = truncateLog(stderr + text, command.maxLogBytes);
      consumeProgress(text);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      clearInterval(heartbeatTimer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(heartbeatTimer);
      void consumeProgress('', true).then(() => {
        resolve({
          exitCode: timedOut ? 124 : code ?? 1,
          stdout,
          stderr,
          timedOut,
          timeoutReason
        });
      });
    });
  });
}

function redactSensitiveText(input: {
  value: string;
  workspacePath: string;
  secretFilePath: string;
  taskInstructionPath?: string;
  maxLogBytes: number;
}): string {
  let output = input.value
    .split(input.workspacePath).join('[workspace]')
    .split(input.secretFilePath).join('[secret-file]');

  if (input.taskInstructionPath) {
    output = output.split(input.taskInstructionPath).join('[task-instruction]');
  }

  output = output
    .replace(/ark-[A-Za-z0-9_-]+/g, '[secret]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[secret]')
    .replace(/\/(?:Users|tmp|private\/tmp)\/[^\s'"`]+/g, '[path]');

  return truncateLog(output, input.maxLogBytes);
}

async function writeBlockedCommandShims(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'atoms-cp-blocked-bin-'));
  const blockedCommands = ['pnpm', 'npm', 'npx', 'yarn', 'bun', 'vite', 'tsc'];
  const script = [
    '#!/usr/bin/env sh',
    'echo "Package installation and local build commands are disabled in the Codex editing sandbox. Edit source files only; atoms-cp will validate and build afterward." >&2',
    'exit 127',
    ''
  ].join('\n');

  await Promise.all(blockedCommands.map(async (command) => {
    const filePath = join(directory, command);
    await writeFile(filePath, script, { encoding: 'utf8', mode: 0o755 });
  }));

  return {
    path: directory,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export function createContainerExecutionAdapter(config: ContainerExecutionAdapterConfig): CodexExecutionAdapter {
  const runCommand = config.runCommand ?? runContainerCommand;
  const realExecutionEnabled = config.realExecutionEnabled ?? false;
  const maxLogBytes = config.maxLogBytes ?? defaultMaxLogBytes;

  return {
    name: realExecutionEnabled ? 'container_real' : 'container_disabled',
    async execute(input): Promise<CodexExecutionResult> {
      if (!input.task.taskSpec) {
        throw new Error('CodexTask taskSpec is required for container Codex execution.');
      }

      if (!realExecutionEnabled) {
        throw new Error('Container Codex execution requires CODEX_REAL_EXECUTION_ENABLED=true.');
      }

      if (config.realPreflightOnly ?? true) {
        throw new Error('Container Codex execution is in preflight-only mode.');
      }

      const realCommand = config.realCommand?.trim() ?? '';

      if (!realCommand) {
        throw new Error('CODEX_REAL_COMMAND is required when container Codex execution is enabled.');
      }

      const secretFilePath = config.secretFilePath?.trim() ?? '';

      if (!secretFilePath) {
        throw new Error('CODEX_SECRET_FILE or CODEX_SECRET_MOUNT_PATH is required for container Codex execution.');
      }

      const executionStage: CodexExecutionProgressEvent['stage'] =
        input.task.taskType === 'repair' ? 'repairing_app' : 'coding_app';

      await emitProgress(input.onProgress, {
        stage: executionStage,
        stepKey: 'prepare_template',
        status: 'start',
        message: '正在准备工程模板。'
      });
      await createWorkspaceFromTemplate({
        workspacePath: input.workspace.path,
        taskSpec: input.task.taskSpec
      });
      const beforeFiles = await collectWorkspaceFiles(input.workspace.path);
      await emitProgress(input.onProgress, {
        stage: executionStage,
        stepKey: 'create_instruction',
        status: 'progress',
        message: '正在创建安全任务说明。'
      });
      const taskInstruction = await writeTaskInstructionFile(input);
      await emitProgress(input.onProgress, {
        stage: executionStage,
        stepKey: 'prepare_sandbox',
        status: 'progress',
        message: '正在准备受限执行环境。'
      });
      const blockedCommands = await writeBlockedCommandShims();
      let result: ContainerCodexCommandResult;
      let command: ContainerCodexCommand;

      try {
        command = buildContainerCodexCommand({
          workspacePath: input.workspace.path,
          taskInstructionPath: taskInstruction.path,
          secretFilePath,
          blockedBinPath: blockedCommands.path,
          timeoutMs: config.timeoutMs,
          idleTimeoutMs: config.idleTimeoutMs,
          heartbeatMs: config.heartbeatMs,
          maxLogBytes,
          realCommand,
          hostEnv: config.hostEnv
        });
        await emitProgress(input.onProgress, {
          stage: executionStage,
          stepKey: 'start_execution',
          status: 'start',
          message: '正在启动编程执行。'
        });
        result = config.runCommand
          ? await runCommand(command)
          : await runContainerCommand(command, input.onProgress);

        if (config.runCommand) {
          await replayProgressFromCommandResult(result, input.onProgress);
        }
      } finally {
        await Promise.all([taskInstruction.cleanup(), blockedCommands.cleanup()]);
      }

      await emitProgress(input.onProgress, {
        stage: executionStage,
        stepKey: 'collect_output',
        status: 'progress',
        message: '正在收集修改结果。'
      });
      let changedFiles: WorkspaceFile[];

      if (result.exitCode !== 0 && !result.timedOut) {
        const log = redactSensitiveText({
          value: result.stderr || result.stdout || '',
          workspacePath: input.workspace.path,
          secretFilePath,
          taskInstructionPath: command.env.CODEX_TASK_INSTRUCTION_FILE,
          maxLogBytes
        }).trim();
        throw new Error(`Container Codex real executor exited with code ${result.exitCode}. ${log}`.trim());
      }

      changedFiles = await validateOutput({
        workspacePath: input.workspace.path,
        beforeFiles,
        taskSpec: input.task.taskSpec,
        outputMaxFiles: config.outputMaxFiles ?? defaultOutputMaxFiles,
        outputMaxBytes: config.outputMaxBytes ?? defaultOutputMaxBytes,
        onProgress: input.onProgress
      });

      return {
        summary: result.timedOut
          ? `Container Codex real executor validated after stopping a stalled execution with ${changedFiles.length} changed files.`
          : `Container Codex real executor completed with ${changedFiles.length} validated changed files.`,
        changedFiles: changedFiles.map((file) => file.path)
      };
    }
  };
}
