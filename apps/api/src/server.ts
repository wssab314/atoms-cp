import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyCorsOptions } from '@fastify/cors';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCodexTaskRoutes } from './routes/codexTasks.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerInternalE2eRoutes } from './routes/internalE2e.js';
import { registerGitHubConnectorRoutes } from './routes/githubConnector.js';
import { registerGenerationRoutes } from './routes/generation.js';
import { registerPreviewRoutes } from './routes/preview.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSupabaseRoutes } from './routes/supabase.js';
import { registerVercelRoutes } from './routes/vercel.js';
import { loadEnv, parseAllowedCorsOrigins, type ApiEnv } from './config/env.js';
import type { AppStore } from './modules/data/appStore.js';
import { createInMemoryStore } from './modules/data/inMemoryStore.js';
import { createMigratedPostgresPoolStore } from './modules/data/postgresStore.js';
import type { GitHubApiClient } from './modules/github/githubClient.js';
import { registerLocalAuthHook } from './modules/auth/localAuth.js';

interface CreateServerOptions {
  logger?: boolean;
  store?: AppStore;
  githubClient?: GitHubApiClient;
}

export async function createServer(options: CreateServerOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test'
  });
  const store = options.store ?? await createDefaultStore();
  const env = loadEnv();

  await app.register(cors, createCorsOptions(env));
  registerLocalAuthHook(app, store, env);

  app.addHook('onClose', async () => {
    await store.close?.();
  });

  await registerHealthRoutes(app, store);
  await registerInternalE2eRoutes(app, store);
  await registerAuthRoutes(app, store);
  await registerPreviewRoutes(app);
  await registerGitHubConnectorRoutes(app, store, {
    githubClient: options.githubClient
  });
  await registerSupabaseRoutes(app, store);
  await registerVercelRoutes(app, store);
  await registerProjectRoutes(app, store, {
    githubClient: options.githubClient
  });
  await registerGenerationRoutes(app, store);
  await registerAgentRoutes(app, store);
  await registerCodexTaskRoutes(app, store);
  await registerAdminRoutes(app, store);

  return app;
}

async function createDefaultStore(): Promise<AppStore> {
  const env = loadEnv();

  if (env.DATA_STORE === 'postgres') {
    return await createMigratedPostgresPoolStore(env.DATABASE_URL, env.DATABASE_SCHEMA);
  }

  return createInMemoryStore();
}

export function createCorsOptions(env: ApiEnv): FastifyCorsOptions {
  if (env.NODE_ENV !== 'production') {
    return {
      origin: true,
      credentials: true
    };
  }

  const allowedOrigins = new Set(parseAllowedCorsOrigins(env.ALLOWED_CORS_ORIGINS));

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    }
  };
}
