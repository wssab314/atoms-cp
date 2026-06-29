import { randomUUID } from 'node:crypto';
import type {
  BuildJobRecord,
  GeneratedFile,
  ProjectVersionRecord,
  TraceEventRecord
} from '@atoms-cp/shared';
import type { AppStore } from '../data/appStore.js';
import { collectWorkspaceFiles, copyWorkspaceVersion, workspaceVersionPath } from '../workspace/workspaceService.js';

export class ProjectVersionRollbackError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorType: 'VERSION_NOT_FOUND' | 'NO_ROLLBACK_SOURCE'
  ) {
    super(message);
    this.name = 'ProjectVersionRollbackError';
  }
}

export interface RollbackProjectVersionInput {
  store: AppStore;
  projectId: string;
  targetVersionId: string;
  workspaceRoot: string;
}

export interface RollbackProjectVersionResult {
  projectVersion: ProjectVersionRecord;
  files: GeneratedFile[];
  buildJob: BuildJobRecord;
  traceEvent: TraceEventRecord;
}

export async function rollbackProjectVersion(input: RollbackProjectVersionInput): Promise<RollbackProjectVersionResult> {
  const versions = await input.store.listProjectVersions(input.projectId);
  const targetVersion = versions.find((version) => version.id === input.targetVersionId);

  if (!targetVersion) {
    throw new ProjectVersionRollbackError('Project version not found', 404, 'VERSION_NOT_FOUND');
  }

  const workspacePath = targetVersion.workspacePath
    ? workspaceVersionPath({
        workspaceRoot: input.workspaceRoot,
        projectId: input.projectId,
        taskId: `rollback-${randomUUID()}`
      })
    : undefined;

  let files: GeneratedFile[];

  if (targetVersion.workspacePath && workspacePath) {
    await copyWorkspaceVersion({
      sourcePath: targetVersion.workspacePath,
      targetPath: workspacePath
    });
    await input.store.appendTraceEvent({
      projectId: input.projectId,
      type: 'workspace_copied',
      visibility: 'admin',
      message: 'Workspace copied for version rollback.',
      payload: {
        targetVersionId: targetVersion.id,
        targetVersion: targetVersion.version
      }
    });
    files = await collectWorkspaceFiles(workspacePath);
  } else {
    const projectFiles = await input.store.listProjectFiles(input.projectId);
    files = projectFiles.map((file) => ({
      path: file.path,
      content: file.content,
      purpose: `Rollback source file: ${file.path}`
    }));
  }

  if (files.length === 0) {
    throw new ProjectVersionRollbackError('Project version has no files to roll back to', 409, 'NO_ROLLBACK_SOURCE');
  }

  const rollbackEvent = await input.store.appendTraceEvent({
    projectId: input.projectId,
    type: 'version_rollback_created',
    visibility: 'admin',
    message: `Rollback requested to version ${targetVersion.version}.`,
    payload: {
      targetVersionId: targetVersion.id,
      targetVersion: targetVersion.version,
      copiedWorkspace: Boolean(workspacePath)
    }
  });
  await input.store.appendTraceEvent({
    projectId: input.projectId,
    type: 'version_rollback_created',
    visibility: 'user',
    message: `将基于稳定版本 ${targetVersion.version} 重新生成一个新版本。`,
    payload: {
      targetVersionId: targetVersion.id,
      targetVersion: targetVersion.version
    }
  });

  const saved = await input.store.saveProjectFilePatch({
    projectId: input.projectId,
    source: 'rollback',
    summary: `Rolled back to version ${targetVersion.version}`,
    files,
    workspacePath,
    parentVersionId: targetVersion.id
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
    message: 'Build queued for version rollback.',
    payload: {
      rollbackTraceEventId: rollbackEvent.id,
      targetVersionId: targetVersion.id,
      projectVersionId: saved.projectVersion.id,
      changedFiles: saved.projectVersion.changedFiles
    }
  });
  await input.store.appendTraceEvent({
    projectId: input.projectId,
    buildJobId: buildJob.id,
    type: 'build_queued',
    visibility: 'user',
    message: '回退版本已进入预览快照准备流程。',
    payload: {
      projectVersionId: saved.projectVersion.id
    }
  });

  return {
    projectVersion: saved.projectVersion,
    files,
    buildJob,
    traceEvent
  };
}
