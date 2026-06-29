import 'dotenv/config';
import { modelRuntimeConfigSchema, type ModelRuntimeConfig } from '@atoms-cp/shared';
import { z } from 'zod';

const developmentSecrets = {
  GITHUB_TOKEN_ENCRYPTION_KEY: 'development-github-token-key',
  CONNECTOR_TOKEN_ENCRYPTION_KEY: 'development-connector-token-key',
  PREVIEW_ACCESS_SECRET: 'development-preview-access-secret'
} as const;

const databaseSchemaSchema = z.string()
  .min(1)
  .max(63)
  .regex(/^[a-z_][a-z0-9_]*$/, 'Database schema must be a safe Postgres identifier');

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_WEB_ORIGIN: z.string().url().optional(),
  PUBLIC_API_ORIGIN: z.string().url().optional(),
  ALLOWED_CORS_ORIGINS: z.string().optional(),
  DATA_STORE: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().min(1).default('postgres://atoms:atoms@localhost:5432/atoms_cp'),
  DATABASE_SCHEMA: databaseSchemaSchema.default('atoms_cp'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().min(1).default('atoms_cp:'),
  AUTH_MODE: z.enum(['local']).default('local'),
  AUTH_SESSION_SECRET: z.string().min(12).default(developmentSecrets.PREVIEW_ACCESS_SECRET),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().max(30).default(7),
  MODEL_PROVIDER: z.enum(['deepseek', 'volcengine']).default('volcengine'),
  MODEL_API_KEY: z.string().optional(),
  MODEL_BASE_URL: z.string().url().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().min(1).default('deepseek-v4-pro'),
  DEEPSEEK_FALLBACK_MODEL: z.string().min(1).default('deepseek-v4-flash'),
  VOLCENGINE_API_KEY_FILE: z.string().optional(),
  VOLCENGINE_BASE_URL: z.string().url().default('https://ark.cn-beijing.volces.com/api/v3'),
  VOLCENGINE_MODEL: z.string().min(1).default('doubao-seed-2-1-turbo-260628'),
  MODEL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(180000).default(60000),
  MODEL_BUDGET_CNY: z.coerce.number().positive().default(25),
  ADMIN_BOOTSTRAP_EMAILS: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),
  GITHUB_TOKEN_ENCRYPTION_KEY: z.string().min(12).default(developmentSecrets.GITHUB_TOKEN_ENCRYPTION_KEY),
  CONNECTOR_TOKEN_ENCRYPTION_KEY: z.string().min(12).default(developmentSecrets.CONNECTOR_TOKEN_ENCRYPTION_KEY),
  VERCEL_TOKEN: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),
  VERCEL_API_BASE_URL: z.string().url().default('https://api.vercel.com'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  PREVIEW_BASE_URL: z.string().url().default('http://localhost:4000/preview'),
  PREVIEW_ROOT_DIR: z.string().min(1).default('/tmp/atoms-cp-previews'),
  PREVIEW_ACCESS_SECRET: z.string().min(12).default(developmentSecrets.PREVIEW_ACCESS_SECRET),
  WORKSPACE_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  PREVIEW_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  BUILD_WORKSPACE_ROOT: z.string().min(1).default('/tmp/atoms-cp-build-workspaces'),
  BUILD_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),
  CODEX_WORKER_ID: z.string().min(1).optional(),
  CODEX_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  CODEX_WORKER_MODE: z.enum(['deterministic', 'docker', 'container']).default('docker'),
  CODEX_WORKSPACE_ROOT: z.string().min(1).default('/tmp/atoms-cp-workspaces'),
  CODEX_DOCKER_IMAGE: z.string().min(1).default('node:22-alpine'),
  CODEX_DOCKER_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  CODEX_DOCKER_LOG_MAX_BYTES: z.coerce.number().int().positive().default(65536),
  CODEX_EXECUTION_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  CODEX_EXECUTION_HEARTBEAT_MS: z.coerce.number().int().positive().default(30000),
  CODEX_REAL_EXECUTION_ENABLED: booleanEnvSchema.default(false),
  CODEX_REAL_COMMAND: z.string().default(''),
  CODEX_DOCKER_NETWORK_MODE: z.enum(['none', 'bridge']).default('none'),
  CODEX_OUTPUT_MAX_FILES: z.coerce.number().int().positive().max(1000).default(200),
  CODEX_OUTPUT_MAX_BYTES: z.coerce.number().int().positive().max(50 * 1024 * 1024).default(5 * 1024 * 1024),
  CODEX_EXECUTION_ENV_ALLOWLIST: z.string().default(''),
  CODEX_REAL_PREFLIGHT_ONLY: booleanEnvSchema.default(true),
  CODEX_REAL_CANARY_ENABLED: booleanEnvSchema.default(false),
  CODEX_REAL_USER_TASKS_ENABLED: booleanEnvSchema.default(false),
  CODEX_SECRET_MOUNT_PATH: z.string().default(''),
  CODEX_REAL_TASK_LIMIT_PER_RUN: z.coerce.number().int().positive().max(10).default(1),
  CODEX_REAL_DAILY_BUDGET_TASKS: z.coerce.number().int().positive().max(10).default(3),
  CODEX_REAL_MAX_RUNTIME_MS: z.coerce.number().int().positive().max(30 * 60 * 1000).default(600000),
  CODEX_REAL_AUTO_DISABLE_ON_FAILURE: booleanEnvSchema.default(true),
  CODEX_TASK_STALE_MS: z.coerce.number().int().positive().default(900000),
  BUILD_JOB_STALE_MS: z.coerce.number().int().positive().default(900000),
  INTERNAL_BETA_SMOKE_MODE: z.enum(['deterministic']).default('deterministic'),
  INTERNAL_E2E_ENABLED: booleanEnvSchema.default(false),
  INTERNAL_E2E_TOKEN: z.string().optional(),
  E2E_API_ORIGIN: z.string().url().default('http://127.0.0.1:4000'),
  E2E_WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173')
}).superRefine((env, context) => {
  if (env.CODEX_REAL_EXECUTION_ENABLED && env.CODEX_REAL_COMMAND.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CODEX_REAL_COMMAND'],
      message: 'CODEX_REAL_COMMAND is required when CODEX_REAL_EXECUTION_ENABLED=true'
    });
  }

  if (
    env.CODEX_REAL_EXECUTION_ENABLED
    && env.CODEX_DOCKER_NETWORK_MODE === 'bridge'
    && !env.CODEX_REAL_CANARY_ENABLED
    && !env.CODEX_REAL_USER_TASKS_ENABLED
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CODEX_REAL_CANARY_ENABLED'],
      message: 'CODEX_REAL_CANARY_ENABLED=true or CODEX_REAL_USER_TASKS_ENABLED=true is required before real execution may use bridge networking'
    });
  }

  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (env.CODEX_WORKER_MODE === 'deterministic') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CODEX_WORKER_MODE'],
      message: 'CODEX_WORKER_MODE=deterministic is not allowed in production'
    });
  }

  const secretKeys = [
    'GITHUB_TOKEN_ENCRYPTION_KEY',
    'CONNECTOR_TOKEN_ENCRYPTION_KEY',
    'PREVIEW_ACCESS_SECRET'
  ] as const;

  for (const key of secretKeys) {
    if (env[key] === developmentSecrets[key] || env[key].length < 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be a non-default production secret with at least 32 characters`
      });
    }
  }

  if (!env.PUBLIC_WEB_ORIGIN) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PUBLIC_WEB_ORIGIN'],
      message: 'PUBLIC_WEB_ORIGIN is required in production'
    });
  }

  if (!env.PUBLIC_API_ORIGIN) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PUBLIC_API_ORIGIN'],
      message: 'PUBLIC_API_ORIGIN is required in production'
    });
  }

  if (parseAllowedCorsOrigins(env.ALLOWED_CORS_ORIGINS).length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ALLOWED_CORS_ORIGINS'],
      message: 'ALLOWED_CORS_ORIGINS must include at least one origin in production'
    });
  }

  if (env.CODEX_REAL_EXECUTION_ENABLED) {
    if (!env.CODEX_REAL_CANARY_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEX_REAL_CANARY_ENABLED'],
        message: 'CODEX_REAL_CANARY_ENABLED=true is required for production real execution'
      });
    }
    if (env.CODEX_REAL_USER_TASKS_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEX_REAL_USER_TASKS_ENABLED'],
        message: 'CODEX_REAL_USER_TASKS_ENABLED must stay false in production'
      });
    }

    if (env.CODEX_SECRET_MOUNT_PATH.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEX_SECRET_MOUNT_PATH'],
        message: 'CODEX_SECRET_MOUNT_PATH is required for production real execution'
      });
    }

    if (env.CODEX_REAL_TASK_LIMIT_PER_RUN !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEX_REAL_TASK_LIMIT_PER_RUN'],
        message: 'CODEX_REAL_TASK_LIMIT_PER_RUN must remain 1 for production real execution'
      });
    }

    if (env.CODEX_REAL_DAILY_BUDGET_TASKS > 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEX_REAL_DAILY_BUDGET_TASKS'],
        message: 'CODEX_REAL_DAILY_BUDGET_TASKS must be 3 or less for production real execution'
      });
    }

    if (env.CODEX_REAL_MAX_RUNTIME_MS > 600000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CODEX_REAL_MAX_RUNTIME_MS'],
        message: 'CODEX_REAL_MAX_RUNTIME_MS must be 600000ms or less for production real execution'
      });
    }
  }
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(source);
}

export function parseAllowedCorsOrigins(value: string | undefined): string[] {
  return [...new Set(
    (value ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  )];
}

export function parseExecutionEnvAllowlist(value: string | undefined): string[] {
  return [...new Set(
    (value ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
  )];
}

export function getModelRuntimeConfig(env: ApiEnv = loadEnv()): ModelRuntimeConfig {
  const apiKeyConfigured = env.MODEL_PROVIDER === 'deepseek'
    ? Boolean(env.DEEPSEEK_API_KEY)
    : Boolean(env.VOLCENGINE_API_KEY_FILE);

  return modelRuntimeConfigSchema.parse({
    provider: env.MODEL_PROVIDER,
    apiKeyConfigured,
    baseUrl: env.MODEL_PROVIDER === 'deepseek' ? env.DEEPSEEK_BASE_URL : env.VOLCENGINE_BASE_URL,
    model: env.MODEL_PROVIDER === 'deepseek' ? env.DEEPSEEK_MODEL : env.VOLCENGINE_MODEL,
    fallbackModel: env.MODEL_PROVIDER === 'deepseek' ? env.DEEPSEEK_FALLBACK_MODEL : undefined,
    budgetCny: env.MODEL_BUDGET_CNY
  });
}
