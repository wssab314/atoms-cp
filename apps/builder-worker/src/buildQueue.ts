import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  buildProjectPreview,
  type BuildCommandContext,
  type BuildCommandResult,
  type BuildProjectFile,
  type PreviewBuildMode,
  type PreviewBuildPlatform
} from './buildProject.js';
import { createPreviewAccessToken } from './previewAccess.js';

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface ProcessBuildQueueConfig {
  previewBaseUrl: string;
  previewAccessSecret: string;
  previewRoot: string;
  workspaceRoot: string;
  previewBuildMode?: PreviewBuildMode;
  templateRoot?: string;
  taroTemplateRoot?: string;
  runCommand?: (context: BuildCommandContext) => Promise<BuildCommandResult>;
}

export interface ProcessedBuildJob {
  id: string;
  projectId: string;
  status: 'success' | 'failed';
  previewSnapshotId?: string;
  previewUrl?: string;
  errorSummary?: string;
}

interface BuildJobRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  project_version_id: string | null;
}

interface ProjectFileRow extends Record<string, unknown> {
  path: string;
  content: string;
}

interface ProjectVersionWorkspaceRow extends Record<string, unknown> {
  workspace_path: string | null;
}

interface ProjectTargetRow extends Record<string, unknown> {
  target: string | null;
}

const ignoredWorkspaceNames = new Set(['node_modules', 'dist', '.git']);

export async function processNextBuildJob(
  db: Queryable,
  config: ProcessBuildQueueConfig
): Promise<ProcessedBuildJob | undefined> {
  const previewBuildMode = config.previewBuildMode ?? 'fast';
  const buildJob = await claimNextBuildJob(db, buildCommandForMode(previewBuildMode));

  if (!buildJob) {
    return undefined;
  }

  await appendTraceEvent(db, {
    projectId: buildJob.project_id,
    buildJobId: buildJob.id,
    type: 'build_started',
    message: 'Build worker started building project preview.',
    payload: {
      projectVersionId: buildJob.project_version_id
    }
  });
  await appendTraceEvent(db, {
    projectId: buildJob.project_id,
    buildJobId: buildJob.id,
    type: 'build_started',
    visibility: 'user',
    message: '正在准备预览快照。',
    payload: {
      stage: 'building_preview'
    }
  });
  const files = await loadProjectFiles(db, buildJob);
  const buildPlatform = await loadProjectTarget(db, buildJob.project_id);

  if (files.length === 0) {
    const errorSummary = 'Project has no files to build.';
    await appendBuildLog(db, buildJob.id, 'system', errorSummary);
    await finishBuildJob(db, buildJob.id, 'failed', undefined, errorSummary);
    await updateProjectStatus(db, buildJob.project_id, 'build_failed', undefined);
    await appendTraceEvent(db, {
      projectId: buildJob.project_id,
      buildJobId: buildJob.id,
      type: 'error',
      message: 'Build failed because the project has no files.',
      payload: {
        errorSummary
      }
    });
    await appendTraceEvent(db, {
      projectId: buildJob.project_id,
      buildJobId: buildJob.id,
      type: 'error',
      visibility: 'user',
      message: '预览快照生成失败，请稍后重试。',
      payload: {
        stage: 'failed'
      }
    });
    return {
      id: buildJob.id,
      projectId: buildJob.project_id,
      status: 'failed',
      errorSummary
    };
  }

  const previewSnapshotId = buildJob.project_version_id ? createPreviewSnapshotId(buildJob.id) : buildJob.id;
  const result = await buildProjectPreview({
    buildJobId: previewSnapshotId,
    projectFiles: files,
    previewRoot: config.previewRoot,
    workspaceRoot: join(config.workspaceRoot, buildJob.id),
    buildMode: previewBuildMode,
    platform: buildPlatform,
    templateRoot: buildPlatform === 'mini_program' ? config.taroTemplateRoot : config.templateRoot,
    runCommand: config.runCommand
  });

  for (const log of result.logs) {
    await appendBuildLog(db, buildJob.id, log.stream, log.line);
  }

  if (result.status === 'failed') {
    const errorSummary = result.errorSummary ?? 'Build failed.';
    await finishBuildJob(db, buildJob.id, 'failed', undefined, errorSummary);
    await updateProjectStatus(db, buildJob.project_id, 'build_failed', undefined);
    await appendTraceEvent(db, {
      projectId: buildJob.project_id,
      buildJobId: buildJob.id,
      type: 'error',
      message: 'Build worker failed to produce a preview snapshot.',
      payload: {
        errorSummary
      }
    });
    await appendTraceEvent(db, {
      projectId: buildJob.project_id,
      buildJobId: buildJob.id,
      type: 'error',
      visibility: 'user',
      message: '预览快照生成失败，请稍后重试。',
      payload: {
        stage: 'failed'
      }
    });
    return {
      id: buildJob.id,
      projectId: buildJob.project_id,
      status: 'failed',
      errorSummary
    };
  }

  const previewUrl = createPreviewUrl(config.previewBaseUrl, previewSnapshotId, config.previewAccessSecret);
  const snapshot = buildJob.project_version_id
    ? await createReadyPreviewSnapshot(db, {
        previewSnapshotId,
        projectId: buildJob.project_id,
        projectVersionId: buildJob.project_version_id,
        buildJobId: buildJob.id,
        previewPath: result.previewPath,
        previewUrl
      })
    : undefined;
  if (snapshot) {
    await appendTraceEvent(db, {
      projectId: buildJob.project_id,
      buildJobId: buildJob.id,
      type: 'preview_snapshot_created',
      message: 'Preview snapshot created from successful build.',
      payload: {
        previewSnapshotId: snapshot.id,
        projectVersionId: buildJob.project_version_id
      }
    });
    await appendTraceEvent(db, {
      projectId: buildJob.project_id,
      buildJobId: buildJob.id,
      type: 'preview_snapshot_created',
      visibility: 'user',
      message: '预览快照已准备完成。',
      payload: {
        stage: 'preview_ready',
        previewSnapshotId: snapshot.id,
        snapshotUrl: previewUrl
      }
    });
  }
  await finishBuildJob(db, buildJob.id, 'success', previewUrl, undefined);
  await updateProjectStatus(db, buildJob.project_id, 'preview_ready', snapshot?.id ?? previewSnapshotId);
  await appendTraceEvent(db, {
    projectId: buildJob.project_id,
    buildJobId: buildJob.id,
    type: 'build_completed',
    message: 'Build worker completed preview build.',
    payload: {
      previewSnapshotId: snapshot?.id ?? previewSnapshotId,
      previewUrl
    }
  });

  return {
    id: buildJob.id,
    projectId: buildJob.project_id,
    status: 'success',
    previewSnapshotId: snapshot?.id,
    previewUrl
  };
}

function createPreviewSnapshotId(buildJobId: string): string {
  return `preview-snapshot-${buildJobId.replace(/^build-/, '')}`;
}

function createPreviewUrl(previewBaseUrl: string, previewId: string, previewAccessSecret: string): string {
  const url = new URL(`${previewBaseUrl.replace(/\/$/, '')}/${previewId}/index.html`);
  url.searchParams.set('token', createPreviewAccessToken({
    buildJobId: previewId,
    secret: previewAccessSecret
  }));
  return url.toString();
}

function buildCommandForMode(buildMode: PreviewBuildMode): string {
  return buildMode === 'fast' ? 'fast preview build' : 'strict preview build';
}

async function claimNextBuildJob(db: Queryable, buildCommand: string): Promise<BuildJobRow | undefined> {
  const result = await db.query<BuildJobRow>(
    `update build_jobs
     set status = 'running',
         command = $1,
         started_at = now()
     where id = (
       select id
       from build_jobs
       where status = 'queued'
       order by created_at asc
       for update skip locked
       limit 1
     )
     returning id, project_id, project_version_id`,
    [buildCommand]
  );

  return result.rows[0];
}

async function loadProjectFiles(db: Queryable, buildJob: BuildJobRow): Promise<BuildProjectFile[]> {
  const workspaceFiles = buildJob.project_version_id
    ? await loadWorkspaceFilesForVersion(db, buildJob.project_version_id)
    : [];

  if (workspaceFiles.length > 0) {
    return workspaceFiles;
  }

  const result = await db.query<ProjectFileRow>(
    `select path, content
     from project_files
     where project_id = $1
     order by path asc`,
    [buildJob.project_id]
  );

  return result.rows.map((row) => ({
    path: row.path,
    content: row.content
  }));
}

async function loadProjectTarget(db: Queryable, projectId: string): Promise<PreviewBuildPlatform> {
  const result = await db.query<ProjectTargetRow>(
    `select target
     from projects
     where id = $1
     limit 1`,
    [projectId]
  );

  return result.rows[0]?.target === 'mini_program' ? 'mini_program' : 'web';
}

async function loadWorkspaceFilesForVersion(db: Queryable, projectVersionId: string): Promise<BuildProjectFile[]> {
  const result = await db.query<ProjectVersionWorkspaceRow>(
    `select workspace_path
     from project_versions
     where id = $1
     limit 1`,
    [projectVersionId]
  );
  const workspacePath = result.rows[0]?.workspace_path;

  if (!workspacePath) {
    return [];
  }

  const rootPath = workspacePath;
  const files: BuildProjectFile[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoredWorkspaceNames.has(entry.name)) {
        continue;
      }

      const absolutePath = join(currentPath, entry.name);
      const relativePath = relative(rootPath, absolutePath).split(sep).join('/');

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile() || isDeniedWorkspaceFile(relativePath)) {
        continue;
      }

      files.push({
        path: relativePath,
        content: await readFile(absolutePath, 'utf8')
      });
    }
  }

  try {
    await walk(rootPath);
    return files.sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    return [];
  }
}

function isDeniedWorkspaceFile(filePath: string): boolean {
  return filePath
    .split('/')
    .some((part) => ignoredWorkspaceNames.has(part) || part === '.env' || part.startsWith('.env.'));
}

async function createReadyPreviewSnapshot(
  db: Queryable,
  input: {
    previewSnapshotId: string;
    projectId: string;
    projectVersionId: string;
    buildJobId: string;
    previewPath: string | undefined;
    previewUrl: string;
  }
): Promise<{ id: string }> {
  await db.query('update preview_snapshots set active = false, updated_at = now() where project_id = $1', [input.projectId]);
  const result = await db.query<{ id: string }>(
    `insert into preview_snapshots (
       id, project_id, project_version_id, build_job_id, status, path, url, active, created_at, updated_at
     )
     values ($1, $2, $3, $4, 'ready', $5, $6, true, now(), now())
     returning id`,
    [
      input.previewSnapshotId,
      input.projectId,
      input.projectVersionId,
      input.buildJobId,
      input.previewPath ?? '',
      input.previewUrl
    ]
  );

  return {
    id: result.rows[0]?.id ?? input.previewSnapshotId
  };
}

async function appendBuildLog(
  db: Queryable,
  buildJobId: string,
  stream: 'stdout' | 'stderr' | 'system',
  line: string
): Promise<void> {
  await db.query(
    `insert into build_logs (build_job_id, stream, line, created_at)
     values ($1, $2, $3, now())`,
    [buildJobId, stream, line]
  );
}

async function appendTraceEvent(
  db: Queryable,
  input: {
    projectId: string;
    buildJobId: string;
    type: 'build_started' | 'build_completed' | 'preview_snapshot_created' | 'error';
    message: string;
    visibility?: 'admin' | 'user';
    payload: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `insert into trace_events (
       project_id, build_job_id, type, visibility, message, payload, created_at
     )
     values ($1, $2, $3, $4, $5, $6::jsonb, now())`,
    [input.projectId, input.buildJobId, input.type, input.visibility ?? 'admin', input.message, JSON.stringify(input.payload)]
  );
}

async function finishBuildJob(
  db: Queryable,
  buildJobId: string,
  status: 'success' | 'failed',
  previewUrl: string | undefined,
  errorSummary: string | undefined
): Promise<void> {
  await db.query(
    `update build_jobs
     set status = $2,
         preview_url = $3,
         error_summary = $4,
         finished_at = now()
     where id = $1`,
    [buildJobId, status, previewUrl ?? null, errorSummary ?? null]
  );
}

async function updateProjectStatus(
  db: Queryable,
  projectId: string,
  status: 'preview_ready' | 'build_failed',
  previewId: string | undefined
): Promise<void> {
  await db.query(
    `update projects
     set status = '${status}',
         current_preview_id = $2,
         updated_at = now()
     where id = $1`,
    [projectId, previewId ?? null]
  );
}
