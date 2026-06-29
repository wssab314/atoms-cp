import { access, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupGeneratedStorage } from './storageCleanup.js';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atoms-storage-cleanup-'));
  roots.push(root);
  return root;
}

async function touchDir(path: string, date: Date): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'index.html'), '<main>preview</main>', 'utf8');
  await utimes(path, date, date);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('cleanupGeneratedStorage', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('deletes expired preview and workspace entries while preserving active previews', async () => {
    const root = await makeRoot();
    const previewRoot = join(root, 'previews');
    const workspaceRoot = join(root, 'workspaces');
    const buildWorkspaceRoot = join(root, 'build-workspaces');
    const oldDate = new Date('2026-06-01T00:00:00.000Z');
    const freshDate = new Date('2026-06-27T00:00:00.000Z');
    const activePreview = join(previewRoot, 'preview-active');
    const expiredPreview = join(previewRoot, 'preview-expired');
    const freshPreview = join(previewRoot, 'preview-fresh');
    const expiredWorkspace = join(workspaceRoot, 'workspace-expired');
    const freshWorkspace = join(workspaceRoot, 'workspace-fresh');
    const expiredBuildWorkspace = join(buildWorkspaceRoot, 'build-expired');

    await touchDir(activePreview, oldDate);
    await touchDir(expiredPreview, oldDate);
    await touchDir(freshPreview, freshDate);
    await touchDir(expiredWorkspace, oldDate);
    await touchDir(freshWorkspace, freshDate);
    await touchDir(expiredBuildWorkspace, oldDate);

    const result = await cleanupGeneratedStorage({
      previewRoot,
      workspaceRoot,
      buildWorkspaceRoot,
      previewRetentionDays: 14,
      workspaceRetentionDays: 7,
      now: new Date('2026-06-28T00:00:00.000Z'),
      activePreviewPaths: [activePreview]
    });

    expect(result.deletedPaths.sort()).toEqual([expiredBuildWorkspace, expiredPreview, expiredWorkspace].sort());
    expect(await exists(activePreview)).toBe(true);
    expect(await exists(freshPreview)).toBe(true);
    expect(await exists(freshWorkspace)).toBe(true);
    expect(await exists(expiredPreview)).toBe(false);
    expect(await exists(expiredWorkspace)).toBe(false);
  });

  it('refuses to clean unsafe roots', async () => {
    await expect(cleanupGeneratedStorage({
      previewRoot: '/',
      workspaceRoot: '/tmp/atoms-workspaces',
      previewRetentionDays: 14,
      workspaceRetentionDays: 7
    })).rejects.toThrow(/unsafe/i);
  });

  it('does not create missing roots during cleanup', async () => {
    const root = await makeRoot();
    const missing = join(root, 'missing-previews');

    const result = await cleanupGeneratedStorage({
      previewRoot: missing,
      workspaceRoot: join(root, 'missing-workspaces'),
      previewRetentionDays: 14,
      workspaceRetentionDays: 7
    });

    expect(result.deletedPaths).toEqual([]);
    await expect(stat(missing)).rejects.toThrow();
  });
});
