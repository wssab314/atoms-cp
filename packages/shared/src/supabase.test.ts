import { describe, expect, it } from 'vitest';
import {
  supabaseConnectionTestResultSchema,
  supabaseConfigInputSchema,
  supabaseConfigRecordSchema,
  supabaseFrontendEnvConfirmationInputSchema,
  supabaseProjectConfigSchema,
  supabaseSchemaSqlResponseSchema
} from './supabase.js';

describe('Supabase contracts', () => {
  it('validates public project config without service role plaintext', () => {
    const config = supabaseProjectConfigSchema.parse({
      projectId: 'project-1',
      configured: true,
      supabaseUrl: 'https://demo.supabase.co',
      anonKeyConfigured: true,
      anonKeyMasked: 'eyJhb...abcd',
      serviceRoleKeyConfigured: true,
      envReady: true,
      frontendEnvConfirmedAt: '2026-06-27T00:05:00.000Z',
      lastConnectionStatus: 'passed',
      lastConnectionDetail: 'Supabase REST endpoint accepted the anon key.',
      lastConnectionHttpStatus: 200,
      lastConnectionCheckedAt: '2026-06-27T00:06:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z'
    });

    expect(config).toMatchObject({
      configured: true,
      serviceRoleKeyConfigured: true,
      lastConnectionStatus: 'passed'
    });
    expect(JSON.stringify(config)).not.toContain('service-role-secret');

    expect(supabaseConfigRecordSchema.parse({
      projectId: 'project-1',
      supabaseUrl: 'https://demo.supabase.co',
      anonKey: 'public-anon-key',
      serviceRoleKeyEncrypted: 'encrypted-service-role',
      frontendEnvConfirmedAt: '2026-06-27T00:05:00.000Z',
      lastConnectionStatus: 'passed',
      lastConnectionDetail: 'Supabase REST endpoint accepted the anon key.',
      lastConnectionHttpStatus: 200,
      lastConnectionCheckedAt: '2026-06-27T00:06:00.000Z',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:06:00.000Z'
    })).toMatchObject({
      lastConnectionStatus: 'passed',
      lastConnectionHttpStatus: 200
    });
  });

  it('validates Supabase config input boundaries', () => {
    expect(supabaseConfigInputSchema.parse({
      supabaseUrl: 'https://demo.supabase.co',
      anonKey: 'public-anon-key',
      serviceRoleKey: 'service-role-secret'
    })).toMatchObject({
      supabaseUrl: 'https://demo.supabase.co'
    });

    expect(() => supabaseConfigInputSchema.parse({
      supabaseUrl: 'javascript:alert(1)',
      anonKey: 'public-anon-key'
    })).toThrow();
  });

  it('validates generated schema SQL responses', () => {
    const response = supabaseSchemaSqlResponseSchema.parse({
      projectId: 'project-1',
      tables: ['bookings'],
      sql: 'create table if not exists public.bookings (id uuid primary key);',
      warnings: []
    });

    expect(response.tables).toEqual(['bookings']);
  });

  it('validates connection test and frontend env confirmation contracts', () => {
    expect(supabaseConnectionTestResultSchema.parse({
      projectId: 'project-1',
      status: 'passed',
      detail: 'Supabase REST endpoint accepted the anon key.',
      httpStatus: 200,
      checkedAt: '2026-06-27T00:06:00.000Z'
    })).toMatchObject({
      status: 'passed',
      httpStatus: 200
    });

    expect(supabaseFrontendEnvConfirmationInputSchema.parse({
      confirmed: true
    })).toEqual({
      confirmed: true
    });

    expect(() => supabaseFrontendEnvConfirmationInputSchema.parse({
      confirmed: false
    })).toThrow();
  });
});
