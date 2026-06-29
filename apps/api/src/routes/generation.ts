import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';
import {
  getProjectGenerationStatus,
  isProjectGenerationActive,
  startProjectGenerationRun
} from '../modules/generation/generationOrchestrator.js';

interface ProjectParams {
  projectId: string;
}

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

export async function registerGenerationRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.post('/api/projects/:projectId/generation-runs', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    const started = startProjectGenerationRun({
      store,
      project
    });
    const status = await getProjectGenerationStatus({
      store,
      project
    });

    return reply.code(202).send({
      accepted: started.accepted,
      alreadyRunning: started.alreadyRunning || isProjectGenerationActive(projectId),
      status
    });
  });

  app.get('/api/projects/:projectId/generation-status', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const project = await ensureProjectAccess(request, reply, store, projectId);

    if (!project) {
      return reply;
    }

    return await getProjectGenerationStatus({
      store,
      project
    });
  });
}
