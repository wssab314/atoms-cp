import { describe, expect, it } from 'vitest';
import {
  vercelEnvCheckInputSchema,
  vercelEnvCheckResultSchema
} from './vercel.js';

describe('Vercel contracts', () => {
  it('validates production env check inputs and sanitized results', () => {
    expect(vercelEnvCheckInputSchema.parse({
      vercelProjectIdOrName: 'atoms-demo'
    })).toEqual({
      vercelProjectIdOrName: 'atoms-demo'
    });

    expect(() => vercelEnvCheckInputSchema.parse({
      vercelProjectIdOrName: '../secret'
    })).toThrow();

    const result = vercelEnvCheckResultSchema.parse({
      projectId: 'project-1',
      vercelProjectIdOrName: 'atoms-demo',
      status: 'failed',
      target: 'production',
      requiredKeys: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
      missingKeys: ['VITE_SUPABASE_ANON_KEY'],
      detail: 'Missing Vercel production env vars: VITE_SUPABASE_ANON_KEY.',
      httpStatus: 200,
      checkedAt: '2026-06-27T00:06:00.000Z'
    });

    expect(result).toMatchObject({
      status: 'failed',
      missingKeys: ['VITE_SUPABASE_ANON_KEY']
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});
