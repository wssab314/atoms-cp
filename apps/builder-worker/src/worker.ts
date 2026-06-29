import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { processNextBuildJob } from './buildQueue.js';
import { recordWorkerHeartbeat } from './heartbeat.js';

const intervalMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? 30000);
const workerId = process.env.WORKER_ID ?? `builder-worker-${randomUUID()}`;
const role = process.env.WORKER_ROLE ?? 'builder-worker';
const databaseUrl = process.env.DATABASE_URL;
const databaseSchema = process.env.DATABASE_SCHEMA ?? 'atoms_cp';
const previewBaseUrl = process.env.PREVIEW_BASE_URL ?? 'http://localhost:4000/preview';
const previewAccessSecret = process.env.PREVIEW_ACCESS_SECRET ?? 'development-preview-access-secret';
const previewRoot = process.env.PREVIEW_ROOT_DIR ?? '/tmp/atoms-cp-previews';
const workspaceRoot = process.env.BUILD_WORKSPACE_ROOT ?? '/tmp/atoms-cp-build-workspaces';
const maxConcurrent = Number(process.env.BUILD_MAX_CONCURRENT ?? 1);
const pool = databaseUrl
  ? new Pool({
    connectionString: databaseUrl,
    ...(databaseSchema === 'public'
      ? {}
      : {
          options: `-c search_path=${validateDatabaseSchema(databaseSchema)},public`
        })
  })
  : undefined;
let processing = false;

async function emitHeartbeat(): Promise<void> {
  const timestamp = new Date().toISOString();

  if (!pool) {
    console.log(JSON.stringify({
      service: 'atoms-cp-builder-worker',
      workerId,
      status: 'idle',
      persistence: 'disabled',
      timestamp
    }));
    return;
  }

  try {
    let status = 'idle';
    let activeBuildJobId: string | undefined;

    if (!processing) {
      processing = true;
      try {
        const processed = await processNextBuildJob(pool, {
          previewBaseUrl,
          previewAccessSecret,
          previewRoot,
          workspaceRoot
        });

        if (processed) {
          status = processed.status === 'success' ? 'build_success' : 'build_failed';
          activeBuildJobId = processed.id;
        }
      } finally {
        processing = false;
      }
    }

    const heartbeat = await recordWorkerHeartbeat(pool, {
      workerId,
      role,
      status,
      metadata: {
        service: 'atoms-cp-builder-worker',
        activeBuildJobId,
        maxConcurrent
      }
    });
    console.log(JSON.stringify({
      service: 'atoms-cp-builder-worker',
      workerId: heartbeat.workerId,
      status: heartbeat.status,
      persistence: 'postgres',
      timestamp: heartbeat.lastSeenAt
    }));
  } catch (error) {
    console.error(JSON.stringify({
      service: 'atoms-cp-builder-worker',
      workerId,
      status: 'heartbeat_failed',
      error: error instanceof Error ? error.message : 'Unknown heartbeat error',
      timestamp
    }));
  }
}

await emitHeartbeat();
setInterval(() => {
  void emitHeartbeat();
}, intervalMs);

function validateDatabaseSchema(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`Unsafe Postgres schema: ${value}`);
  }

  return value;
}
