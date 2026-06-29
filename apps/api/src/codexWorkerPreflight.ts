import 'dotenv/config';
import { join } from 'node:path';
import { loadEnv, parseExecutionEnvAllowlist } from './config/env.js';
import { buildDockerCodexCommand } from './modules/codex/dockerExecutionAdapter.js';

const env = loadEnv();
const envAllowlist = parseExecutionEnvAllowlist(env.CODEX_EXECUTION_ENV_ALLOWLIST);
const command = buildDockerCodexCommand({
  image: env.CODEX_DOCKER_IMAGE,
  workspacePath: join(env.CODEX_WORKSPACE_ROOT, 'preflight', 'workspace'),
  timeoutMs: env.CODEX_DOCKER_TIMEOUT_MS,
  maxLogBytes: env.CODEX_DOCKER_LOG_MAX_BYTES,
  realExecutionEnabled: env.CODEX_REAL_EXECUTION_ENABLED,
  realCommand: env.CODEX_REAL_COMMAND,
  networkMode: env.CODEX_DOCKER_NETWORK_MODE,
  executionEnvAllowlist: envAllowlist,
  secretMountPath: env.CODEX_SECRET_MOUNT_PATH
});
const mountArg = command.args.find((arg) => arg.startsWith('type=bind,source='));
const imageIndex = command.args.indexOf(env.CODEX_DOCKER_IMAGE);

console.log(JSON.stringify({
  service: 'atoms-cp-codex-worker-preflight',
  status: 'passed',
  executionProfile: env.CODEX_REAL_EXECUTION_ENABLED ? 'docker_real_preflight' : 'docker_fixture',
  realExecutionEnabled: env.CODEX_REAL_EXECUTION_ENABLED,
    realExecutionArmed: ['docker', 'container'].includes(env.CODEX_WORKER_MODE)
    && env.CODEX_REAL_EXECUTION_ENABLED
    && (env.CODEX_REAL_CANARY_ENABLED || env.CODEX_REAL_USER_TASKS_ENABLED)
    && env.CODEX_REAL_COMMAND.trim().length > 0
    && env.CODEX_SECRET_MOUNT_PATH.trim().length > 0
    && env.CODEX_REAL_TASK_LIMIT_PER_RUN === 1
    && env.CODEX_DOCKER_NETWORK_MODE === 'bridge'
    && !env.CODEX_REAL_PREFLIGHT_ONLY,
  realPreflightOnly: env.CODEX_REAL_PREFLIGHT_ONLY,
  docker: {
    image: env.CODEX_DOCKER_IMAGE,
    timeoutMs: command.timeoutMs,
    maxLogBytes: command.maxLogBytes,
    networkMode: env.CODEX_DOCKER_NETWORK_MODE,
    user: command.args[command.args.indexOf('--user') + 1],
    workdir: command.args[command.args.indexOf('--workdir') + 1],
    hasWorkspaceMount: Boolean(mountArg),
    hasSecretMount: command.args.some((arg) => arg.includes('target=/run/secrets/codex_api_key,readonly')),
    envKeys: Object.keys(command.env).filter((key) => key !== 'PATH')
  },
  canary: {
    enabled: env.CODEX_REAL_CANARY_ENABLED,
    userTasksEnabled: env.CODEX_REAL_USER_TASKS_ENABLED,
    secretMountConfigured: env.CODEX_SECRET_MOUNT_PATH.trim().length > 0,
    taskLimitPerRun: env.CODEX_REAL_TASK_LIMIT_PER_RUN,
    dailyBudgetTasks: env.CODEX_REAL_DAILY_BUDGET_TASKS,
    maxRuntimeMs: env.CODEX_REAL_MAX_RUNTIME_MS,
    autoDisableOnFailure: env.CODEX_REAL_AUTO_DISABLE_ON_FAILURE
  },
  outputPolicy: {
    maxFiles: env.CODEX_OUTPUT_MAX_FILES,
    maxBytes: env.CODEX_OUTPUT_MAX_BYTES
  },
  commandShape: {
    file: command.file,
    hasShellEntrypoint: imageIndex >= 0 && command.args[imageIndex + 1] === 'sh' && command.args[imageIndex + 2] === '-lc',
    hasDockerSocketMount: command.args.some((arg) => arg.includes('/var/run/docker.sock')),
    hasHomeMount: command.args.some((arg) => arg.includes(process.env.HOME ?? '__no_home__')),
    hasEnvFileMount: command.args.some((arg) => arg.includes('.env'))
  },
  timestamp: new Date().toISOString()
}, null, 2));
