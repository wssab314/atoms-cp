export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface WorkerHeartbeat {
  workerId: string;
  role: string;
  status: string;
  metadata: Record<string, unknown>;
  lastSeenAt: string;
}

interface WorkerHeartbeatRow extends Record<string, unknown> {
  worker_id: string;
  role: string;
  status: string;
  metadata: Record<string, unknown>;
  last_seen_at: Date | string;
}

export interface RecordWorkerHeartbeatInput {
  workerId: string;
  role: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export async function recordWorkerHeartbeat(
  db: Queryable,
  input: RecordWorkerHeartbeatInput
): Promise<WorkerHeartbeat> {
  const result = await db.query<WorkerHeartbeatRow>(
    `insert into worker_heartbeats (worker_id, role, status, metadata, last_seen_at, created_at)
     values ($1, $2, $3, $4, now(), now())
     on conflict (worker_id) do update
     set role = excluded.role,
         status = excluded.status,
         metadata = excluded.metadata,
         last_seen_at = now()
     returning worker_id, role, status, metadata, last_seen_at`,
    [input.workerId, input.role, input.status, input.metadata ?? {}]
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error('Failed to record worker heartbeat');
  }

  return {
    workerId: row.worker_id,
    role: row.role,
    status: row.status,
    metadata: row.metadata,
    lastSeenAt: toIso(row.last_seen_at)
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
