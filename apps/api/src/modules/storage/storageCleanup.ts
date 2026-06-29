import { readdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { Pool } from 'pg';

export interface CleanupGeneratedStorageInput {
  previewRoot: string;
  workspaceRoot: string;
  buildWorkspaceRoot?: string;
  previewRetentionDays: number;
  workspaceRetentionDays: number;
  now?: Date;
  activePreviewPaths?: string[];
}

export interface CleanupGeneratedStorageResult {
  deletedPaths: string[];
}

const MIN_SAFE_ROOT_LENGTH = 8;

export async function cleanupGeneratedStorage(input: CleanupGeneratedStorageInput): Promise<CleanupGeneratedStorageResult> {
  const now = input.now ?? new Date();
  const activePreviewPaths = new Set((input.activePreviewPaths ?? []).map((path) => resolve(path)));
  const deletedPaths = [
    ...await cleanupRoot({
      root: input.previewRoot,
      cutoff: cutoffDate(now, input.previewRetentionDays),
      protectedPaths: activePreviewPaths
    }),
    ...await cleanupRoot({
      root: input.workspaceRoot,
      cutoff: cutoffDate(now, input.workspaceRetentionDays)
    }),
    ...(input.buildWorkspaceRoot
      ? await cleanupRoot({
          root: input.buildWorkspaceRoot,
          cutoff: cutoffDate(now, input.workspaceRetentionDays)
        })
      : [])
  ];

  return { deletedPaths };
}

export async function listActivePreviewPaths(db: Pool): Promise<string[]> {
  const result = await db.query<{ path: string }>(
    `select path
     from preview_snapshots
     where active = true and status = 'ready'`
  );

  return result.rows.map((row) => row.path);
}

async function cleanupRoot(input: {
  root: string;
  cutoff: Date;
  protectedPaths?: Set<string>;
}): Promise<string[]> {
  const root = resolve(input.root);
  assertSafeCleanupRoot(root);

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const deletedPaths: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(root, entry.name);

    if (!entryPath.startsWith(`${root}/`) || input.protectedPaths?.has(entryPath)) {
      continue;
    }

    const entryStat = await stat(entryPath);

    if (entryStat.mtime > input.cutoff) {
      continue;
    }

    await rm(entryPath, { recursive: true, force: true });
    deletedPaths.push(entryPath);
  }

  return deletedPaths;
}

function cutoffDate(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

function assertSafeCleanupRoot(root: string): void {
  if (!isAbsolute(root) || root === '/' || root.length < MIN_SAFE_ROOT_LENGTH) {
    throw new Error(`Unsafe cleanup root: ${root}`);
  }
}
