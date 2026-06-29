import type { ApiEnv } from '../../config/env.js';
import { parseEmailAllowlist } from '../../config/env.js';

export function parseRealUserTaskEmailAllowlist(value: string | undefined): string[] {
  return parseEmailAllowlist(value);
}

export function isRealUserTaskExecutionAllowed(env: ApiEnv, email: string | undefined): boolean {
  if (
    !['docker', 'container'].includes(env.CODEX_WORKER_MODE)
    || !env.CODEX_REAL_EXECUTION_ENABLED
    || env.CODEX_REAL_PREFLIGHT_ONLY
    || !env.CODEX_REAL_USER_TASKS_ENABLED
  ) {
    return false;
  }

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  return parseRealUserTaskEmailAllowlist(env.CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST).includes(normalizedEmail);
}
