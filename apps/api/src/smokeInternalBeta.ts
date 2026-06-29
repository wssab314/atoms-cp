import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createInMemoryStore } from './modules/data/inMemoryStore.js';
import { createMigratedPostgresPoolStore } from './modules/data/postgresStore.js';
import { runInternalBetaSmoke } from './modules/smoke/internalBetaSmoke.js';

const env = loadEnv();
const store = env.DATA_STORE === 'postgres'
  ? await createMigratedPostgresPoolStore(env.DATABASE_URL, env.DATABASE_SCHEMA)
  : createInMemoryStore();

try {
  const report = await runInternalBetaSmoke({
    store,
    workspaceRoot: env.CODEX_WORKSPACE_ROOT,
    previewRoot: env.PREVIEW_ROOT_DIR,
    previewBaseUrl: env.PREVIEW_BASE_URL,
    previewAccessSecret: env.PREVIEW_ACCESS_SECRET
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.status !== 'passed') {
    process.exitCode = 1;
  }
} finally {
  await store.close?.();
}
