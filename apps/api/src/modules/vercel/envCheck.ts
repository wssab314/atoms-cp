import {
  vercelEnvCheckResultSchema,
  type VercelEnvCheckInput,
  type VercelEnvCheckResult
} from '@atoms-cp/shared';
import type { ApiEnv } from '../../config/env.js';

const requiredProductionKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;
const target = 'production' as const;

interface CheckVercelEnvOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface VercelEnvMetadata {
  key?: unknown;
  target?: unknown;
}

export async function checkVercelProjectEnv(
  projectId: string,
  input: VercelEnvCheckInput,
  env: ApiEnv,
  options: CheckVercelEnvOptions = {}
): Promise<VercelEnvCheckResult> {
  const now = options.now ?? (() => new Date());

  if (!env.VERCEL_TOKEN?.trim()) {
    return toResult({
      projectId,
      vercelProjectIdOrName: input.vercelProjectIdOrName,
      status: 'blocked',
      missingKeys: [...requiredProductionKeys],
      detail: 'Vercel token is not configured on the backend.',
      checkedAt: now().toISOString()
    });
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    return toResult({
      projectId,
      vercelProjectIdOrName: input.vercelProjectIdOrName,
      status: 'failed',
      missingKeys: [...requiredProductionKeys],
      detail: 'Runtime fetch is not available for Vercel environment checks.',
      checkedAt: now().toISOString()
    });
  }

  const url = new URL(`/v10/projects/${encodeURIComponent(input.vercelProjectIdOrName)}/env`, env.VERCEL_API_BASE_URL);

  if (env.VERCEL_TEAM_ID?.trim()) {
    url.searchParams.set('teamId', env.VERCEL_TEAM_ID.trim());
  }

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${env.VERCEL_TOKEN}`
      }
    });

    if (!response.ok) {
      return toResult({
        projectId,
        vercelProjectIdOrName: input.vercelProjectIdOrName,
        status: 'failed',
        missingKeys: [...requiredProductionKeys],
        detail: `Vercel environment API returned HTTP ${response.status}.`,
        httpStatus: response.status,
        checkedAt: now().toISOString()
      });
    }

    const payload = await readJson(response);
    const envs = extractEnvMetadata(payload);
    const productionKeys = new Set(
      envs
        .filter((item) => typeof item.key === 'string' && hasTarget(item.target, target))
        .map((item) => item.key as string)
    );
    const missingKeys = requiredProductionKeys.filter((key) => !productionKeys.has(key));

    return toResult({
      projectId,
      vercelProjectIdOrName: input.vercelProjectIdOrName,
      status: missingKeys.length === 0 ? 'passed' : 'failed',
      missingKeys,
      detail: missingKeys.length === 0
        ? 'Vercel production env vars are present.'
        : `Missing Vercel production env vars: ${missingKeys.join(', ')}.`,
      httpStatus: response.status,
      checkedAt: now().toISOString()
    });
  } catch {
    return toResult({
      projectId,
      vercelProjectIdOrName: input.vercelProjectIdOrName,
      status: 'failed',
      missingKeys: [...requiredProductionKeys],
      detail: 'Vercel environment API request failed.',
      checkedAt: now().toISOString()
    });
  }
}

function toResult(input: {
  projectId: string;
  vercelProjectIdOrName: string;
  status: 'passed' | 'failed' | 'blocked';
  missingKeys: string[];
  detail: string;
  httpStatus?: number;
  checkedAt: string;
}): VercelEnvCheckResult {
  return vercelEnvCheckResultSchema.parse({
    ...input,
    target,
    requiredKeys: [...requiredProductionKeys]
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function extractEnvMetadata(payload: unknown): VercelEnvMetadata[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is VercelEnvMetadata => typeof item === 'object' && item !== null);
  }

  if (typeof payload === 'object' && payload !== null && 'envs' in payload) {
    const envs = (payload as { envs?: unknown }).envs;
    return Array.isArray(envs)
      ? envs.filter((item): item is VercelEnvMetadata => typeof item === 'object' && item !== null)
      : [];
  }

  return [];
}

function hasTarget(value: unknown, expected: typeof target): boolean {
  if (Array.isArray(value)) {
    return value.includes(expected);
  }

  return value === expected;
}
