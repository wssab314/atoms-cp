import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadEnv, parseExecutionEnvAllowlist } from './config/env.js';
import { createInMemoryStore } from './modules/data/inMemoryStore.js';
import { createMigratedPostgresPoolStore } from './modules/data/postgresStore.js';
import { startCodexWorkerLoop } from './modules/codex/codexWorkerRuntime.js';

const env = loadEnv();
const workerId = env.CODEX_WORKER_ID ?? `codex-worker-${randomUUID()}`;

if (env.CODEX_REAL_EXECUTION_ENABLED && env.CODEX_REAL_CANARY_ENABLED && !env.CODEX_REAL_PREFLIGHT_ONLY) {
  throw new Error('Real canary execution must use codex-worker:real-canary instead of the long-running codex worker loop.');
}

if (env.CODEX_REAL_EXECUTION_ENABLED && !env.CODEX_REAL_CANARY_ENABLED && !env.CODEX_REAL_USER_TASKS_ENABLED) {
  throw new Error('Real user Codex execution requires CODEX_REAL_USER_TASKS_ENABLED=true outside canary mode.');
}

const store = env.DATA_STORE === 'postgres'
  ? await createMigratedPostgresPoolStore(env.DATABASE_URL, env.DATABASE_SCHEMA)
  : createInMemoryStore();

const timer = startCodexWorkerLoop(store, {
  workerId,
  mode: env.CODEX_WORKER_MODE,
  intervalMs: env.CODEX_WORKER_INTERVAL_MS,
  workspaceRoot: env.CODEX_WORKSPACE_ROOT,
  dockerImage: env.CODEX_DOCKER_IMAGE,
  dockerTimeoutMs: env.CODEX_DOCKER_TIMEOUT_MS,
  dockerLogMaxBytes: env.CODEX_DOCKER_LOG_MAX_BYTES,
  executionIdleTimeoutMs: env.CODEX_EXECUTION_IDLE_TIMEOUT_MS,
  executionHeartbeatMs: env.CODEX_EXECUTION_HEARTBEAT_MS,
  realExecutionEnabled: env.CODEX_REAL_EXECUTION_ENABLED,
  realCommand: env.CODEX_REAL_COMMAND,
  dockerNetworkMode: env.CODEX_DOCKER_NETWORK_MODE,
  outputMaxFiles: env.CODEX_OUTPUT_MAX_FILES,
  outputMaxBytes: env.CODEX_OUTPUT_MAX_BYTES,
  executionEnvAllowlist: parseExecutionEnvAllowlist(env.CODEX_EXECUTION_ENV_ALLOWLIST),
  secretMountPath: env.CODEX_SECRET_MOUNT_PATH,
  realPreflightOnly: env.CODEX_REAL_PREFLIGHT_ONLY,
  realUserTasksEnabled: env.CODEX_REAL_USER_TASKS_ENABLED,
  codexTaskStaleMs: env.CODEX_TASK_STALE_MS,
  buildJobStaleMs: env.BUILD_JOB_STALE_MS
});

async function shutdown(signal: string): Promise<void> {
  clearInterval(timer);
  await store.close?.();
  console.log(JSON.stringify({
    service: 'atoms-cp-codex-worker',
    workerId,
    status: 'stopped',
    signal,
    timestamp: new Date().toISOString()
  }));
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0));
});
