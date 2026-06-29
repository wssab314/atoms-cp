import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadEnv, parseExecutionEnvAllowlist } from './config/env.js';
import { runRealCanary, type RealCanaryConfig } from './modules/codex/realCanaryRunner.js';
import { createInMemoryStore } from './modules/data/inMemoryStore.js';
import { createMigratedPostgresPoolStore } from './modules/data/postgresStore.js';

const env = loadEnv();
const workerId = env.CODEX_WORKER_ID ?? `real-canary-${randomUUID()}`;
const store = env.DATA_STORE === 'postgres'
  ? await createMigratedPostgresPoolStore(env.DATABASE_URL, env.DATABASE_SCHEMA)
  : createInMemoryStore();

const config: RealCanaryConfig = {
  workerId,
  workspaceRoot: env.CODEX_WORKSPACE_ROOT,
  workerMode: env.CODEX_WORKER_MODE,
  dockerImage: env.CODEX_DOCKER_IMAGE,
  dockerTimeoutMs: env.CODEX_DOCKER_TIMEOUT_MS,
  dockerLogMaxBytes: env.CODEX_DOCKER_LOG_MAX_BYTES,
  realExecutionEnabled: env.CODEX_REAL_EXECUTION_ENABLED,
  realCommand: env.CODEX_REAL_COMMAND,
  dockerNetworkMode: env.CODEX_DOCKER_NETWORK_MODE,
  outputMaxFiles: env.CODEX_OUTPUT_MAX_FILES,
  outputMaxBytes: env.CODEX_OUTPUT_MAX_BYTES,
  executionEnvAllowlist: parseExecutionEnvAllowlist(env.CODEX_EXECUTION_ENV_ALLOWLIST),
  realPreflightOnly: env.CODEX_REAL_PREFLIGHT_ONLY,
  realCanaryEnabled: env.CODEX_REAL_CANARY_ENABLED,
  secretMountPath: env.CODEX_SECRET_MOUNT_PATH,
  taskLimitPerRun: env.CODEX_REAL_TASK_LIMIT_PER_RUN,
  dailyBudgetTasks: env.CODEX_REAL_DAILY_BUDGET_TASKS,
  realMaxRuntimeMs: env.CODEX_REAL_MAX_RUNTIME_MS,
  autoDisableOnFailure: env.CODEX_REAL_AUTO_DISABLE_ON_FAILURE
};

try {
  const report = await runRealCanary(store, config);
  console.log(JSON.stringify({
    service: 'atoms-cp-codex-worker-real-canary',
    status: report.status,
    executionProfile: report.executionProfile,
    workerId,
    projectId: report.projectId,
    taskId: report.taskId,
    projectVersionId: report.projectVersionId,
    buildJobId: report.buildJobId,
    timestamp: new Date().toISOString()
  }, null, 2));
} finally {
  await store.close?.();
}
