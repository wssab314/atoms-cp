import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDefaultDesignProfiles } from '@atoms-cp/codegen';
import type { CodexTaskRecord, ProjectDetail, ProjectStatus } from '@atoms-cp/shared';
import { getModelRuntimeConfig, loadEnv, type ApiEnv } from '../../config/env.js';
import { isRealUserTaskExecutionAllowed } from '../codex/realUserTaskGate.js';
import type { AppStore } from '../data/appStore.js';
import { createModelClient } from '../model/modelClient.js';
import { createInitialCodexTaskPlan } from '../orchestrator/codexTaskPlanner.js';
import { generateProjectAppSpec, SpecGenerationError } from '../spec/specAgent.js';

export type GenerationStage =
  | 'project_created'
  | 'organizing_requirements'
  | 'designing_direction'
  | 'queueing_app_build'
  | 'coding_app'
  | 'repairing_app'
  | 'building_preview'
  | 'preview_ready'
  | 'failed';

export interface GenerationStatus {
  projectId: string;
  projectStatus: ProjectStatus;
  stage: GenerationStage;
  running: boolean;
  canRetry: boolean;
  userMessage: string;
  errorMessage?: string;
  previewSnapshotId?: string;
  previewUrl?: string;
}

const activeProjectRuns = new Set<string>();
const activeTaskStatuses = new Set<CodexTaskRecord['status']>([
  'queued',
  'claimed',
  'preparing_workspace',
  'codex_running',
  'validating',
  'running'
]);

export function isProjectGenerationActive(projectId: string): boolean {
  return activeProjectRuns.has(projectId);
}

export function startProjectGenerationRun(input: {
  store: AppStore;
  project: ProjectDetail;
  env?: ApiEnv;
}): { accepted: true; alreadyRunning: boolean } {
  if (activeProjectRuns.has(input.project.id)) {
    return { accepted: true, alreadyRunning: true };
  }

  activeProjectRuns.add(input.project.id);
  void runProjectGenerationOnce(input)
    .catch(async (error) => {
      await input.store.appendTraceEvent({
        projectId: input.project.id,
        type: 'error',
        visibility: 'admin',
        message: 'Project generation orchestration failed.',
        payload: {
          errorType: error instanceof SpecGenerationError ? error.errorType : 'INTERNAL_ERROR'
        }
      });
    })
    .finally(() => {
      activeProjectRuns.delete(input.project.id);
    });

  return { accepted: true, alreadyRunning: false };
}

export async function runProjectGenerationOnce(input: {
  store: AppStore;
  project: ProjectDetail;
  env?: ApiEnv;
}): Promise<void> {
  const env = input.env ?? loadEnv();
  let project = input.project;

  const existingReadySnapshot = (await input.store.listPreviewSnapshots(project.id))
    .find((snapshot) => snapshot.active && snapshot.status === 'ready');
  if (existingReadySnapshot) {
    return;
  }

  let appSpec = await input.store.getLatestAppSpec(project.id);
  if (!appSpec) {
    const model = getModelRuntimeConfig(env);
    const apiKey = getModelApiKey(env, model.provider);
    const modelClient = createModelClient(model, apiKey, env.MODEL_REQUEST_TIMEOUT_MS);
    await input.store.appendTraceEvent({
      projectId: project.id,
      type: 'agent_started',
      visibility: 'user',
      message: '正在整理需求。',
      payload: {
        stage: 'organizing_requirements'
      }
    });
    await generateProjectAppSpec(project, model, modelClient, input.store);
    appSpec = await input.store.getLatestAppSpec(project.id);
    project = (await input.store.setProjectStatus(project.id, 'spec_ready')) ?? project;
  }

  if (!appSpec) {
    return;
  }

  const designs = await input.store.listDesignProfiles(project.id);
  if (designs.length === 0) {
    await input.store.setProjectStatus(project.id, 'design_generating');
    await input.store.appendTraceEvent({
      projectId: project.id,
      type: 'agent_started',
      visibility: 'user',
      message: '正在生成风格方案。',
      payload: {
        stage: 'designing_direction'
      }
    });
    await input.store.createDesignProfiles({
      projectId: project.id,
      specVersionId: appSpec.id,
      profiles: createDefaultDesignProfiles(appSpec.spec)
    });
    project = (await input.store.setProjectStatus(project.id, 'design_ready')) ?? project;
    await input.store.appendTraceEvent({
      projectId: project.id,
      type: 'agent_completed',
      visibility: 'user',
      message: '风格方案已准备完成。',
      payload: {
        stage: 'designing_direction'
      }
    });
  }

  const tasks = await input.store.listCodexTasks(project.id);
  if (tasks.some((task) => activeTaskStatuses.has(task.status))) {
    return;
  }
  if (tasks.some((task) => task.status === 'succeeded')) {
    return;
  }

  await createInitialGenerationTask({
    store: input.store,
    project,
    env
  });
}

async function createInitialGenerationTask(input: {
  store: AppStore;
  project: ProjectDetail;
  env: ApiEnv;
}): Promise<void> {
  const appSpec = await input.store.getLatestAppSpec(input.project.id);
  if (!appSpec) {
    throw new Error('AppSpec is required before creating a generation task');
  }

  const selectedDesign = await input.store.getSelectedDesignProfile(input.project.id);
  const fallbackDesign = selectedDesign ?? (await input.store.listDesignProfiles(input.project.id))[0];
  if (!fallbackDesign) {
    throw new Error('DesignProfile is required before creating a generation task');
  }

  if (
    input.env.NODE_ENV !== 'test'
    && !isRealUserTaskExecutionAllowed(input.env, await getProjectOwnerEmail(input.store, input.project))
  ) {
    await input.store.appendTraceEvent({
      projectId: input.project.id,
      type: 'error',
      visibility: 'user',
      message: '应用生成服务暂不可用，请稍后重试。',
      payload: {
        stage: 'queueing_app_build'
      }
    });
    throw new Error('Real generation worker is not enabled for user tasks');
  }

  await input.store.setProjectStatus(input.project.id, 'code_generating');
  const workspace = await input.store.createWorkspace({
    projectId: input.project.id,
    path: `${input.env.CODEX_WORKSPACE_ROOT}/${input.project.id}/${randomUUID()}`,
    status: 'ready'
  });
  const taskPlan = createInitialCodexTaskPlan({
    project: input.project,
    appSpec: appSpec.spec,
    designProfile: fallbackDesign.profile
  });
  const codexTask = await input.store.createCodexTask({
    projectId: input.project.id,
    workspaceId: workspace.id,
    ...taskPlan
  });
  await input.store.appendTraceEvent({
    projectId: input.project.id,
    codexTaskId: codexTask.id,
    type: 'codex_task_created',
    visibility: 'user',
    message: '正在创建工程。',
    payload: {
      stage: 'queueing_app_build'
    }
  });
  await input.store.appendTraceEvent({
    projectId: input.project.id,
    codexTaskId: codexTask.id,
    type: 'codex_task_created',
    visibility: 'admin',
    message: 'CodexTask created by generation orchestrator.',
    payload: {
      taskType: codexTask.taskType,
      workspaceId: workspace.id,
      appSpecId: appSpec.id,
      designProfileId: fallbackDesign.id
    }
  });
}

export async function getProjectGenerationStatus(input: {
  store: AppStore;
  project: ProjectDetail;
}): Promise<GenerationStatus> {
  const [tasks, snapshots, latestBuild, traces] = await Promise.all([
    input.store.listCodexTasks(input.project.id),
    input.store.listPreviewSnapshots(input.project.id),
    input.store.getLatestBuildJob(input.project.id),
    input.store.listTraceEvents(input.project.id, 20)
  ]);
  const latestTask = [...tasks].sort(compareUpdatedOrCreatedDesc)[0];
  const readySnapshot = [...snapshots]
    .filter((snapshot) => snapshot.status === 'ready')
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const failedSnapshot = [...snapshots]
    .filter((snapshot) => snapshot.status === 'failed')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const running = activeProjectRuns.has(input.project.id)
    || Boolean(latestTask && activeTaskStatuses.has(latestTask.status))
    || latestBuild?.status === 'queued'
    || latestBuild?.status === 'running';

  const latestUserError = traces.find((trace) => trace.visibility === 'user' && trace.type === 'error');
  if (latestTask?.status === 'failed' || latestBuild?.status === 'failed' || input.project.status === 'build_failed') {
    return failedStatus(
      input.project,
      latestTask,
      latestUserError?.message ?? latestTask?.errorSummary ?? latestBuild?.errorSummary ?? failedSnapshot?.errorSummary
    );
  }

  if (latestUserError && !running) {
    return failedStatus(input.project, latestTask, latestUserError.message);
  }

  if (input.project.status === 'spec_generating') {
    return baseStatus(input.project, 'organizing_requirements', true, '正在整理需求。');
  }

  if (input.project.status === 'design_generating' || input.project.status === 'spec_ready') {
    return baseStatus(input.project, 'designing_direction', running, '正在生成风格方案。');
  }

  if (input.project.status === 'design_ready' && !latestTask) {
    return baseStatus(input.project, 'queueing_app_build', running, '正在创建工程。');
  }

  if (readySnapshot && !running) {
    return {
      projectId: input.project.id,
      projectStatus: input.project.status,
      stage: 'preview_ready',
      running: false,
      canRetry: false,
      userMessage: '预览快照已准备完成。',
      previewSnapshotId: readySnapshot.id,
      previewUrl: readySnapshot.url
    };
  }

  if (latestTask) {
    if (latestTask.taskType === 'repair' && activeTaskStatuses.has(latestTask.status)) {
      return baseStatus(input.project, 'repairing_app', true, '正在自动修复生成结果。');
    }
    if (latestTask.status === 'queued' || latestTask.status === 'claimed') {
      return latestTask.taskType === 'repair'
        ? baseStatus(input.project, 'repairing_app', true, '正在自动修复生成结果。')
        : baseStatus(input.project, 'queueing_app_build', true, '正在创建工程。');
    }
    if (latestTask.status === 'preparing_workspace' || latestTask.status === 'codex_running' || latestTask.status === 'running' || latestTask.status === 'validating') {
      return latestTask.taskType === 'repair'
        ? baseStatus(input.project, 'repairing_app', true, '正在自动修复生成结果。')
        : baseStatus(input.project, 'coding_app', true, '正在编写应用。');
    }
    if (latestTask.status === 'succeeded') {
      return baseStatus(input.project, 'building_preview', true, '正在准备预览快照。');
    }
  }

  if (latestBuild?.status === 'queued' || latestBuild?.status === 'running') {
    return baseStatus(input.project, 'building_preview', true, '正在准备预览快照。');
  }

  if (readySnapshot) {
    return {
      projectId: input.project.id,
      projectStatus: input.project.status,
      stage: 'preview_ready',
      running: false,
      canRetry: false,
      userMessage: '预览快照已准备完成。',
      previewSnapshotId: readySnapshot.id,
      previewUrl: readySnapshot.url
    };
  }

  if (failedSnapshot) {
    return failedStatus(input.project, latestTask, failedSnapshot.errorSummary);
  }

  return baseStatus(input.project, 'project_created', running, '项目已创建，正在准备生成。');
}

function baseStatus(project: ProjectDetail, stage: GenerationStage, running: boolean, userMessage: string): GenerationStatus {
  return {
    projectId: project.id,
    projectStatus: project.status,
    stage,
    running,
    canRetry: !running && stage !== 'preview_ready',
    userMessage
  };
}

function failedStatus(project: ProjectDetail, latestTask?: CodexTaskRecord, rawError?: string): GenerationStatus {
  return {
    projectId: project.id,
    projectStatus: project.status,
    stage: 'failed',
    running: false,
    canRetry: true,
    userMessage: '生成过程遇到问题，请稍后重试。',
    errorMessage: sanitizeUserError(rawError)
  };
}

function sanitizeUserError(rawError: string | undefined): string {
  if (!rawError) {
    return '生成过程遇到问题，请稍后重试。';
  }

  if (/docker|codex|pnpm|stdout|stderr|workspace|\/tmp|node_modules|vite/i.test(rawError)) {
    return '生成过程遇到问题，请稍后重试。';
  }

  return rawError.slice(0, 160);
}

function compareUpdatedOrCreatedDesc(a: CodexTaskRecord, b: CodexTaskRecord): number {
  return new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
}

async function getProjectOwnerEmail(store: AppStore, project: ProjectDetail): Promise<string | undefined> {
  const users = await store.listUsers();
  return users.find((user) => user.id === project.ownerId)?.email;
}

function getModelApiKey(env: ApiEnv, provider: ApiEnv['MODEL_PROVIDER']): string | undefined {
  if (provider === 'deepseek') {
    return env.DEEPSEEK_API_KEY;
  }

  if (!env.VOLCENGINE_API_KEY_FILE) {
    return undefined;
  }

  return readFileSync(env.VOLCENGINE_API_KEY_FILE, 'utf8').trim();
}
