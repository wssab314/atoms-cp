import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { processNextBuildJob, type Queryable } from './buildQueue.js';
import { createPreviewAccessToken } from './previewAccess.js';

type Row = Record<string, unknown>;

interface MutableBuildJob extends Row {
  id: string;
  project_id: string;
  project_version_id: string;
  status: string;
  command: string | null;
  preview_url: string | null;
  error_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function createWorkerDb(options: { projectTarget?: 'web' | 'mini_program' } = {}): Queryable & { queries: Array<{ text: string; values: readonly unknown[] }> } {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const previewSnapshots: Row[] = [];
  const traceEvents: Row[] = [];
  const buildJob: MutableBuildJob = {
    id: 'build-1',
    project_id: 'project-1',
    project_version_id: 'version-1',
    status: 'queued',
    command: null,
    preview_url: null,
    error_summary: null,
    started_at: null,
    finished_at: null,
    created_at: '2026-06-27T00:00:00.000Z'
  };

  return {
    queries,
    async query<T extends Row = Row>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });

      if (text.includes('for update skip locked')) {
        buildJob.status = 'running';
        buildJob.started_at = '2026-06-27T00:00:01.000Z';
        buildJob.command = String(values[0]);
        return { rows: [buildJob as unknown as T] };
      }

      if (text.includes('from project_files')) {
        return {
          rows: [
            {
              path: 'package.json',
              content: '{"scripts":{"build":"vite build"}}'
            },
            {
              path: 'src/App.tsx',
              content: '<main data-ai-id="home.hero.title">Preview</main>'
            }
          ] as unknown as T[]
        };
      }

      if (text.includes('from project_versions') && text.includes('workspace_path')) {
        return { rows: [] };
      }

      if (text.includes('from projects') && text.includes('target')) {
        return {
          rows: [
            {
              target: options.projectTarget ?? 'web'
            } as unknown as T
          ]
        };
      }

      if (text.includes('update preview_snapshots set active = false')) {
        previewSnapshots.forEach((snapshot) => {
          if (snapshot.project_id === values[0]) {
            snapshot.active = false;
          }
        });
        return { rows: [] };
      }

      if (text.includes('insert into preview_snapshots')) {
        const [id, projectId, projectVersionId, buildJobId, path, url] = values;
        const snapshot = {
          id,
          project_id: projectId,
          project_version_id: projectVersionId,
          build_job_id: buildJobId,
          status: 'ready',
          path,
          url,
          active: true,
          error_summary: null,
          created_at: '2026-06-27T00:00:02.500Z',
          updated_at: '2026-06-27T00:00:02.500Z'
        };
        previewSnapshots.unshift(snapshot);
        return { rows: [snapshot as unknown as T] };
      }

      if (text.includes('insert into build_logs')) {
        return {
          rows: [
            {
              id: `log-${queries.length}`,
              build_job_id: values[0],
              stream: values[1],
              line: values[2],
              created_at: '2026-06-27T00:00:02.000Z'
            } as unknown as T
          ]
        };
      }

      if (text.includes('insert into trace_events')) {
        const [projectId, buildJobId, type, visibility, message, payload] = values;
        const trace = {
          id: `trace-${traceEvents.length + 1}`,
          project_id: projectId,
          build_job_id: buildJobId,
          type,
          visibility,
          message,
          payload
        };
        traceEvents.push(trace);
        return { rows: [trace as unknown as T] };
      }

      if (text.includes('update build_jobs') && text.includes('finished_at')) {
        buildJob.status = String(values[1]);
        buildJob.preview_url = values[2] as string | null;
        buildJob.error_summary = values[3] as string | null;
        buildJob.finished_at = '2026-06-27T00:00:03.000Z';
        return { rows: [buildJob as unknown as T] };
      }

      if (text.includes('update projects')) {
        return { rows: [] };
      }

      return { rows: [] };
    }
  };
}

function traceQueries(
  db: ReturnType<typeof createWorkerDb>,
  type: string,
  visibility?: string
): Array<{ text: string; values: readonly unknown[] }> {
  return db.queries.filter((query) => (
    query.text.includes('insert into trace_events')
    && query.values[2] === type
    && (visibility === undefined || query.values[3] === visibility)
  ));
}

describe('processNextBuildJob', () => {
  it('claims a queued build, writes preview snapshot output, logs status, and marks it successful', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-build-queue-test-'));
    const db = createWorkerDb();

    try {
      const result = await processNextBuildJob(db, {
        previewBaseUrl: 'http://localhost:4000/preview',
        previewAccessSecret: 'queue-preview-secret',
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspaces'),
        previewBuildMode: 'strict',
        runCommand: async ({ cwd }) => {
          await writeFile(join(cwd, 'dist', 'index.html'), '<main data-ai-id="home.hero.title">Preview</main>');
          return {
            exitCode: 0,
            stdout: 'worker build ok',
            stderr: ''
          };
        }
      });

      expect(result?.status).toBe('success');
      expect(result?.previewSnapshotId).toBe('preview-snapshot-1');
      expect(result?.previewUrl).toMatch(/^http:\/\/localhost:4000\/preview\/preview-snapshot-1\/index\.html\?token=/);
      expect(new URL(result?.previewUrl ?? '').searchParams.get('token')).toBe(createPreviewAccessToken({
        buildJobId: 'preview-snapshot-1',
        secret: 'queue-preview-secret'
      }));
      expect(db.queries.some((query) => query.text.includes('for update skip locked'))).toBe(true);
      expect(db.queries.some((query) => query.text.includes('insert into preview_snapshots'))).toBe(true);
      expect(db.queries.some((query) => query.text.includes('insert into build_logs'))).toBe(true);
      expect(traceQueries(db, 'build_started', 'admin').length).toBeGreaterThan(0);
      expect(traceQueries(db, 'build_started', 'user').some((query) => query.values[4] === '正在准备预览快照。')).toBe(true);
      expect(traceQueries(db, 'preview_snapshot_created', 'admin').length).toBeGreaterThan(0);
      expect(traceQueries(db, 'preview_snapshot_created', 'user').some((query) => query.values[4] === '预览快照已准备完成。')).toBe(true);
      expect(traceQueries(db, 'build_completed', 'admin').length).toBeGreaterThan(0);
      expect(db.queries.some((query) => query.text.includes("set status = 'preview_ready'"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes a user-safe failure trace when preview build fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-build-queue-test-'));
    const db = createWorkerDb();

    try {
      const result = await processNextBuildJob(db, {
        previewBaseUrl: 'http://localhost:4000/preview',
        previewAccessSecret: 'queue-preview-secret',
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspaces'),
        previewBuildMode: 'strict',
        runCommand: async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'Docker failed with pnpm stderr in /tmp/workspace/node_modules'
        })
      });

      expect(result?.status).toBe('failed');
      const userErrors = traceQueries(db, 'error', 'user');
      expect(userErrors.length).toBeGreaterThan(0);
      expect(userErrors.some((query) => query.values[4] === '预览快照生成失败，请稍后重试。')).toBe(true);
      expect(JSON.stringify(userErrors)).not.toMatch(/Docker|pnpm|stderr|workspace|node_modules|\/tmp/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes the mini program platform into preview builds for mini program projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-build-queue-mini-test-'));
    const db = createWorkerDb({ projectTarget: 'mini_program' });
    const taroTemplateRoot = await createMinimalTaroTemplate(root);
    let receivedCwd = '';

    try {
      const result = await processNextBuildJob(db, {
        previewBaseUrl: 'http://localhost:4000/preview',
        previewAccessSecret: 'queue-preview-secret',
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspaces'),
        previewBuildMode: 'fast',
        taroTemplateRoot,
        runCommand: async ({ cwd }) => {
          receivedCwd = cwd;
          await writeFile(join(cwd, 'dist', 'index.html'), '<main>mini preview</main>');
          return {
            exitCode: 0,
            stdout: 'mini build ok',
            stderr: ''
          };
        }
      });

      expect(result?.status).toBe('success');
      expect(receivedCwd).toContain(join(root, 'workspaces'));
      expect(db.queries.some((query) => query.text.includes('from projects') && query.text.includes('target'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createMinimalTaroTemplate(root: string): Promise<string> {
  const templateRoot = join(root, 'taro-template');
  await mkdir(join(templateRoot, 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(templateRoot, 'src', 'pages', 'index'), { recursive: true });
  await writeFile(join(templateRoot, 'package.json'), '{"dependencies":{"@tarojs/taro":"4.2.0","@tarojs/components":"4.2.0","react":"^18.2.0"}}', 'utf8');
  await writeFile(join(templateRoot, 'src', 'index.html'), '<div id="app"></div>', 'utf8');
  await writeFile(join(templateRoot, 'src', 'pages', 'index', 'index.tsx'), 'export default function Index() { return null; }', 'utf8');
  await writeFile(join(templateRoot, 'ai-manifest.json'), '{"version":1,"entries":[]}', 'utf8');
  await writeFile(join(templateRoot, 'node_modules', '.bin', 'taro'), '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(join(templateRoot, 'node_modules', '.bin', 'taro'), 0o755);
  return templateRoot;
}
