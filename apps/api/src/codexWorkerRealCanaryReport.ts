import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { reportRealCanary } from './modules/codex/realCanaryRunner.js';
import { createInMemoryStore } from './modules/data/inMemoryStore.js';
import { createMigratedPostgresPoolStore } from './modules/data/postgresStore.js';

const env = loadEnv();
const store = env.DATA_STORE === 'postgres'
  ? await createMigratedPostgresPoolStore(env.DATABASE_URL, env.DATABASE_SCHEMA)
  : createInMemoryStore();

try {
  const report = await reportRealCanary(store);
  console.log(JSON.stringify({
    service: 'atoms-cp-codex-worker-real-canary-report',
    ...report,
    timestamp: new Date().toISOString()
  }, null, 2));
} finally {
  await store.close?.();
}
