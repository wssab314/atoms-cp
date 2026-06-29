import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppSpec, DesignProfile, UserProfile } from '@atoms-cp/shared';
import type { AppStore } from '../data/appStore.js';
import { createInitialCodexTaskPlan } from '../orchestrator/codexTaskPlanner.js';
import { processNextCodexTask, type DryRunCodexWorkerResult } from './dryRunCodexWorker.js';
import {
  createDockerExecutionAdapter,
  type DockerCodexCommand,
  type DockerCodexCommandResult,
  type DockerCodexNetworkMode
} from './dockerExecutionAdapter.js';
import type { CodexWorkerMode } from './codexWorkerRuntime.js';

export interface RealCanaryConfig {
  workerId: string;
  workspaceRoot: string;
  workerMode: CodexWorkerMode;
  dockerImage: string;
  dockerTimeoutMs: number;
  dockerLogMaxBytes: number;
  realExecutionEnabled: boolean;
  realCommand: string;
  dockerNetworkMode: DockerCodexNetworkMode;
  outputMaxFiles: number;
  outputMaxBytes: number;
  executionEnvAllowlist: string[];
  realPreflightOnly: boolean;
  realCanaryEnabled: boolean;
  secretMountPath: string;
  taskLimitPerRun: number;
  dailyBudgetTasks: number;
  realMaxRuntimeMs: number;
  autoDisableOnFailure: boolean;
}

export interface RealCanaryRunOptions {
  runCommand?: (command: DockerCodexCommand) => Promise<DockerCodexCommandResult>;
}

export interface RealCanaryRunReport extends DryRunCodexWorkerResult {
  executionProfile: 'docker_real_canary';
  canaryProjectId: string;
}

export interface RealCanaryStatusReport {
  status: 'idle' | 'queued' | 'claimed' | 'preparing_workspace' | 'codex_running' | 'validating' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  latestTask?: {
    id: string;
    projectId: string;
    status: string;
    attemptCount: number;
    errorSummary?: string;
    resultSummary?: string;
    createdAt: string;
    finishedAt?: string;
  };
  latestBuildJob?: {
    id: string;
    projectId: string;
    status: string;
    errorSummary?: string;
    previewUrl?: string;
  };
  latestPreviewSnapshot?: {
    id: string;
    projectId: string;
    status: string;
    active: boolean;
    url?: string;
  };
  traceSummary: Array<{
    type: string;
    message: string;
    createdAt: string;
  }>;
}

const realCanaryTag = '[real-canary]';
const canaryUser: UserProfile = {
  id: 'user-admin',
  email: 'admin@example.local',
  name: 'Admin',
  role: 'admin'
};

function createCanaryAppSpec(projectName: string): AppSpec {
  return {
    appName: projectName,
    appGoal: '验证 staging 真实 Codex Worker canary 能生成可构建的应用版本。',
    targetUser: '内部运维人员',
    pages: [
      {
        id: 'home',
        name: '首页',
        route: '/',
        purpose: '展示真实 canary 生成结果。',
        sections: [
          {
            id: 'hero',
            kind: 'hero',
            title: '真实 canary 验证',
            content: '用于检查 workspace、manifest、build job 和 trace 闭环。'
          }
        ],
        actions: [
          {
            id: 'continue',
            label: '继续修改',
            type: 'submit'
          }
        ]
      }
    ],
    styleIntent: {
      tone: 'quiet',
      layoutDensity: 'comfortable'
    },
    dataModels: [],
    integrations: [],
    constraints: ['普通用户界面不出现底层技术词。'],
    nonGoals: ['不发布到真实生产域名。'],
    acceptanceCriteria: ['生成合法 ai-manifest.json', '产生 project version', '排队 build job']
  };
}

function createCanaryDesignProfile(): DesignProfile {
  return {
    id: 'real-canary-quiet-builder',
    name: 'Real Canary Quiet Builder',
    description: '用于 staging canary 的安静应用构建风格。',
    bestFor: '内部验证',
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
    layoutGuidelines: ['Use a quiet dashboard hierarchy.'],
    componentGuidelines: ['Use light cards and clear primary actions.'],
    previewDescription: '安静的内部 canary 应用。'
  };
}

function isRealCanaryTask(task: { objective: string; inputSummary: string }): boolean {
  return task.objective.includes(realCanaryTag) || task.inputSummary.includes(realCanaryTag);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function assertRealCanaryRunnable(config: RealCanaryConfig): void {
  if (config.workerMode !== 'docker') {
    throw new Error('Real canary requires CODEX_WORKER_MODE=docker.');
  }

  if (!config.realExecutionEnabled) {
    throw new Error('Real canary requires CODEX_REAL_EXECUTION_ENABLED=true.');
  }

  if (!config.realCanaryEnabled) {
    throw new Error('Real canary requires CODEX_REAL_CANARY_ENABLED=true.');
  }

  if (config.realPreflightOnly) {
    throw new Error('Real canary requires CODEX_REAL_PREFLIGHT_ONLY=false.');
  }

  if (config.realCommand.trim().length === 0) {
    throw new Error('Real canary requires CODEX_REAL_COMMAND.');
  }

  if (config.secretMountPath.trim().length === 0) {
    throw new Error('Real canary requires CODEX_SECRET_MOUNT_PATH.');
  }

  if (config.dockerNetworkMode !== 'bridge') {
    throw new Error('Real canary requires CODEX_DOCKER_NETWORK_MODE=bridge in staging.');
  }

  if (config.taskLimitPerRun !== 1) {
    throw new Error('Real canary requires CODEX_REAL_TASK_LIMIT_PER_RUN=1.');
  }

  if (config.dailyBudgetTasks < 1) {
    throw new Error('Real canary requires a positive daily task budget.');
  }

  if (config.realMaxRuntimeMs < 1 || config.realMaxRuntimeMs > 600000) {
    throw new Error('Real canary requires CODEX_REAL_MAX_RUNTIME_MS between 1 and 600000.');
  }
}

async function assertSecretReadable(secretMountPath: string): Promise<void> {
  try {
    await access(secretMountPath);
  } catch {
    throw new Error('Real canary secret mount is not readable.');
  }
}

async function enforceRealCanaryBudget(store: AppStore, config: RealCanaryConfig): Promise<void> {
  const recentTasks = (await store.listRecentCodexTasks(100)).filter(isRealCanaryTask);
  const latestTask = recentTasks[0];

  if (config.autoDisableOnFailure && latestTask?.status === 'failed') {
    throw new Error('Real canary is auto-disabled after the latest canary failure.');
  }

  const todayCount = recentTasks.filter((task) => task.createdAt.slice(0, 10) === todayIsoDate()).length;

  if (todayCount >= config.dailyBudgetTasks) {
    throw new Error('Real canary daily canary budget is exhausted.');
  }
}

async function createCanaryTask(store: AppStore, config: RealCanaryConfig) {
  const user = await store.ensureUser(canaryUser);
  const projectName = `R9.1 Real Canary ${new Date().toISOString()}`;
  const project = await store.createProject(user, {
    name: projectName,
    prompt: '内部 staging canary：验证真实 Codex Worker 只改 allowed paths 并产生可构建版本。',
    target: 'web'
  });
  const appSpec = createCanaryAppSpec(projectName);
  const agentRun = await store.createAgentRun({
    projectId: project.id,
    purpose: 'app_spec_generation',
    provider: 'volcengine',
    status: 'succeeded',
    inputSnapshot: {
      canary: true
    },
    outputSnapshot: {
      appName: appSpec.appName
    }
  });
  const appSpecRecord = await store.createAppSpec({
    projectId: project.id,
    sourceAgentRunId: agentRun.id,
    spec: appSpec
  });
  const [designRecord] = await store.createDesignProfiles({
    projectId: project.id,
    specVersionId: appSpecRecord.id,
    profiles: [createCanaryDesignProfile()]
  });

  if (!designRecord) {
    throw new Error('Real canary design profile was not created.');
  }

  await store.selectDesignProfile(project.id, designRecord.id);
  const workspace = await store.createWorkspace({
    projectId: project.id,
    path: join(config.workspaceRoot, project.id, 'real-canary'),
    status: 'ready'
  });
  const taskPlan = createInitialCodexTaskPlan({
    project,
    appSpec,
    designProfile: designRecord.profile
  });
  const task = await store.createCodexTask({
    projectId: project.id,
    workspaceId: workspace.id,
    ...taskPlan,
    objective: `${realCanaryTag} ${taskPlan.objective}`,
    inputSummary: `${realCanaryTag}\n${taskPlan.inputSummary}`
  });
  await store.appendTraceEvent({
    projectId: project.id,
    codexTaskId: task.id,
    type: 'codex_task_created',
    visibility: 'admin',
    message: 'R9.1 real canary CodexTask created.',
    payload: {
      executionProfile: 'docker_real_canary',
      networkMode: config.dockerNetworkMode,
      outputMaxFiles: config.outputMaxFiles,
      outputMaxBytes: config.outputMaxBytes
    }
  });
  return {
    project,
    task
  };
}

export async function runRealCanary(
  store: AppStore,
  config: RealCanaryConfig,
  options: RealCanaryRunOptions = {}
): Promise<RealCanaryRunReport> {
  assertRealCanaryRunnable(config);
  await enforceRealCanaryBudget(store, config);
  await assertSecretReadable(config.secretMountPath);
  const { project, task } = await createCanaryTask(store, config);
  const executionAdapter = createDockerExecutionAdapter({
    image: config.dockerImage,
    timeoutMs: Math.min(config.dockerTimeoutMs, config.realMaxRuntimeMs),
    maxLogBytes: config.dockerLogMaxBytes,
    realExecutionEnabled: true,
    realCommand: config.realCommand,
    networkMode: config.dockerNetworkMode,
    outputMaxFiles: config.outputMaxFiles,
    outputMaxBytes: config.outputMaxBytes,
    executionEnvAllowlist: config.executionEnvAllowlist,
    secretMountPath: config.secretMountPath,
    realPreflightOnly: false,
    runCommand: options.runCommand
  });
  const result = await processNextCodexTask(store, {
    workerId: config.workerId,
    workspaceRoot: config.workspaceRoot,
    executionAdapter,
    claimTask: async (workerId) => await store.claimCodexTask(task.id, workerId)
  });

  if (!result) {
    throw new Error('Real canary task was not claimed.');
  }

  return {
    ...result,
    executionProfile: 'docker_real_canary',
    canaryProjectId: project.id
  };
}

export async function reportRealCanary(store: AppStore): Promise<RealCanaryStatusReport> {
  const recentTasks = (await store.listRecentCodexTasks(100)).filter(isRealCanaryTask);
  const latestTask = recentTasks[0];

  if (!latestTask) {
    return {
      status: 'idle',
      traceSummary: []
    };
  }

  const [buildJob] = (await store.listRecentBuildJobs(50)).filter((job) => job.projectId === latestTask.projectId);
  const [snapshot] = (await store.listRecentPreviewSnapshots(50)).filter((item) => item.projectId === latestTask.projectId);
  const traces = await store.listTraceEvents(latestTask.projectId, 10);

  return {
    status: latestTask.status,
    latestTask: {
      id: latestTask.id,
      projectId: latestTask.projectId,
      status: latestTask.status,
      attemptCount: latestTask.attemptCount,
      errorSummary: latestTask.errorSummary,
      resultSummary: latestTask.resultSummary,
      createdAt: latestTask.createdAt,
      finishedAt: latestTask.finishedAt
    },
    latestBuildJob: buildJob ? {
      id: buildJob.id,
      projectId: buildJob.projectId,
      status: buildJob.status,
      errorSummary: buildJob.errorSummary,
      previewUrl: buildJob.previewUrl
    } : undefined,
    latestPreviewSnapshot: snapshot ? {
      id: snapshot.id,
      projectId: snapshot.projectId,
      status: snapshot.status,
      active: snapshot.active,
      url: snapshot.url
    } : undefined,
    traceSummary: traces.map((trace) => ({
      type: trace.type,
      message: trace.message,
      createdAt: trace.createdAt
    }))
  };
}
