import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ApiEnv } from '../../config/env.js';
import { resolveRequestUser } from './requestUser.js';

function requestWithHeaders(headers: Record<string, string>): FastifyRequest {
  return {
    headers
  } as FastifyRequest;
}

function testEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    NODE_ENV: 'development',
    PORT: 4000,
    DATA_STORE: 'memory',
    DATABASE_URL: 'postgres://atoms:atoms@localhost:5432/atoms_cp',
    DATABASE_SCHEMA: 'atoms_cp',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_KEY_PREFIX: 'atoms_cp:',
    AUTH_MODE: 'local',
    AUTH_SESSION_SECRET: 'development-preview-access-secret',
    AUTH_SESSION_TTL_DAYS: 7,
    MODEL_PROVIDER: 'volcengine',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPSEEK_MODEL: 'deepseek-v4-pro',
    DEEPSEEK_FALLBACK_MODEL: 'deepseek-v4-flash',
    VOLCENGINE_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
    VOLCENGINE_MODEL: 'doubao-seed-2-1-turbo-260628',
    MODEL_REQUEST_TIMEOUT_MS: 60000,
    MODEL_BUDGET_CNY: 25,
    GITHUB_TOKEN_ENCRYPTION_KEY: 'development-github-token-key',
    CONNECTOR_TOKEN_ENCRYPTION_KEY: 'development-connector-token-key',
    VERCEL_API_BASE_URL: 'https://api.vercel.com',
    PREVIEW_BASE_URL: 'http://localhost:4000/preview',
    PREVIEW_ROOT_DIR: '/tmp/atoms-cp-previews',
    PREVIEW_ACCESS_SECRET: 'development-preview-access-secret',
    WORKSPACE_RETENTION_DAYS: 7,
    PREVIEW_RETENTION_DAYS: 14,
    BUILD_WORKSPACE_ROOT: '/tmp/atoms-cp-build-workspaces',
    BUILD_MAX_CONCURRENT: 1,
    CODEX_WORKER_INTERVAL_MS: 3000,
    CODEX_WORKER_MODE: 'deterministic',
    CODEX_WORKSPACE_ROOT: '/tmp/atoms-cp-workspaces',
    CODEX_DOCKER_IMAGE: 'node:22-alpine',
    CODEX_DOCKER_TIMEOUT_MS: 120000,
    CODEX_DOCKER_LOG_MAX_BYTES: 65536,
    CODEX_EXECUTION_IDLE_TIMEOUT_MS: 180000,
    CODEX_EXECUTION_HEARTBEAT_MS: 30000,
    CODEX_REAL_EXECUTION_ENABLED: false,
    CODEX_REAL_COMMAND: '',
    CODEX_DOCKER_NETWORK_MODE: 'none',
    CODEX_OUTPUT_MAX_FILES: 200,
    CODEX_OUTPUT_MAX_BYTES: 5242880,
    CODEX_EXECUTION_ENV_ALLOWLIST: '',
    CODEX_REAL_PREFLIGHT_ONLY: true,
    CODEX_REAL_CANARY_ENABLED: false,
    CODEX_REAL_USER_TASKS_ENABLED: false,
    CODEX_SECRET_MOUNT_PATH: '',
    CODEX_REAL_TASK_LIMIT_PER_RUN: 1,
    CODEX_REAL_DAILY_BUDGET_TASKS: 3,
    CODEX_REAL_MAX_RUNTIME_MS: 600000,
    CODEX_REAL_AUTO_DISABLE_ON_FAILURE: true,
    CODEX_TASK_STALE_MS: 900000,
    BUILD_JOB_STALE_MS: 900000,
    INTERNAL_BETA_SMOKE_MODE: 'deterministic',
    INTERNAL_E2E_ENABLED: false,
    E2E_API_ORIGIN: 'http://127.0.0.1:4000',
    E2E_WEB_ORIGIN: 'http://127.0.0.1:5173',
    ...overrides
  };
}

describe('resolveRequestUser', () => {
  it('allows test role headers in development resolver tests', () => {
    const user = resolveRequestUser(
      requestWithHeaders({
        'x-user-email': 'creator@example.local',
        'x-user-role': 'admin'
      }),
      testEnv()
    );

    expect(user.role).toBe('admin');
  });

  it('prefers the authenticated session user id header when present', () => {
    const user = resolveRequestUser(
      requestWithHeaders({
        'x-user-id': 'f4e9cf18-0d94-4f74-a064-8f46d065f47a',
        'x-user-email': 'creator@example.local',
        'x-user-role': 'creator'
      }),
      testEnv()
    );

    expect(user).toMatchObject({
      id: 'f4e9cf18-0d94-4f74-a064-8f46d065f47a',
      email: 'creator@example.local',
      role: 'creator'
    });
  });

  it('ignores unsafe user id headers', () => {
    const user = resolveRequestUser(
      requestWithHeaders({
        'x-user-id': '../../etc/passwd',
        'x-user-email': 'creator@example.local'
      }),
      testEnv()
    );

    expect(user.id).toBe('user-creator');
  });

  it('ignores forged admin role headers in production', () => {
    const user = resolveRequestUser(
      requestWithHeaders({
        'x-user-email': 'creator@example.local',
        'x-user-role': 'admin'
      }),
      testEnv({
        NODE_ENV: 'production'
      })
    );

    expect(user.role).toBe('creator');
  });

  it('does not trust role headers for non-bootstrap emails in production local auth mode', () => {
    const user = resolveRequestUser(
      requestWithHeaders({
        'x-user-email': 'ops@example.com',
        'x-user-role': 'admin'
      }),
      testEnv({
        NODE_ENV: 'production',
        AUTH_MODE: 'local'
      })
    );

    expect(user.role).toBe('creator');
  });

  it('allows bootstrap admin emails in production without trusting role headers', () => {
    const user = resolveRequestUser(
      requestWithHeaders({
        'x-user-email': 'admin@example.local',
        'x-user-role': 'creator'
      }),
      testEnv({
        NODE_ENV: 'production'
      })
    );

    expect(user.role).toBe('admin');
  });
});
