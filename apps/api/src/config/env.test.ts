import { describe, expect, it } from 'vitest';
import { getModelRuntimeConfig, loadEnv, parseAllowedCorsOrigins, parseExecutionEnvAllowlist } from './env.js';

describe('API environment config', () => {
  it('defaults to local auth, Volcengine Doubao, and Docker worker mode', () => {
    const env = loadEnv({});
    const model = getModelRuntimeConfig(env);

    expect(model.provider).toBe('volcengine');
    expect(model.model).toBe('doubao-seed-2-1-turbo-260628');
    expect(model.apiKeyConfigured).toBe(false);
    expect(env.DATABASE_SCHEMA).toBe('atoms_cp');
    expect(env.REDIS_KEY_PREFIX).toBe('atoms_cp:');
    expect(env.BUILD_MAX_CONCURRENT).toBe(1);
    expect(env.CODEX_TASK_STALE_MS).toBe(900000);
    expect(env.BUILD_JOB_STALE_MS).toBe(900000);
    expect(env.INTERNAL_BETA_SMOKE_MODE).toBe('deterministic');
    expect(env.INTERNAL_E2E_ENABLED).toBe(false);
    expect(env.AUTH_MODE).toBe('local');
    expect(env.MODEL_REQUEST_TIMEOUT_MS).toBe(60000);
    expect(env.CODEX_WORKER_MODE).toBe('docker');
    expect(env.CODEX_REAL_EXECUTION_ENABLED).toBe(false);
    expect(env.CODEX_DOCKER_LOG_MAX_BYTES).toBe(65536);
    expect(env.CODEX_EXECUTION_IDLE_TIMEOUT_MS).toBe(180000);
    expect(env.CODEX_EXECUTION_HEARTBEAT_MS).toBe(30000);
    expect(env.CODEX_REAL_COMMAND).toBe('');
    expect(env.CODEX_DOCKER_NETWORK_MODE).toBe('none');
    expect(env.CODEX_OUTPUT_MAX_FILES).toBe(200);
    expect(env.CODEX_OUTPUT_MAX_BYTES).toBe(5242880);
    expect(env.CODEX_EXECUTION_ENV_ALLOWLIST).toBe('');
    expect(env.CODEX_REAL_PREFLIGHT_ONLY).toBe(true);
    expect(env.CODEX_REAL_CANARY_ENABLED).toBe(false);
    expect(env.CODEX_REAL_USER_TASKS_ENABLED).toBe(false);
    expect(env.CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST).toBe('');
    expect(env.LOCAL_AUTH_REGISTRATION_ENABLED).toBe(true);
    expect(env.CODEX_SECRET_MOUNT_PATH).toBe('');
    expect(env.CODEX_REAL_TASK_LIMIT_PER_RUN).toBe(1);
    expect(env.CODEX_REAL_DAILY_BUDGET_TASKS).toBe(3);
    expect(env.CODEX_REAL_MAX_RUNTIME_MS).toBe(600000);
    expect(env.CODEX_REAL_AUTO_DISABLE_ON_FAILURE).toBe(true);
  });

  it('detects when DeepSeek is configured without exposing the key', () => {
    const env = loadEnv({
      MODEL_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-secret-value',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_FALLBACK_MODEL: 'deepseek-v4-flash',
      MODEL_BUDGET_CNY: '25'
    });
    const model = getModelRuntimeConfig(env);

    expect(model).toMatchObject({
      provider: 'deepseek',
      apiKeyConfigured: true,
      model: 'deepseek-v4-pro'
    });
    expect(JSON.stringify(model)).not.toContain('test-secret-value');
  });

  it('detects when Volcengine is configured through a key file without exposing the key path contents', () => {
    const env = loadEnv({
      MODEL_PROVIDER: 'volcengine',
      VOLCENGINE_API_KEY_FILE: '/tmp/atoms-cp-volcengine-api-key',
      VOLCENGINE_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
      VOLCENGINE_MODEL: 'doubao-seed-2-1-turbo-260628'
    });
    const model = getModelRuntimeConfig(env);

    expect(model).toMatchObject({
      provider: 'volcengine',
      apiKeyConfigured: true,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-1-turbo-260628'
    });
    expect(JSON.stringify(model)).not.toContain('ark-');
  });

  it('rejects development encryption defaults in production', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'development-github-token-key',
      CONNECTOR_TOKEN_ENCRYPTION_KEY: 'development-connector-token-key',
      PREVIEW_ACCESS_SECRET: 'development-preview-access-secret'
    })).toThrow();

    expect(loadEnv({
      NODE_ENV: 'production',
      PUBLIC_WEB_ORIGIN: 'https://atoms.example.com',
      PUBLIC_API_ORIGIN: 'https://atoms-api.example.com',
      ALLOWED_CORS_ORIGINS: 'https://atoms.example.com',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'prod-github-token-key-32-characters',
      CONNECTOR_TOKEN_ENCRYPTION_KEY: 'prod-connector-token-key-32-chars',
      PREVIEW_ACCESS_SECRET: 'prod-preview-access-secret-32-chars'
    }).NODE_ENV).toBe('production');
  });

  it('requires production origins and validates database schema names', () => {
    expect(() => loadEnv({
      NODE_ENV: 'production',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'prod-github-token-key-32-characters',
      CONNECTOR_TOKEN_ENCRYPTION_KEY: 'prod-connector-token-key-32-chars',
      PREVIEW_ACCESS_SECRET: 'prod-preview-access-secret-32-chars'
    })).toThrow(/PUBLIC_WEB_ORIGIN/);

    expect(() => loadEnv({
      DATABASE_SCHEMA: 'public;drop schema public'
    })).toThrow();
  });

  it('parses comma-separated CORS origins into a trimmed allowlist', () => {
    expect(parseAllowedCorsOrigins(' https://atoms.example.com,https://admin.example.com ')).toEqual([
      'https://atoms.example.com',
      'https://admin.example.com'
    ]);
    expect(parseAllowedCorsOrigins(undefined)).toEqual([]);
  });

  it('keeps real Docker Codex execution behind an explicit command gate', () => {
    expect(() => loadEnv({
      CODEX_REAL_EXECUTION_ENABLED: 'true'
    })).toThrow(/CODEX_REAL_COMMAND/);

    const env = loadEnv({
      CODEX_REAL_EXECUTION_ENABLED: 'true',
      CODEX_REAL_COMMAND: 'node /runner/real-codex.js',
      CODEX_DOCKER_NETWORK_MODE: 'bridge',
      CODEX_OUTPUT_MAX_FILES: '50',
      CODEX_OUTPUT_MAX_BYTES: '1048576',
      CODEX_EXECUTION_ENV_ALLOWLIST: 'SAFE_FLAG,SAFE_OTHER',
      CODEX_REAL_PREFLIGHT_ONLY: 'false',
      CODEX_REAL_USER_TASKS_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/codex_api_key'
    });

    expect(env.CODEX_REAL_EXECUTION_ENABLED).toBe(true);
    expect(env.CODEX_REAL_COMMAND).toBe('node /runner/real-codex.js');
    expect(env.CODEX_DOCKER_NETWORK_MODE).toBe('bridge');
    expect(env.CODEX_OUTPUT_MAX_FILES).toBe(50);
    expect(env.CODEX_OUTPUT_MAX_BYTES).toBe(1048576);
    expect(env.CODEX_REAL_PREFLIGHT_ONLY).toBe(false);
    expect(env.CODEX_REAL_USER_TASKS_ENABLED).toBe(true);
    expect(env.CODEX_SECRET_MOUNT_PATH).toBe('/run/secrets/codex_api_key');
    expect(parseExecutionEnvAllowlist(env.CODEX_EXECUTION_ENV_ALLOWLIST)).toEqual(['SAFE_FLAG', 'SAFE_OTHER']);
  });

  it('allows local real user tasks to use the container worker mode with an explicit secret file', () => {
    const env = loadEnv({
      CODEX_WORKER_MODE: 'container',
      CODEX_REAL_EXECUTION_ENABLED: 'true',
      CODEX_REAL_COMMAND: '/app/scripts/codex-doubao21-exec.sh',
      CODEX_REAL_PREFLIGHT_ONLY: 'false',
      CODEX_REAL_USER_TASKS_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/volcengine_api_key'
    });

    expect(env.CODEX_WORKER_MODE).toBe('container');
    expect(env.CODEX_REAL_EXECUTION_ENABLED).toBe(true);
    expect(env.CODEX_REAL_PREFLIGHT_ONLY).toBe(false);
    expect(env.CODEX_REAL_USER_TASKS_ENABLED).toBe(true);
    expect(env.CODEX_SECRET_MOUNT_PATH).toBe('/run/secrets/volcengine_api_key');
  });

  it('fails production real execution unless canary, secret, and resource gates are explicit', () => {
    const productionBase = {
      NODE_ENV: 'production',
      PUBLIC_WEB_ORIGIN: 'https://atoms.example.com',
      PUBLIC_API_ORIGIN: 'https://atoms-api.example.com',
      ALLOWED_CORS_ORIGINS: 'https://atoms.example.com',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'prod-github-token-key-32-characters',
      CONNECTOR_TOKEN_ENCRYPTION_KEY: 'prod-connector-token-key-32-chars',
      PREVIEW_ACCESS_SECRET: 'prod-preview-access-secret-32-chars',
      CODEX_REAL_EXECUTION_ENABLED: 'true',
      CODEX_REAL_COMMAND: 'node /runner/real-codex.js',
      CODEX_REAL_PREFLIGHT_ONLY: 'false',
      CODEX_DOCKER_NETWORK_MODE: 'bridge'
    };

    expect(() => loadEnv(productionBase)).toThrow(/CODEX_REAL_CANARY_ENABLED/);

    expect(() => loadEnv({
      ...productionBase,
      CODEX_REAL_CANARY_ENABLED: 'true',
      CODEX_REAL_USER_TASKS_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/codex_api_key'
    })).toThrow(/CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST/);

    expect(() => loadEnv({
      ...productionBase,
      CODEX_REAL_CANARY_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/codex_api_key',
      CODEX_REAL_TASK_LIMIT_PER_RUN: '2'
    })).toThrow(/CODEX_REAL_TASK_LIMIT_PER_RUN/);

    const env = loadEnv({
      ...productionBase,
      CODEX_REAL_CANARY_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/codex_api_key',
      CODEX_REAL_TASK_LIMIT_PER_RUN: '1',
      CODEX_REAL_DAILY_BUDGET_TASKS: '2',
      CODEX_REAL_MAX_RUNTIME_MS: '600000'
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.CODEX_REAL_CANARY_ENABLED).toBe(true);
    expect(env.CODEX_SECRET_MOUNT_PATH).toBe('/run/secrets/codex_api_key');
  });

  it('allows production real user tasks only with container mode and an explicit email allowlist', () => {
    const productionBase = {
      NODE_ENV: 'production',
      PUBLIC_WEB_ORIGIN: 'https://atslab.top',
      PUBLIC_API_ORIGIN: 'https://atslab.top',
      ALLOWED_CORS_ORIGINS: 'https://atslab.top',
      GITHUB_TOKEN_ENCRYPTION_KEY: 'prod-github-token-key-32-characters',
      CONNECTOR_TOKEN_ENCRYPTION_KEY: 'prod-connector-token-key-32-chars',
      PREVIEW_ACCESS_SECRET: 'prod-preview-access-secret-32-chars',
      CODEX_WORKER_MODE: 'container',
      CODEX_REAL_EXECUTION_ENABLED: 'true',
      CODEX_REAL_COMMAND: '/app/scripts/codex-doubao21-exec.sh',
      CODEX_REAL_PREFLIGHT_ONLY: 'false',
      CODEX_REAL_USER_TASKS_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/volcengine_api_key'
    };

    expect(() => loadEnv(productionBase)).toThrow(/CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST/);

    expect(() => loadEnv({
      ...productionBase,
      CODEX_WORKER_MODE: 'docker',
      CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST: 'test@atslab.top'
    })).toThrow(/CODEX_WORKER_MODE/);

    const env = loadEnv({
      ...productionBase,
      CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST: ' Test@AtsLab.Top , test@atslab.top '
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.CODEX_WORKER_MODE).toBe('container');
    expect(env.CODEX_REAL_USER_TASKS_ENABLED).toBe(true);
    expect(env.CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST).toContain('Test@AtsLab.Top');
  });
});
