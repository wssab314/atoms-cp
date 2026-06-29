import type { FastifyInstance } from 'fastify';
import {
  adminBuildJobSchema,
  adminOperationsSchema,
  adminRuntimeSummarySchema,
  agentRunSummarySchema,
  modelInvocationSummarySchema,
  type AdminBuildJob,
  type CodexTaskRecord,
  type PreviewSnapshotRecord,
  type TraceEventRecord,
  type SupabaseConfigRecord
} from '@atoms-cp/shared';
import type { ApiEnv } from '../config/env.js';
import { getModelRuntimeConfig, loadEnv } from '../config/env.js';
import { isAdminUser, resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';

function isConfigured(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function buildIdleBuildJob(projectId: string | undefined): AdminBuildJob {
  return adminBuildJobSchema.parse({
    id: 'build-idle',
    projectId: projectId ?? 'no-project',
    status: 'idle',
    createdAt: new Date().toISOString()
  });
}

function getLatestSupabaseCheck(configs: SupabaseConfigRecord[]): SupabaseConfigRecord | undefined {
  return configs
    .filter((config) => config.lastConnectionCheckedAt)
    .sort((first, second) => String(second.lastConnectionCheckedAt).localeCompare(String(first.lastConnectionCheckedAt)))[0];
}

function buildConnectorStatuses(
  env: ApiEnv,
  model: ReturnType<typeof getModelRuntimeConfig>,
  supabaseConfigs: SupabaseConfigRecord[]
) {
  const githubConfigured = (isConfigured(env.GITHUB_CLIENT_ID) && isConfigured(env.GITHUB_CLIENT_SECRET)) || isConfigured(env.GITHUB_TOKEN);
  const supabaseProjectConfigured = supabaseConfigs.length > 0;
  const supabaseSecretConfigured =
    isConfigured(env.SUPABASE_SERVICE_ROLE_KEY) || supabaseConfigs.some((config) => isConfigured(config.serviceRoleKeyEncrypted));
  const latestSupabaseCheck = getLatestSupabaseCheck(supabaseConfigs);
  const supabaseHasFailure = supabaseConfigs.some((config) => config.lastConnectionStatus === 'failed');
  const supabaseStatus = supabaseHasFailure
    ? 'error'
    : (isConfigured(env.SUPABASE_URL) && isConfigured(env.SUPABASE_SERVICE_ROLE_KEY)) || supabaseProjectConfigured
      ? 'configured'
      : 'not_configured';
  const supabaseDetail = supabaseProjectConfigured
    ? `${supabaseConfigs.length} project Supabase config${supabaseConfigs.length === 1 ? '' : 's'}; latest live check ${latestSupabaseCheck?.lastConnectionStatus ?? 'not_run'}.`
    : isConfigured(env.SUPABASE_URL)
      ? 'Project URL configured'
      : 'Project URL not configured';

  return [
    {
      id: 'model-provider',
      label: model.provider === 'volcengine' ? 'Volcengine Ark' : 'DeepSeek',
      status: model.apiKeyConfigured ? 'configured' : 'not_configured',
      secretState: model.apiKeyConfigured ? 'configured' : 'missing',
      detail: `${model.model} via backend runtime`
    },
    {
      id: 'github',
      label: 'GitHub',
      status: githubConfigured ? 'configured' : 'not_configured',
      secretState: githubConfigured ? 'configured' : 'missing',
      detail: isConfigured(env.GITHUB_CLIENT_ID) && isConfigured(env.GITHUB_CLIENT_SECRET)
        ? 'OAuth app configured for repository handoff'
        : isConfigured(env.GITHUB_TOKEN)
          ? 'Repository handoff token configured'
          : 'OAuth app or token not configured'
    },
    {
      id: 'supabase',
      label: 'Supabase',
      status: supabaseStatus,
      secretState: supabaseSecretConfigured ? 'configured' : 'missing',
      detail: supabaseDetail,
      projectsAffected: supabaseConfigs.length,
      lastCheckStatus: latestSupabaseCheck?.lastConnectionStatus,
      lastCheckedAt: latestSupabaseCheck?.lastConnectionCheckedAt
    },
    {
      id: 'vercel',
      label: 'Vercel',
      status: isConfigured(env.VERCEL_TOKEN) ? 'configured' : 'not_configured',
      secretState: isConfigured(env.VERCEL_TOKEN) ? 'configured' : 'missing',
      detail: isConfigured(env.VERCEL_TOKEN) ? 'Deploy token configured' : 'Deploy token not configured'
    }
  ];
}

function buildMaskedSystemConfig(env: ApiEnv) {
  return [
    {
      key: 'MODEL_PROVIDER',
      value: env.MODEL_PROVIDER,
      sensitive: false
    },
    {
      key: 'DEEPSEEK_API_KEY',
      value: isConfigured(env.DEEPSEEK_API_KEY) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'VOLCENGINE_API_KEY_FILE',
      value: isConfigured(env.VOLCENGINE_API_KEY_FILE) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'DATABASE_URL',
      value: isConfigured(env.DATABASE_URL) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'REDIS_URL',
      value: isConfigured(env.REDIS_URL) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'MODEL_BUDGET_CNY',
      value: String(env.MODEL_BUDGET_CNY),
      sensitive: false
    },
    {
      key: 'GITHUB_TOKEN',
      value: isConfigured(env.GITHUB_TOKEN) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'GITHUB_CLIENT_ID',
      value: isConfigured(env.GITHUB_CLIENT_ID) ? 'configured' : 'not_configured',
      sensitive: false
    },
    {
      key: 'GITHUB_CLIENT_SECRET',
      value: isConfigured(env.GITHUB_CLIENT_SECRET) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'GITHUB_TOKEN_ENCRYPTION_KEY',
      value: isConfigured(env.GITHUB_TOKEN_ENCRYPTION_KEY) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'CONNECTOR_TOKEN_ENCRYPTION_KEY',
      value: isConfigured(env.CONNECTOR_TOKEN_ENCRYPTION_KEY) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      value: isConfigured(env.SUPABASE_SERVICE_ROLE_KEY) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'VERCEL_TOKEN',
      value: isConfigured(env.VERCEL_TOKEN) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'CODEX_WORKER_MODE',
      value: env.CODEX_WORKER_MODE,
      sensitive: false
    },
    {
      key: 'CODEX_REAL_EXECUTION_ENABLED',
      value: env.CODEX_REAL_EXECUTION_ENABLED ? 'enabled' : 'disabled',
      sensitive: false
    },
    {
      key: 'CODEX_REAL_COMMAND',
      value: isConfigured(env.CODEX_REAL_COMMAND) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'CODEX_REAL_PREFLIGHT_ONLY',
      value: env.CODEX_REAL_PREFLIGHT_ONLY ? 'true' : 'false',
      sensitive: false
    },
    {
      key: 'CODEX_DOCKER_NETWORK_MODE',
      value: env.CODEX_DOCKER_NETWORK_MODE,
      sensitive: false
    },
    {
      key: 'CODEX_OUTPUT_MAX_FILES',
      value: String(env.CODEX_OUTPUT_MAX_FILES),
      sensitive: false
    },
    {
      key: 'CODEX_OUTPUT_MAX_BYTES',
      value: String(env.CODEX_OUTPUT_MAX_BYTES),
      sensitive: false
    },
    {
      key: 'CODEX_REAL_CANARY_ENABLED',
      value: env.CODEX_REAL_CANARY_ENABLED ? 'enabled' : 'disabled',
      sensitive: false
    },
    {
      key: 'CODEX_REAL_USER_TASKS_ENABLED',
      value: env.CODEX_REAL_USER_TASKS_ENABLED ? 'enabled' : 'disabled',
      sensitive: false
    },
    {
      key: 'CODEX_SECRET_MOUNT_PATH',
      value: isConfigured(env.CODEX_SECRET_MOUNT_PATH) ? 'configured' : 'not_configured',
      sensitive: true
    },
    {
      key: 'CODEX_REAL_TASK_LIMIT_PER_RUN',
      value: String(env.CODEX_REAL_TASK_LIMIT_PER_RUN),
      sensitive: false
    },
    {
      key: 'CODEX_REAL_DAILY_BUDGET_TASKS',
      value: String(env.CODEX_REAL_DAILY_BUDGET_TASKS),
      sensitive: false
    },
    {
      key: 'CODEX_REAL_MAX_RUNTIME_MS',
      value: String(env.CODEX_REAL_MAX_RUNTIME_MS),
      sensitive: false
    },
    {
      key: 'CODEX_REAL_AUTO_DISABLE_ON_FAILURE',
      value: env.CODEX_REAL_AUTO_DISABLE_ON_FAILURE ? 'true' : 'false',
      sensitive: false
    }
  ];
}

function buildRuntimeSummary(input: {
  buildJobs: AdminBuildJob[];
  codexTasks: CodexTaskRecord[];
  previewSnapshots: PreviewSnapshotRecord[];
  traceEvents: TraceEventRecord[];
}) {
  const activeCodexStatuses = new Set(['claimed', 'preparing_workspace', 'codex_running', 'validating', 'running']);
  const activeBuildStatuses = new Set(['queued', 'running']);
  const failedCodexTask = input.codexTasks.find((task) => task.status === 'failed' && task.errorSummary);
  const failedBuildJob = input.buildJobs.find((job) => job.status === 'failed' && job.errorSummary);

  return adminRuntimeSummarySchema.parse({
    activeCodexTasks: input.codexTasks.filter((task) => activeCodexStatuses.has(task.status)).length,
    failedCodexTasks: input.codexTasks.filter((task) => task.status === 'failed').length,
    activeBuildJobs: input.buildJobs.filter((job) => activeBuildStatuses.has(job.status)).length,
    failedBuildJobs: input.buildJobs.filter((job) => job.status === 'failed').length,
    readyPreviewSnapshots: input.previewSnapshots.filter((snapshot) => snapshot.status === 'ready').length,
    activePreviewSnapshots: input.previewSnapshots.filter((snapshot) => snapshot.active && snapshot.status === 'ready').length,
    recoveredEvents: input.traceEvents.filter((event) => event.type === 'error' && event.payload.stale === true).length,
    lastFailureSummary: failedCodexTask?.errorSummary ?? failedBuildJob?.errorSummary
  });
}

export async function registerAdminRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.get('/api/admin/overview', async (request, reply) => {
    const user = resolveRequestUser(request);

    if (!isAdminUser(user)) {
      return reply.code(403).send({
        error: 'Admin role required'
      });
    }

    const env = loadEnv();
    const model = getModelRuntimeConfig(env);
    return await store.getAdminOverview(model);
  });

  app.get('/api/admin/users', async (request, reply) => {
    const user = resolveRequestUser(request);

    if (!isAdminUser(user)) {
      return reply.code(403).send({
        error: 'Admin role required'
      });
    }

    return await store.listUsers();
  });

  app.get('/api/admin/projects', async (request, reply) => {
    const user = resolveRequestUser(request);

    if (!isAdminUser(user)) {
      return reply.code(403).send({
        error: 'Admin role required'
      });
    }

    return await store.listAllProjects();
  });

  app.get('/api/admin/operations', async (request, reply) => {
    const user = resolveRequestUser(request);

    if (!isAdminUser(user)) {
      return reply.code(403).send({
        error: 'Admin role required'
      });
    }

    const env = loadEnv();
    const model = getModelRuntimeConfig(env);
    const [
      overview,
      users,
      projects,
      agentRuns,
      modelInvocations,
      buildJobs,
      codexTasks,
      previewSnapshots,
      traceEvents,
      supabaseConfigs
    ] = await Promise.all([
      store.getAdminOverview(model),
      store.listUsers(),
      store.listAllProjects(),
      store.listRecentAgentRuns(10),
      store.listRecentModelInvocations(10),
      store.listRecentBuildJobs(10),
      store.listRecentCodexTasks(10),
      store.listRecentPreviewSnapshots(10),
      store.listRecentTraceEvents(10),
      store.listProjectSupabaseConfigs()
    ]);
    const displayBuildJobs = buildJobs.length > 0 ? buildJobs : [buildIdleBuildJob(projects[0]?.id)];

    return adminOperationsSchema.parse({
      dataSource: overview.dataSource,
      users,
      projects,
      buildJobs: displayBuildJobs,
      agentRuns: agentRuns.map((run) => agentRunSummarySchema.parse(run)),
      modelInvocations: modelInvocations.map((invocation) => modelInvocationSummarySchema.parse(invocation)),
      codexTasks,
      previewSnapshots,
      traceEvents,
      runtimeSummary: buildRuntimeSummary({
        buildJobs: displayBuildJobs,
        codexTasks,
        previewSnapshots,
        traceEvents
      }),
      connectors: buildConnectorStatuses(env, model, supabaseConfigs),
      systemConfig: buildMaskedSystemConfig(env),
      modelUsage: {
        provider: model.provider,
        budgetCny: model.budgetCny,
        estimatedSpendCny: overview.estimatedSpendCny,
        modelCallsToday: overview.modelCallsToday,
        invocationsCount: overview.modelInvocationsCount
      }
    });
  });
}
