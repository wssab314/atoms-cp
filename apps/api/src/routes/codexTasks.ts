import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { previewSnapshotActivationResultSchema } from '@atoms-cp/shared';
import { loadEnv } from '../config/env.js';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';
import { createInitialCodexTaskPlan } from '../modules/orchestrator/codexTaskPlanner.js';

interface ProjectParams {
  projectId: string;
}

interface SnapshotParams extends ProjectParams {
  snapshotId: string;
}

const createCodexTaskInputSchema = z.object({
  taskType: z.literal('initial_generate').default('initial_generate')
});

const traceEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50)
});

async function ensureProjectAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  store: AppStore,
  projectId: string
) {
  const user = resolveRequestUser(request);
  const project = await store.getProjectById(user, projectId);

  if (!project) {
    reply.code(404).send({
      error: 'Project not found'
    });
    return undefined;
  }

  return project;
}

export async function registerCodexTaskRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.post('/api/projects/:projectId/codex-tasks', async (request, reply) => {
    const parsed = createCodexTaskInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid Codex task input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    const appSpec = await store.getLatestAppSpec(projectId);

    if (!appSpec) {
      return reply.code(409).send({
        error: 'AppSpec is required before creating a Codex task'
      });
    }

    const selectedDesign = await store.getSelectedDesignProfile(projectId);
    const fallbackDesign = selectedDesign ?? (await store.listDesignProfiles(projectId))[0];

    if (!fallbackDesign) {
      return reply.code(409).send({
        error: 'DesignProfile is required before creating a Codex task'
      });
    }

    const env = loadEnv();

    if (
      env.NODE_ENV !== 'test'
      && (
        !['docker', 'container'].includes(env.CODEX_WORKER_MODE)
        || !env.CODEX_REAL_EXECUTION_ENABLED
        || env.CODEX_REAL_PREFLIGHT_ONLY
        || !env.CODEX_REAL_USER_TASKS_ENABLED
      )
    ) {
      return reply.code(409).send({
        error: 'Real Codex worker execution is not enabled for user tasks'
      });
    }

    const workspace = await store.createWorkspace({
      projectId,
      path: `${env.CODEX_WORKSPACE_ROOT}/${projectId}/${randomUUID()}`,
      status: 'ready'
    });
    const taskPlan = createInitialCodexTaskPlan({
      project,
      appSpec: appSpec.spec,
      designProfile: fallbackDesign.profile
    });
    const codexTask = await store.createCodexTask({
      projectId,
      workspaceId: workspace.id,
      ...taskPlan
    });
    const traceEvent = await store.appendTraceEvent({
      projectId,
      codexTaskId: codexTask.id,
      type: 'codex_task_created',
      visibility: 'admin',
      message: 'CodexTask created from validated AppSpec and DesignProfile.',
      payload: {
        taskType: codexTask.taskType,
        workspaceId: workspace.id,
        appSpecId: appSpec.id,
        designProfileId: fallbackDesign.id
      }
    });

    return reply.code(201).send({
      workspace,
      codexTask,
      traceEvent
    });
  });

  app.get('/api/projects/:projectId/codex-tasks', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    return await store.listCodexTasks(projectId);
  });

  app.get('/api/projects/:projectId/workspaces', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    return await store.listWorkspaces(projectId);
  });

  app.get('/api/projects/:projectId/preview-snapshots', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    return await store.listPreviewSnapshots(projectId);
  });

  app.post('/api/projects/:projectId/preview-snapshots/:snapshotId/activate', async (request, reply) => {
    const { projectId, snapshotId } = request.params as SnapshotParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    const snapshots = await store.listPreviewSnapshots(projectId);
    const snapshot = snapshots.find((item) => item.id === snapshotId);

    if (!snapshot) {
      return reply.code(404).send({
        error: 'Preview snapshot not found'
      });
    }

    if (snapshot.status !== 'ready') {
      return reply.code(409).send({
        error: 'Only ready preview snapshots can be activated'
      });
    }

    const activated = await store.activatePreviewSnapshot(snapshotId);

    if (!activated) {
      return reply.code(404).send({
        error: 'Preview snapshot not found'
      });
    }

    const traceEvent = await store.appendTraceEvent({
      projectId,
      type: 'preview_snapshot_activated',
      visibility: 'admin',
      message: 'Preview snapshot activated.',
      payload: {
        previewSnapshotId: activated.id,
        projectVersionId: activated.projectVersionId
      }
    });

    return previewSnapshotActivationResultSchema.parse({
      previewSnapshot: activated,
      traceEvent
    });
  });

  app.get('/api/projects/:projectId/trace-events', async (request, reply) => {
    const parsed = traceEventsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid trace event query',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    return await store.listTraceEvents(projectId, parsed.data.limit);
  });
}
