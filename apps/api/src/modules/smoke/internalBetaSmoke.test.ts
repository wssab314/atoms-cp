import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewAccessToken } from '@atoms-cp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemoryStore } from '../data/inMemoryStore.js';
import { runInternalBetaSmoke } from './internalBetaSmoke.js';

const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-r7-smoke-'));
  roots.push(root);
  return root;
}

describe('runInternalBetaSmoke', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('runs the internal beta backend loop without exposing host paths or secrets in the report', async () => {
    const root = await makeRoot();
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));

    const report = await runInternalBetaSmoke({
      store,
      workspaceRoot: join(root, 'workspaces'),
      previewRoot: join(root, 'previews'),
      previewBaseUrl: 'https://atoms-api.example.test/preview',
      previewAccessSecret: 'test-preview-secret-32-characters',
      projectName: 'R7 内测烟测项目'
    });

    expect(report).toMatchObject({
      status: 'passed',
      projectId: expect.any(String),
      codexTaskId: expect.any(String),
      initialBuildJobId: expect.any(String),
      initialPreviewSnapshotId: expect.any(String),
      selectorPatchBuildJobId: expect.any(String),
      rollbackVersionId: expect.any(String),
      rollbackBuildJobId: expect.any(String),
      publishCanProceed: true,
      errors: []
    });
    expect(report.traceCount).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(report)).not.toContain(root);
    expect(JSON.stringify(report)).not.toContain('test-preview-secret');
    expect(report.projectId).toBeDefined();
    expect(report.previewUrl).toContain('/preview/');
    expect(report.previewUrl).toContain('token=');

    const traces = await store.listTraceEvents(report.projectId!, 50);
    expect(traces.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'agent_started',
        'codex_task_completed',
        'preview_snapshot_created',
        'selector_patch_created',
        'version_rollback_created',
        'agent_completed'
      ])
    );
    expect(traces.some((event) => event.message.includes('Internal beta smoke'))).toBe(true);

    const initialBuildJobId = report.initialBuildJobId!;
    const previewHtml = await readFile(join(root, 'previews', initialBuildJobId, 'index.html'), 'utf8');
    const expectedToken = createPreviewAccessToken({
      buildJobId: initialBuildJobId,
      secret: 'test-preview-secret-32-characters'
    });

    expect(previewHtml).toContain('data-ai-id=');
    expect(previewHtml).toContain('atoms-cp:preview-element-selected');
    expect(previewHtml).not.toContain('test-preview-secret');
    expect(report.previewUrl).toContain(expectedToken);
  });
});
