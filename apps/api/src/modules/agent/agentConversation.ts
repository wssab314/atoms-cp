import { randomUUID } from 'node:crypto';
import type { AgentMessageRecord, AppSpecRecord, CodexTaskRecord, DesignProfileRecord, PreviewSnapshotRecord, ProjectDetail, UserProfile } from '@atoms-cp/shared';
import { loadEnv, type ApiEnv } from '../../config/env.js';
import type { AppStore } from '../data/appStore.js';
import { createInitialCodexTaskPlan, type CodexTaskPlan } from '../orchestrator/codexTaskPlanner.js';
import { copyWorkspaceVersion, workspaceVersionPath } from '../workspace/workspaceService.js';

export interface AgentStreamEvent {
  id: string;
  kind: 'agent' | 'user' | 'status' | 'error';
  message: string;
  stage?: string;
  stepKey?: string;
  status?: 'start' | 'progress' | 'done' | 'failed';
  nextAction?: string;
  createdAt: string;
  snapshotUrl?: string;
}

export interface AgentMessageResult {
  accepted: true;
  queued: boolean;
  delivery: 'received' | 'queued' | 'deferred';
  queuePosition: number;
  message: string;
}

const activeTaskStatuses = new Set<CodexTaskRecord['status']>([
  'queued',
  'claimed',
  'preparing_workspace',
  'codex_running',
  'validating',
  'running'
]);

export function sanitizeAgentMessage(value: string): string {
  return value
    .replace(/docker|codex|pnpm|stdout|stderr|workspace/gi, '系统')
    .replace(/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g, '相关位置')
    .slice(0, 240);
}

export async function listAgentStreamEvents(input: {
  store: AppStore;
  project: ProjectDetail;
  limit?: number;
}): Promise<AgentStreamEvent[]> {
  const limit = input.limit ?? 30;
  const [traces, messages] = await Promise.all([
    input.store.listTraceEvents(input.project.id, limit),
    input.store.listAgentMessages(input.project.id, limit)
  ]);
  const traceEvents: AgentStreamEvent[] = traces
    .filter((event) => event.visibility === 'user')
    .map((event) => ({
      id: event.id,
      kind: event.type === 'error'
        ? 'error' as const
        : event.payload?.kind === 'user_message'
          ? 'user' as const
          : 'agent' as const,
      message: sanitizeAgentMessage(event.message),
      stage: typeof event.payload?.stage === 'string' ? event.payload.stage : undefined,
      stepKey: typeof event.payload?.stepKey === 'string' ? event.payload.stepKey : undefined,
      status: isAgentStreamStatus(event.payload?.status) ? event.payload.status : undefined,
      nextAction: typeof event.payload?.nextAction === 'string' ? sanitizeAgentMessage(event.payload.nextAction) : undefined,
      snapshotUrl: typeof event.payload?.snapshotUrl === 'string' ? event.payload.snapshotUrl : undefined,
      createdAt: event.createdAt
    }));
  const messageEvents = messages.map((message) => ({
    id: `agent-message-${message.id}`,
    kind: 'user' as const,
    message: formatAgentMessageForStream(message),
    stage: 'user_message',
    createdAt: message.createdAt
  }));
  return [...traceEvents, ...messageEvents]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-limit);
}

function isAgentStreamStatus(value: unknown): value is AgentStreamEvent['status'] {
  return value === 'start' || value === 'progress' || value === 'done' || value === 'failed';
}

export async function submitAgentMessage(input: {
  store: AppStore;
  project: ProjectDetail;
  user: UserProfile;
  content: string;
  env?: ApiEnv;
}): Promise<AgentMessageResult> {
  const content = input.content.trim();
  const active = await hasActiveTask(input.store, input.project.id);
  await input.store.appendTraceEvent({
    projectId: input.project.id,
    type: 'agent_started',
    visibility: 'user',
    message: '用户提出新的修改需求。',
    payload: {
      kind: 'user_message',
      stage: 'user_message',
      contentPreview: sanitizeAgentMessage(content)
    }
  });

  if (active) {
    const message = await input.store.createAgentMessage({
      projectId: input.project.id,
      userId: input.user.id,
      content,
      status: 'deferred'
    });
    const queuePosition = await input.store.countDeferredAgentMessages(input.project.id);
    return {
      accepted: true,
      queued: false,
      delivery: 'deferred',
      queuePosition,
      message: '已收到修改需求。当前版本仍在生成中，稍后会继续处理。'
    };
  }

  const message = await input.store.createAgentMessage({
    projectId: input.project.id,
    userId: input.user.id,
    content,
    status: 'received'
  });
  const readySnapshot = await getActiveReadySnapshot(input.store, input.project.id);
  if (!readySnapshot) {
    return {
      accepted: true,
      queued: false,
      delivery: 'received',
      queuePosition: 0,
      message: '已收到修改需求。初版生成完成后再处理修改。'
    };
  }

  const appSpec = await input.store.getLatestAppSpec(input.project.id);
  const designProfile = await getFallbackDesignProfile(input.store, input.project.id);
  if (!appSpec || !designProfile) {
    return {
      accepted: true,
      queued: false,
      delivery: 'received',
      queuePosition: 0,
      message: '已收到修改需求。应用方案准备完成后再处理修改。'
    };
  }

  const codexTask = await createAgentCodeEditTask({
    ...input,
    appSpec,
    designProfile,
    readySnapshot,
    message,
    env: input.env ?? loadEnv()
  });
  await input.store.updateAgentMessage(message.id, {
    status: 'processing',
    relatedTaskId: codexTask.id
  });

  return {
    accepted: true,
    queued: true,
    delivery: 'queued',
    queuePosition: 0,
    message: '已收到修改需求，正在排队生成新版本。'
  };
}

export async function drainDeferredAgentMessage(input: {
  store: AppStore;
  project: ProjectDetail;
  env?: ApiEnv;
}): Promise<CodexTaskRecord | undefined> {
  if (await hasActiveTask(input.store, input.project.id)) {
    return undefined;
  }

  const message = await input.store.getNextDeferredAgentMessage(input.project.id);
  if (!message) {
    return undefined;
  }

  const readySnapshot = await getActiveReadySnapshot(input.store, input.project.id);
  const appSpec = await input.store.getLatestAppSpec(input.project.id);
  const designProfile = await getFallbackDesignProfile(input.store, input.project.id);
  if (!readySnapshot || !appSpec || !designProfile) {
    return undefined;
  }

  const codexTask = await createAgentCodeEditTask({
    store: input.store,
    project: input.project,
    content: message.content,
    appSpec,
    designProfile,
    readySnapshot,
    message,
    env: input.env ?? loadEnv()
  });
  await input.store.updateAgentMessage(message.id, {
    status: 'processing',
    relatedTaskId: codexTask.id
  });
  return codexTask;
}

async function createAgentCodeEditTask(input: {
  store: AppStore;
  project: ProjectDetail;
  content: string;
  appSpec: AppSpecRecord;
  designProfile: DesignProfileRecord;
  readySnapshot: PreviewSnapshotRecord;
  message: AgentMessageRecord;
  env: ApiEnv;
}): Promise<CodexTaskRecord> {
  const sourceVersion = await getWorkspaceSourceVersion(input.store, input.project.id, input.readySnapshot.projectVersionId);
  const workspacePath = workspaceVersionPath({
    workspaceRoot: input.env.CODEX_WORKSPACE_ROOT,
    projectId: input.project.id,
    taskId: `agent-edit-${randomUUID()}`
  });

  if (sourceVersion?.workspacePath) {
    await copyWorkspaceVersion({
      sourcePath: sourceVersion.workspacePath,
      targetPath: workspacePath
    });
    await input.store.appendTraceEvent({
      projectId: input.project.id,
      type: 'workspace_copied',
      visibility: 'admin',
      message: 'Workspace copied for agent edit.',
      payload: {
        parentVersionId: sourceVersion.id
      }
    });
  }

  const workspace = await input.store.createWorkspace({
    projectId: input.project.id,
    projectVersionId: sourceVersion?.id ?? input.readySnapshot.projectVersionId,
    path: workspacePath,
    status: 'ready'
  });
  const taskPlan = createCodeEditTaskPlan({
    project: input.project,
    appSpec: input.appSpec,
    designProfile: input.designProfile,
    readySnapshot: input.readySnapshot,
    content: input.content
  });
  const codexTask = await input.store.createCodexTask({
    projectId: input.project.id,
    projectVersionId: sourceVersion?.id ?? input.readySnapshot.projectVersionId,
    workspaceId: workspace.id,
    ...taskPlan
  });
  await input.store.appendTraceEvent({
    projectId: input.project.id,
    codexTaskId: codexTask.id,
    type: 'codex_task_created',
    visibility: 'user',
    message: '已收到修改需求，正在排队生成新版本。',
    payload: {
      stage: 'queueing_app_build'
    }
  });
  return codexTask;
}

function createCodeEditTaskPlan(input: {
  project: ProjectDetail;
  appSpec: AppSpecRecord;
  designProfile: DesignProfileRecord;
  readySnapshot: PreviewSnapshotRecord;
  content: string;
}): CodexTaskPlan {
  const basePlan = createInitialCodexTaskPlan({
    project: input.project,
    appSpec: input.appSpec.spec,
    designProfile: input.designProfile.profile
  });
  const safeInstruction = sanitizeAgentMessage(input.content);

  return {
    ...basePlan,
    taskType: 'code_edit',
    objective: `Apply a user-requested update to ${input.appSpec.spec.appName}.`,
    inputSummary: [
      `应用: ${input.appSpec.spec.appName}`,
      `当前稳定版本: ${input.readySnapshot.projectVersionId}`,
      `用户修改需求: ${safeInstruction}`,
      '保持现有页面结构、可编辑标记和预览稳定性。'
    ].join('\n'),
    taskSpec: {
      ...basePlan.taskSpec,
      goal: `Apply a user-requested update to ${input.appSpec.spec.appName}.`,
      targetChange: {
        type: 'code_edit',
        summary: safeInstruction
      },
      expectedOutputs: ['Updated React/Vite app files', 'Valid ai-manifest.json', 'New versioned preview snapshot']
    }
  };
}

async function getFallbackDesignProfile(store: AppStore, projectId: string): Promise<DesignProfileRecord | undefined> {
  return await store.getSelectedDesignProfile(projectId) ?? (await store.listDesignProfiles(projectId))[0];
}

async function getActiveReadySnapshot(store: AppStore, projectId: string): Promise<PreviewSnapshotRecord | undefined> {
  const snapshots = await store.listPreviewSnapshots(projectId);
  return snapshots.find((snapshot) => snapshot.active && snapshot.status === 'ready')
    ?? snapshots.find((snapshot) => snapshot.status === 'ready');
}

async function getWorkspaceSourceVersion(store: AppStore, projectId: string, preferredVersionId: string) {
  const versions = await store.listProjectVersions(projectId);
  return versions.find((version) => version.id === preferredVersionId && version.workspacePath)
    ?? versions.find((version) => Boolean(version.workspacePath));
}

async function hasActiveTask(store: AppStore, projectId: string): Promise<boolean> {
  const tasks = await store.listCodexTasks(projectId);
  return tasks.some((task) => activeTaskStatuses.has(task.status));
}

function formatAgentMessageForStream(message: AgentMessageRecord): string {
  const suffix = {
    received: '已收到',
    deferred: '排队中',
    processing: '正在修改',
    completed: '修改完成',
    failed: '处理失败'
  }[message.status];
  return `${sanitizeAgentMessage(message.content)}（${suffix}）`;
}
