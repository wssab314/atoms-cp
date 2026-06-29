import type { FastifyInstance } from 'fastify';
import { vercelEnvCheckInputSchema } from '@atoms-cp/shared';
import { loadEnv } from '../config/env.js';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';
import { checkVercelProjectEnv } from '../modules/vercel/envCheck.js';

interface ProjectParams {
  projectId: string;
}

export async function registerVercelRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.post('/api/projects/:projectId/vercel/env/check', async (request, reply) => {
    const parsed = vercelEnvCheckInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid Vercel environment check input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    return checkVercelProjectEnv(projectId, parsed.data, loadEnv());
  });
}
