import { describe, expect, it } from 'vitest';
import { recordWorkerHeartbeat, type Queryable } from './heartbeat.js';

interface RecordedQuery {
  text: string;
  values: readonly unknown[];
}

function createFakeDb(): Queryable & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];

  return {
    queries,
    async query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });
      return {
        rows: [
          {
            worker_id: values[0],
            role: values[1],
            status: values[2],
            metadata: values[3],
            last_seen_at: '2026-06-27T10:00:00.000Z'
          } as unknown as T
        ]
      };
    }
  };
}

describe('recordWorkerHeartbeat', () => {
  it('upserts worker heartbeat status and metadata', async () => {
    const db = createFakeDb();

    const heartbeat = await recordWorkerHeartbeat(db, {
      workerId: 'worker-test',
      role: 'builder-worker',
      status: 'idle',
      metadata: {
        version: 'test'
      }
    });

    expect(heartbeat).toMatchObject({
      workerId: 'worker-test',
      role: 'builder-worker',
      status: 'idle'
    });
    expect(db.queries[0]?.text).toContain('insert into worker_heartbeats');
    expect(db.queries[0]?.text).toContain('on conflict (worker_id) do update');
    expect(db.queries[0]?.values).toEqual([
      'worker-test',
      'builder-worker',
      'idle',
      {
        version: 'test'
      }
    ]);
  });
});
