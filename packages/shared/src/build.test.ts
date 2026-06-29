import { describe, expect, it } from 'vitest';
import { buildJobRecordSchema, buildLogRecordSchema } from './build.js';

describe('M4 build and preview schemas', () => {
  it('validates build job records with preview URLs after success', () => {
    const buildJob = buildJobRecordSchema.parse({
      id: 'build-1',
      projectId: 'project-1',
      projectVersionId: 'version-1',
      status: 'success',
      command: 'pnpm install && pnpm build',
      previewUrl: 'http://localhost:4000/preview/build-1/index.html',
      createdAt: '2026-06-27T00:00:00.000Z',
      startedAt: '2026-06-27T00:00:01.000Z',
      finishedAt: '2026-06-27T00:00:02.000Z'
    });

    expect(buildJob).toMatchObject({
      status: 'success',
      previewUrl: 'http://localhost:4000/preview/build-1/index.html'
    });
  });

  it('validates build log records without exposing terminal input capability', () => {
    const log = buildLogRecordSchema.parse({
      id: 'log-1',
      buildJobId: 'build-1',
      stream: 'system',
      line: 'Build completed successfully.',
      createdAt: '2026-06-27T00:00:03.000Z'
    });

    expect(log.stream).toBe('system');
    expect(log).not.toHaveProperty('stdin');
  });
});
