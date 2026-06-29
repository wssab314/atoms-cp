import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { aiManifestSchema, type AiManifest, type CodexTaskRecord, type GeneratedFile, type ProjectVersionSource, type WorkspaceRecord } from '@atoms-cp/shared';
import type { AppStore } from '../data/appStore.js';
import {
  collectWorkspaceFiles,
  createWorkspaceFromTemplate,
  workspaceVersionPath
} from '../workspace/workspaceService.js';
import type { CodexExecutionAdapter, CodexExecutionProgressEvent, CodexExecutionResult } from './executionAdapter.js';

export interface DryRunCodexWorkerConfig {
  workerId: string;
  workspaceRoot: string;
  executionAdapter?: CodexExecutionAdapter;
  claimTask?: (workerId: string) => Promise<CodexTaskRecord | undefined>;
}

export interface DryRunCodexWorkerResult {
  taskId: string;
  projectId: string;
  status: 'succeeded' | 'failed';
  projectVersionId?: string;
  buildJobId?: string;
  errorSummary?: string;
}

async function appendTaskTrace(
  store: AppStore,
  task: CodexTaskRecord,
  input: {
    type: 'codex_task_created' | 'codex_task_progress' | 'codex_task_claimed' | 'workspace_locked' | 'codex_task_completed' | 'workspace_created' | 'error';
    message: string;
    visibility?: 'admin' | 'user';
    payload?: Record<string, unknown>;
    buildJobId?: string;
  }
) {
  await store.appendTraceEvent({
    projectId: task.projectId,
    codexTaskId: task.id,
    buildJobId: input.buildJobId,
    type: input.type,
    visibility: input.visibility ?? 'admin',
    message: input.message,
    payload: input.payload ?? {}
  });
}

const forbiddenUserTracePattern = /mock|dry-run|docker|codex|pnpm|stdout|stderr|workspace|node_modules|\/tmp|\/Users|\/private|ark-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+/i;
const allowedProgressStages = new Set<CodexExecutionProgressEvent['stage']>(['coding_app', 'validating', 'repairing_app', 'building_preview']);
const allowedProgressStatuses = new Set<CodexExecutionProgressEvent['status']>(['start', 'progress', 'done', 'failed']);

function toSafeExecutionProgress(event: CodexExecutionProgressEvent): CodexExecutionProgressEvent | undefined {
  const message = event.message.trim();
  const stepKey = event.stepKey.trim();
  const nextAction = event.nextAction?.trim();

  if (!allowedProgressStages.has(event.stage) || !allowedProgressStatuses.has(event.status)) {
    return undefined;
  }

  if (!message || message.length > 80 || forbiddenUserTracePattern.test(message)) {
    return undefined;
  }

  if (!/^[a-z][a-z0-9_:-]{1,63}$/i.test(stepKey) || forbiddenUserTracePattern.test(stepKey)) {
    return undefined;
  }

  if (nextAction && (nextAction.length > 120 || forbiddenUserTracePattern.test(nextAction))) {
    return undefined;
  }

  return {
    stage: event.stage,
    stepKey,
    status: event.status,
    message,
    nextAction
  };
}

async function appendExecutionProgressTrace(
  store: AppStore,
  task: CodexTaskRecord,
  event: CodexExecutionProgressEvent
): Promise<void> {
  const safeEvent = toSafeExecutionProgress(event);

  if (!safeEvent) {
    return;
  }

  await appendTaskTrace(store, task, {
    type: 'codex_task_progress',
    visibility: 'user',
    message: safeEvent.message,
    payload: {
      stage: safeEvent.stage,
      stepKey: safeEvent.stepKey,
      status: safeEvent.status,
      nextAction: safeEvent.nextAction
    }
  });
}

async function ensureWorkspace(
  store: AppStore,
  task: CodexTaskRecord,
  config: DryRunCodexWorkerConfig
): Promise<WorkspaceRecord> {
  if (task.workspaceId) {
    const workspace = await store.getWorkspace(task.workspaceId);

    if (workspace) {
      return workspace;
    }
  }

  const workspacePath = workspaceVersionPath({
    workspaceRoot: config.workspaceRoot,
    projectId: task.projectId,
    taskId: task.id
  });
  await mkdir(join(workspacePath, '..'), { recursive: true });
  const workspace = await store.createWorkspace({
    projectId: task.projectId,
    path: workspacePath,
    status: 'ready'
  });
  await store.updateCodexTask(task.id, {
    workspaceId: workspace.id
  });
  await appendTaskTrace(store, task, {
    type: 'workspace_created',
    message: 'Workspace record created for Codex task.',
    payload: {
      workspaceId: workspace.id
    }
  });
  return workspace;
}

function readManifest(files: Array<{ path: string; content: string }>): AiManifest {
  const manifestFile = files.find((file) => file.path === 'ai-manifest.json');

  if (!manifestFile) {
    throw new Error('ai-manifest.json was not generated.');
  }

  const manifest = aiManifestSchema.parse(JSON.parse(manifestFile.content));
  const filePaths = new Set(files.map((file) => file.path));
  const missingManifestFiles = Object.values(manifest.entries)
    .map((entry) => entry.file)
    .filter((filePath) => !filePaths.has(filePath));

  if (missingManifestFiles.length > 0) {
    throw new Error(`ai-manifest.json references missing source files: ${missingManifestFiles.slice(0, 3).join(', ')}.`);
  }

  return manifest;
}

async function executeDefaultDryRun(
  task: CodexTaskRecord,
  workspace: WorkspaceRecord
): Promise<CodexExecutionResult> {
  if (!task.taskSpec) {
    throw new Error('CodexTask taskSpec is required for Codex worker execution.');
  }

  await createWorkspaceFromTemplate({
    workspacePath: workspace.path,
    taskSpec: task.taskSpec
  });
  const files = await collectWorkspaceFiles(workspace.path);

  return {
    summary: `Codex worker prepared ${files.length} controlled app files.`,
    changedFiles: files.map((file) => file.path)
  };
}

async function failTask(
  store: AppStore,
  task: CodexTaskRecord,
  input: {
    workspace?: WorkspaceRecord;
    error: unknown;
  }
): Promise<DryRunCodexWorkerResult> {
  const errorSummary = input.error instanceof Error ? input.error.message : String(input.error);
  await store.updateCodexTask(task.id, {
    status: 'failed',
    errorSummary,
    finishedAt: new Date().toISOString()
  });

  if (input.workspace?.id) {
    await store.unlockWorkspace(input.workspace.id);
  }

  await appendTaskTrace(store, task, {
    type: 'error',
    message: 'Codex task failed.',
    payload: {
      errorSummary
    }
  });
  await appendTaskTrace(store, task, {
    type: 'error',
    visibility: 'user',
    message: userFacingFailureMessage(task, errorSummary),
    payload: {
      stage: 'failed'
    }
  });
  await store.updateAgentMessageByTask(task.id, {
    status: 'failed'
  });

  let repairQueued = false;

  if (task.taskType !== 'repair' && task.taskSpec) {
    const repairTask = await createRepairTask(store, task, input.workspace);
    if (repairTask) {
      repairQueued = true;
      await appendTaskTrace(store, task, {
        type: 'codex_task_created',
        visibility: 'user',
        message: '正在自动修复生成结果。',
        payload: {
          stage: 'repairing_app',
          repairTaskId: repairTask.id
        }
      });
    }
  }

  if (!repairQueued) {
    await store.setProjectStatus(task.projectId, 'build_failed');
  }

  return {
    taskId: task.id,
    projectId: task.projectId,
    status: 'failed',
    errorSummary
  };
}

function userFacingFailureMessage(task: CodexTaskRecord, errorSummary: string): string {
  if (task.taskType === 'repair') {
    return '自动修复未完成，请简化需求或分步修改。';
  }

  if (/timed out|timeout|超时/i.test(errorSummary)) {
    return '编程执行超时，请简化需求后重试。';
  }

  if (/did not change|no files|no valid|没有产生有效修改/i.test(errorSummary)) {
    return '这次没有产生有效修改，我会尝试重新生成。';
  }

  if (/manifest|ai-manifest|editable/i.test(errorSummary)) {
    return '可编辑元素标记不完整，正在自动修复。';
  }

  if (/forbidden|safety policy|too many files|byte limit|denied|危险|禁止/i.test(errorSummary)) {
    return '生成结果未通过安全检查，已停止本次修改。';
  }

  return '应用生成失败，请稍后重试。';
}

async function createRepairTask(
  store: AppStore,
  failedTask: CodexTaskRecord,
  failedWorkspace?: WorkspaceRecord
): Promise<CodexTaskRecord | undefined> {
  const existing = await store.listCodexTasks(failedTask.projectId);
  if (existing.some((task) => task.taskType === 'repair')) {
    return undefined;
  }
  if (!failedTask.taskSpec) {
    return undefined;
  }

  const workspacePath = workspaceVersionPath({
    workspaceRoot: failedWorkspace ? join(failedWorkspace.path, '..', '..') : '/tmp/atoms-cp-repair-workspaces',
    projectId: failedTask.projectId,
    taskId: `repair-${failedTask.id}`
  });
  if (failedWorkspace?.path) {
    await copyRepairWorkspace(failedWorkspace.path, workspacePath);
  }
  const workspace = await store.createWorkspace({
    projectId: failedTask.projectId,
    projectVersionId: failedTask.projectVersionId,
    path: workspacePath,
    status: 'ready'
  });
  const repairSpec: typeof failedTask.taskSpec = {
    ...failedTask.taskSpec,
    targetChange: {
      type: 'repair' as const,
      summary: 'Repair invalid generated output and make the app buildable.'
    },
    allowedPaths: failedTask.taskSpec.platform === 'mini_program'
      ? ['src/**', 'ai-manifest.json']
      : ['src/**', 'index.html', 'ai-manifest.json'],
    forbiddenPaths: ['.env', 'node_modules/**', 'dist/**', '.git/**', '../**', '/**'],
    expectedOutputs: failedTask.taskSpec.platform === 'mini_program'
      ? ['Fixed Taro mini program files', 'Valid ai-manifest.json', 'Buildable preview']
      : ['Fixed React/Vite app files', 'Valid ai-manifest.json', 'Buildable preview']
  };
  return await store.createCodexTask({
    projectId: failedTask.projectId,
    projectVersionId: failedTask.projectVersionId,
    workspaceId: workspace.id,
    taskType: 'repair',
    objective: 'Repair generated app output so it can be previewed safely.',
    inputSummary: '自动修复上一次生成结果，保留现有页面意图、可编辑标记和安全边界。',
    taskSpec: repairSpec,
    allowedPaths: repairSpec.allowedPaths,
    forbiddenPaths: repairSpec.forbiddenPaths,
    validationCommands: failedTask.validationCommands
  });
}

async function copyRepairWorkspace(sourcePath: string, targetPath: string): Promise<void> {
  const { copyWorkspaceVersion } = await import('../workspace/workspaceService.js');
  try {
    await copyWorkspaceVersion({
      sourcePath,
      targetPath
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      await mkdir(targetPath, { recursive: true });
      return;
    }

    throw error;
  }
}

function projectVersionSourceForTask(task: CodexTaskRecord): ProjectVersionSource {
  if (task.taskType === 'code_edit') {
    return 'code_edit';
  }
  if (task.taskType === 'repair') {
    return 'repair';
  }
  if (task.taskType === 'selector_patch') {
    return 'agent_patch';
  }
  return 'initial_generate';
}

function generatedSourceContent(task: CodexTaskRecord, files: GeneratedFile[]): string {
  if (task.taskSpec?.platform === 'mini_program') {
    return files
      .filter((file) => file.path.startsWith('src/') && /\.(ts|tsx|js|jsx)$/.test(file.path))
      .map((file) => file.content)
      .join('\n');
  }

  return files.find((file) => file.path === 'src/App.tsx')?.content ?? '';
}

function validateGeneratedQuality(task: CodexTaskRecord, files: GeneratedFile[], manifest: AiManifest): void {
  const appSource = generatedSourceContent(task, files);
  const manifestEntryCount = Object.keys(manifest.entries).length;
  const bannedPhrases = ['用户需求已整理为结构化产品规格', '用户需求已整理', '结构化产品规格'];

  if (manifestEntryCount < 1 && task.taskType !== 'selector_patch') {
    throw new Error('Generated app has too few editable elements.');
  }

  if (bannedPhrases.some((phrase) => appSource.includes(phrase))) {
    throw new Error('Generated app still contains generic placeholder content.');
  }

  const appName = task.taskSpec?.appSpec.appName;
  const appGoalKeyword = task.taskSpec?.appSpec.appGoal.slice(0, 4);
  if (task.taskType === 'initial_generate' && appName && !appSource.includes(appName) && appGoalKeyword && !appSource.includes(appGoalKeyword)) {
    throw new Error('Generated app does not reflect the requested app direction.');
  }
}

export async function processNextCodexTask(
  store: AppStore,
  config: DryRunCodexWorkerConfig
): Promise<DryRunCodexWorkerResult | undefined> {
  const task = config.claimTask
    ? await config.claimTask(config.workerId)
    : await store.claimNextCodexTask(config.workerId);

  if (!task) {
    return undefined;
  }

  await appendTaskTrace(store, task, {
    type: 'codex_task_claimed',
    message: 'Codex worker claimed queued task.',
    payload: {
      workerId: config.workerId,
      attemptCount: task.attemptCount
    }
  });
  await appendTaskTrace(store, task, {
    type: 'codex_task_claimed',
    visibility: 'user',
    message: task.taskType === 'repair' ? '正在自动修复生成结果。' : '正在编写应用。',
    payload: {
      stage: task.taskType === 'repair' ? 'repairing_app' : 'coding_app'
    }
  });

  let workspace: WorkspaceRecord | undefined;

  try {
    workspace = await ensureWorkspace(store, task, config);
    await store.updateCodexTask(task.id, {
      status: 'preparing_workspace',
      workspaceId: workspace.id
    });
    await store.lockWorkspace(workspace.id, config.workerId);
    await appendTaskTrace(store, task, {
      type: 'workspace_locked',
      message: 'Workspace locked for Codex execution.',
      payload: {
        workspaceId: workspace.id
      }
    });

    if (!task.taskSpec) {
      throw new Error('CodexTask taskSpec is required for Codex worker execution.');
    }

    await store.updateCodexTask(task.id, {
      status: 'codex_running'
    });
    const executionResult = config.executionAdapter
      ? await config.executionAdapter.execute({
        task,
        workspace,
        onProgress: async (event) => appendExecutionProgressTrace(store, task, event)
      })
      : await executeDefaultDryRun(task, workspace);
    const files = await collectWorkspaceFiles(workspace.path);
    const manifest = readManifest(files);
    validateGeneratedQuality(task, files, manifest);

    await store.updateCodexTask(task.id, {
      status: 'validating'
    });
    const generated = await store.saveGeneratedProject({
      projectId: task.projectId,
      source: projectVersionSourceForTask(task),
      summary: `已生成 ${files.length} 个受控应用文件。`,
      files,
      manifest,
      workspacePath: workspace.path,
      parentVersionId: task.projectVersionId
    });
    await store.updateWorkspace(workspace.id, {
      projectVersionId: generated.projectVersion.id,
      status: 'ready'
    });
    await store.unlockWorkspace(workspace.id);
    const buildJob = await store.createBuildJob(task.projectId, {
      projectVersionId: generated.projectVersion.id
    });
    await store.updateCodexTask(task.id, {
      status: 'succeeded',
      projectVersionId: generated.projectVersion.id,
      workspaceId: workspace.id,
      resultSummary: `${executionResult.summary} Queued build ${buildJob.id}.`,
      finishedAt: new Date().toISOString()
    });
    await store.updateAgentMessageByTask(task.id, {
      status: 'completed'
    });
    await appendTaskTrace(store, task, {
      type: 'codex_task_completed',
      message: 'Codex worker completed task and queued a build job.',
      buildJobId: buildJob.id,
      payload: {
        projectVersionId: generated.projectVersion.id,
        workspaceId: workspace.id,
        buildJobId: buildJob.id,
        changedFiles: executionResult.changedFiles
      }
    });
    await appendTaskTrace(store, task, {
      type: 'codex_task_completed',
      visibility: 'user',
      message: task.taskType === 'repair' ? '修复完成，正在准备预览快照。' : '应用代码已生成，正在准备预览快照。',
      buildJobId: buildJob.id,
      payload: {
        stage: 'building_preview'
      }
    });

    return {
      taskId: task.id,
      projectId: task.projectId,
      status: 'succeeded',
      projectVersionId: generated.projectVersion.id,
      buildJobId: buildJob.id
    };
  } catch (error) {
    return failTask(store, task, {
      workspace,
      error
    });
  }
}
