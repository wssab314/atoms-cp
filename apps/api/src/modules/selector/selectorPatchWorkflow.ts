import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import {
  aiManifestSchema,
  type AiManifest,
  type BuildJobRecord,
  type GeneratedFile,
  type ManifestEntry,
  type ProjectFileRecord,
  type ProjectVersionRecord,
  type ProjectVersionSource,
  type TraceEventRecord
} from '@atoms-cp/shared';
import type { AppStore } from '../data/appStore.js';
import { copyWorkspaceVersion, workspaceVersionPath } from '../workspace/workspaceService.js';
import { applyDirectTextPatch } from './directTextPatch.js';
import { SelectorPatchError } from './selectorPatchAgent.js';

const deniedPathParts = new Set(['.env', 'node_modules', 'dist', '.git']);

export interface ApplySelectorTextPatchInput {
  store: AppStore;
  projectId: string;
  aiId: string;
  text: string;
  source: Extract<ProjectVersionSource, 'selector_edit' | 'agent_patch'>;
  summary: string;
  purpose: string;
  workspaceRoot: string;
}

export interface ApplySelectorTextPatchResult {
  manifestEntry: ManifestEntry;
  projectVersion: ProjectVersionRecord;
  files: ProjectFileRecord[];
  buildJob: BuildJobRecord;
  traceEvent: TraceEventRecord;
}

export async function applySelectorTextPatch(input: ApplySelectorTextPatchInput): Promise<ApplySelectorTextPatchResult> {
  try {
    await input.store.appendTraceEvent({
      projectId: input.projectId,
      type: 'selector_patch_created',
      visibility: 'admin',
      message: 'Selector patch requested.',
      payload: {
        aiId: input.aiId,
        source: input.source
      }
    });
    await input.store.appendTraceEvent({
      projectId: input.projectId,
      type: 'selector_patch_created',
      visibility: 'user',
      message: '已收到继续修改请求。',
      payload: {
        aiId: input.aiId,
        source: input.source
      }
    });

    const { manifest, manifestEntry } = await loadManifestEntry(input.store, input.projectId, input.aiId);
    const targetPath = normalizePatchableProjectPath(manifestEntry.file);

    if (!targetPath) {
      throw new SelectorPatchError('Manifest target path is not patchable', 'SCHEMA_VALIDATION_FAILED', 409);
    }

    let targetFile = await input.store.getProjectFile(input.projectId, targetPath);
    let workspacePath: string | undefined;
    let parentVersionId: string | undefined;
    let sourceContent = targetFile?.content;
    const [latestVersion] = await input.store.listProjectVersions(input.projectId);

    if (latestVersion?.workspacePath) {
      workspacePath = workspaceVersionPath({
        workspaceRoot: input.workspaceRoot,
        projectId: input.projectId,
        taskId: `selector-${randomUUID()}`
      });
      parentVersionId = latestVersion.id;
      await copyWorkspaceVersion({
        sourcePath: latestVersion.workspacePath,
        targetPath: workspacePath
      });
      await input.store.appendTraceEvent({
        projectId: input.projectId,
        type: 'workspace_copied',
        visibility: 'admin',
        message: 'Workspace copied for selector patch.',
        payload: {
          parentVersionId
        }
      });

      const absoluteTargetPath = resolveWorkspaceFilePath(workspacePath, targetPath);
      sourceContent = await readFile(absoluteTargetPath, 'utf8');
    }

    if (!sourceContent) {
      throw new SelectorPatchError('Manifest target file not found', 'INTERNAL_ERROR', 409);
    }

    let patchedContent: string;

    try {
      patchedContent = applyDirectTextPatch({
        source: sourceContent,
        aiId: input.aiId,
        text: input.text
      });
    } catch {
      throw new SelectorPatchError('Selected element cannot be patched as direct text', 'SCHEMA_VALIDATION_FAILED', 409);
    }

    if (!patchedContent.includes(`data-ai-id="${input.aiId}"`)) {
      throw new SelectorPatchError('Selector patch would remove the ai-id marker', 'SCHEMA_VALIDATION_FAILED', 409);
    }

    if (workspacePath) {
      const absoluteTargetPath = resolveWorkspaceFilePath(workspacePath, targetPath);
      await mkdir(dirname(absoluteTargetPath), { recursive: true });
      await writeFile(absoluteTargetPath, patchedContent, 'utf8');
    }

    await input.store.appendTraceEvent({
      projectId: input.projectId,
      type: 'patch_applied',
      visibility: 'admin',
      message: 'Selector patch applied.',
      payload: {
        aiId: input.aiId,
        changedFile: targetPath
      }
    });

    const patchedFile: GeneratedFile = {
      path: targetPath,
      content: patchedContent,
      purpose: input.purpose
    };
    const saved = await input.store.saveProjectFilePatch({
      projectId: input.projectId,
      source: input.source,
      summary: input.summary,
      files: [patchedFile],
      manifest,
      workspacePath,
      parentVersionId
    });

    if (workspacePath) {
      await input.store.createWorkspace({
        projectId: input.projectId,
        projectVersionId: saved.projectVersion.id,
        path: workspacePath,
        status: 'ready'
      });
    }

    const buildJob = await input.store.createBuildJob(input.projectId, {
      projectVersionId: saved.projectVersion.id
    });
    await input.store.setProjectStatus(input.projectId, 'building');
    const traceEvent = await input.store.appendTraceEvent({
      projectId: input.projectId,
      buildJobId: buildJob.id,
      type: 'build_queued',
      visibility: 'admin',
      message: 'Build queued for selector patch.',
      payload: {
        projectVersionId: saved.projectVersion.id,
        changedFiles: saved.projectVersion.changedFiles
      }
    });
    await input.store.appendTraceEvent({
      projectId: input.projectId,
      buildJobId: buildJob.id,
      type: 'build_queued',
      visibility: 'user',
      message: '已开始准备新的预览快照。',
      payload: {
        projectVersionId: saved.projectVersion.id
      }
    });

    return {
      manifestEntry,
      projectVersion: saved.projectVersion,
      files: saved.files,
      buildJob,
      traceEvent
    };
  } catch (error) {
    await input.store.appendTraceEvent({
      projectId: input.projectId,
      type: 'patch_failed',
      visibility: 'admin',
      message: 'Selector patch failed.',
      payload: {
        aiId: input.aiId,
        error: error instanceof Error ? error.message : 'Unknown selector patch failure'
      }
    });
    await input.store.appendTraceEvent({
      projectId: input.projectId,
      type: 'patch_failed',
      visibility: 'user',
      message: '局部修改失败，请换个元素或简化修改要求。',
      payload: {
        stage: 'failed',
        aiId: input.aiId
      }
    });
    throw error;
  }
}

async function loadManifestEntry(store: AppStore, projectId: string, aiId: string): Promise<{
  manifest: AiManifest;
  manifestEntry: ManifestEntry;
}> {
  const manifestFile = await store.getProjectFile(projectId, 'ai-manifest.json');

  if (!manifestFile) {
    throw new SelectorPatchError('AI manifest not found', 'INTERNAL_ERROR', 409);
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestFile.content);
  } catch {
    throw new SelectorPatchError('AI manifest is invalid', 'SCHEMA_VALIDATION_FAILED', 409);
  }

  const manifest = aiManifestSchema.safeParse(manifestJson);

  if (!manifest.success) {
    throw new SelectorPatchError('AI manifest is invalid', 'SCHEMA_VALIDATION_FAILED', 409);
  }

  const manifestEntry = manifest.data.entries[aiId];

  if (!manifestEntry) {
    throw new SelectorPatchError('Selected element not found in manifest', 'INTERNAL_ERROR', 404);
  }

  if (!manifestEntry.editable.includes('text')) {
    throw new SelectorPatchError('Selected element is not text editable', 'SCHEMA_VALIDATION_FAILED', 409);
  }

  return {
    manifest: manifest.data,
    manifestEntry
  };
}

function normalizePatchableProjectPath(value: string): string | undefined {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    return undefined;
  }

  const normalized = posix.normalize(value.replace(/\\/g, '/'));
  const parts = normalized.split('/');

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }

  if (parts.some((part) => deniedPathParts.has(part) || part.startsWith('.env.'))) {
    return undefined;
  }

  if (!normalized.startsWith('src/')) {
    return undefined;
  }

  return normalized;
}

function resolveWorkspaceFilePath(workspacePath: string, relativePath: string): string {
  const absolutePath = join(workspacePath, relativePath);
  const relativeToWorkspace = relative(workspacePath, absolutePath).split(sep).join('/');

  if (relativeToWorkspace.startsWith('../') || relativeToWorkspace === '..' || isAbsolute(relativeToWorkspace)) {
    throw new SelectorPatchError('Workspace target path escaped the workspace', 'SCHEMA_VALIDATION_FAILED', 409);
  }

  return absolutePath;
}
