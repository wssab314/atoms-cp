import type { FastifyInstance } from 'fastify';
import { getModelRuntimeConfig, loadEnv } from '../config/env.js';
import type { AppStore } from '../modules/data/appStore.js';
import { checkRedisHealth } from '../modules/runtime/redisHealth.js';
import { checkWritableStorage } from '../modules/runtime/storageHealth.js';

export async function registerHealthRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.get('/api/health', async () => {
    const env = loadEnv();
    const model = getModelRuntimeConfig(env);
    const health = await store.getRuntimeHealth();
    const redis = await checkRedisHealth(env.REDIS_URL);
    const [previewStorage, workspaceStorage, buildWorkspaceStorage] = await Promise.all([
      checkWritableStorage(env.PREVIEW_ROOT_DIR),
      checkWritableStorage(env.CODEX_WORKSPACE_ROOT),
      checkWritableStorage(env.BUILD_WORKSPACE_ROOT)
    ]);

    return {
      ok: true,
      service: 'atoms-cp-api',
      model,
      checks: {
        database: health.database,
        redis,
        storage: {
          preview: previewStorage,
          workspace: workspaceStorage,
          buildWorkspace: buildWorkspaceStorage
        }
      }
    };
  });
}
