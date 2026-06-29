import 'dotenv/config';
import { Pool } from 'pg';
import { loadEnv } from './config/env.js';
import { cleanupGeneratedStorage, listActivePreviewPaths } from './modules/storage/storageCleanup.js';

const env = loadEnv();
const pool = env.DATA_STORE === 'postgres'
  ? new Pool({
      connectionString: env.DATABASE_URL,
      ...(env.DATABASE_SCHEMA === 'public'
        ? {}
        : {
            options: `-c search_path=${env.DATABASE_SCHEMA},public`
          })
    })
  : undefined;

try {
  const activePreviewPaths = pool ? await listActivePreviewPaths(pool) : [];
  const result = await cleanupGeneratedStorage({
    previewRoot: env.PREVIEW_ROOT_DIR,
    workspaceRoot: env.CODEX_WORKSPACE_ROOT,
    buildWorkspaceRoot: env.BUILD_WORKSPACE_ROOT,
    previewRetentionDays: env.PREVIEW_RETENTION_DAYS,
    workspaceRetentionDays: env.WORKSPACE_RETENTION_DAYS,
    activePreviewPaths
  });

  console.log(JSON.stringify({
    service: 'atoms-cp-storage-cleanup',
    status: 'completed',
    deletedCount: result.deletedPaths.length,
    deletedPaths: result.deletedPaths
  }));
} finally {
  await pool?.end();
}
