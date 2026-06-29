import type { FastifyInstance } from 'fastify';
import {
  supabaseConfigInputSchema,
  supabaseFrontendEnvConfirmationInputSchema,
  supabaseProjectConfigSchema,
  type SupabaseConfigRecord,
  type SupabaseProjectConfig
} from '@atoms-cp/shared';
import { loadEnv } from '../config/env.js';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';
import { encryptToken } from '../modules/github/tokenVault.js';
import { testSupabaseConnection } from '../modules/supabase/connectionTest.js';
import { generateSupabaseSchemaSql } from '../modules/supabase/schemaSql.js';

interface ProjectParams {
  projectId: string;
}

export async function registerSupabaseRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.get('/api/projects/:projectId/supabase/config', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const config = await store.getProjectSupabaseConfig(projectId);
    return toPublicConfig(projectId, config);
  });

  app.put('/api/projects/:projectId/supabase/config', async (request, reply) => {
    const parsed = supabaseConfigInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid Supabase config input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const env = loadEnv();
    const serviceRoleKeyEncrypted = parsed.data.serviceRoleKey
      ? encryptToken(parsed.data.serviceRoleKey, env.CONNECTOR_TOKEN_ENCRYPTION_KEY)
      : undefined;
    const config = await store.upsertProjectSupabaseConfig(projectId, {
      supabaseUrl: parsed.data.supabaseUrl,
      anonKey: parsed.data.anonKey,
      serviceRoleKeyEncrypted
    });

    return toPublicConfig(projectId, config);
  });

  app.post('/api/projects/:projectId/supabase/test', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const config = await store.getProjectSupabaseConfig(projectId);
    const result = await testSupabaseConnection(projectId, config);

    if (config) {
      await store.recordProjectSupabaseConnectionTest(projectId, result);
    }

    return result;
  });

  app.put('/api/projects/:projectId/supabase/frontend-env', async (request, reply) => {
    const parsed = supabaseFrontendEnvConfirmationInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid Supabase frontend env confirmation input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const config = await store.confirmProjectSupabaseFrontendEnv(projectId);

    if (!config) {
      return reply.code(409).send({
        error: 'Configure Supabase before confirming deploy environment variables'
      });
    }

    return toPublicConfig(projectId, config);
  });

  app.get('/api/projects/:projectId/supabase/schema-sql', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const appSpec = await store.getLatestAppSpec(projectId);

    if (!appSpec) {
      return reply.code(404).send({
        error: 'AppSpec not found'
      });
    }

    return generateSupabaseSchemaSql(projectId, appSpec.spec);
  });
}

function toPublicConfig(projectId: string, config: SupabaseConfigRecord | undefined): SupabaseProjectConfig {
  if (!config) {
    return supabaseProjectConfigSchema.parse({
      projectId,
      configured: false,
      anonKeyConfigured: false,
      serviceRoleKeyConfigured: false,
      envReady: false
    });
  }

  return supabaseProjectConfigSchema.parse({
    projectId,
    configured: true,
    supabaseUrl: config.supabaseUrl,
    anonKeyConfigured: Boolean(config.anonKey),
    anonKeyMasked: maskPublicKey(config.anonKey),
    serviceRoleKeyConfigured: Boolean(config.serviceRoleKeyEncrypted),
    envReady: Boolean(config.supabaseUrl && config.anonKey),
    frontendEnvConfirmedAt: config.frontendEnvConfirmedAt,
    lastConnectionStatus: config.lastConnectionStatus,
    lastConnectionDetail: config.lastConnectionDetail,
    lastConnectionHttpStatus: config.lastConnectionHttpStatus,
    lastConnectionCheckedAt: config.lastConnectionCheckedAt,
    updatedAt: config.updatedAt
  });
}

function maskPublicKey(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 3)}...`;
  }

  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}
