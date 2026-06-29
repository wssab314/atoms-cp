import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.js';
import {
  isRealUserTaskExecutionAllowed,
  parseRealUserTaskEmailAllowlist
} from './realUserTaskGate.js';

describe('real user task gate', () => {
  it('normalizes email allowlists', () => {
    expect(parseRealUserTaskEmailAllowlist(' Test@AtsLab.Top, test@atslab.top, admin@atslab.top ')).toEqual([
      'test@atslab.top',
      'admin@atslab.top'
    ]);
  });

  it('allows real user tasks only for configured emails', () => {
    const env = loadEnv({
      CODEX_WORKER_MODE: 'container',
      CODEX_REAL_EXECUTION_ENABLED: 'true',
      CODEX_REAL_COMMAND: '/app/scripts/codex-doubao21-exec.sh',
      CODEX_REAL_PREFLIGHT_ONLY: 'false',
      CODEX_REAL_USER_TASKS_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/volcengine_api_key',
      CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST: 'test@atslab.top'
    });

    expect(isRealUserTaskExecutionAllowed(env, 'test@atslab.top')).toBe(true);
    expect(isRealUserTaskExecutionAllowed(env, 'Test@AtsLab.Top')).toBe(true);
    expect(isRealUserTaskExecutionAllowed(env, 'other@atslab.top')).toBe(false);
  });

  it('rejects real user tasks when worker gates are incomplete', () => {
    const env = loadEnv({
      CODEX_WORKER_MODE: 'container',
      CODEX_REAL_EXECUTION_ENABLED: 'true',
      CODEX_REAL_COMMAND: '/app/scripts/codex-doubao21-exec.sh',
      CODEX_REAL_PREFLIGHT_ONLY: 'true',
      CODEX_REAL_USER_TASKS_ENABLED: 'true',
      CODEX_SECRET_MOUNT_PATH: '/run/secrets/volcengine_api_key',
      CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST: 'test@atslab.top'
    });

    expect(isRealUserTaskExecutionAllowed(env, 'test@atslab.top')).toBe(false);
  });
});
