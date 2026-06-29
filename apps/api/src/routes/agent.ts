import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';
import { drainDeferredAgentMessage, listAgentStreamEvents, submitAgentMessage, type AgentStreamEvent } from '../modules/agent/agentConversation.js';
import { getProjectGenerationStatus } from '../modules/generation/generationOrchestrator.js';

interface ProjectParams {
  projectId: string;
}

const agentMessageInputSchema = z.object({
  content: z.string().trim().min(2).max(1000)
}).strict();

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

  return { project, user };
}

export async function registerAgentRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.get('/api/projects/:projectId/agent-stream', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const access = await ensureProjectAccess(request, reply, store, projectId);

    if (!access) {
      return reply;
    }
    const { project } = access;

    await drainDeferredAgentMessage({ store, project });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sentIds = new Set<string>();
    const sendEvent = (event: AgentStreamEvent) => {
      if (sentIds.has(event.id)) {
        return;
      }
      sentIds.add(event.id);
      reply.raw.write(`event: agent-event\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const sendSnapshot = async () => {
      const [events, status] = await Promise.all([
        listAgentStreamEvents({ store, project, limit: 30 }),
        getProjectGenerationStatus({ store, project })
      ]);
      for (const event of events) {
        sendEvent(event);
      }
      sendEvent({
        id: `status-${status.stage}-${status.previewSnapshotId ?? 'pending'}`,
        kind: status.stage === 'failed' ? 'error' : 'status',
        message: status.errorMessage ?? status.userMessage,
        stage: status.stage,
        status: status.stage === 'failed' ? 'failed' : status.stage === 'preview_ready' ? 'done' : 'progress',
        snapshotUrl: status.previewUrl,
        createdAt: new Date().toISOString()
      });
    };

    await sendSnapshot();

    if (process.env.NODE_ENV === 'test') {
      reply.raw.end();
      return reply;
    }

    const interval = setInterval(() => {
      void sendSnapshot().catch((error) => {
        request.log.warn({ error }, 'agent stream snapshot failed');
      });
    }, 2000);
    request.raw.on('close', () => {
      clearInterval(interval);
      reply.raw.end();
    });

    return reply;
  });

  app.get('/api/projects/:projectId/agent-messages', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const access = await ensureProjectAccess(request, reply, store, projectId);

    if (!access) {
      return reply;
    }

    return reply.send(await store.listAgentMessages(access.project.id, 50));
  });

  app.post('/api/projects/:projectId/agent-messages', async (request, reply) => {
    const parsed = agentMessageInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid agent message input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const access = await ensureProjectAccess(request, reply, store, projectId);

    if (!access) {
      return reply;
    }

    const result = await submitAgentMessage({
      store,
      project: access.project,
      user: access.user,
      content: parsed.data.content
    });

    return reply.code(202).send(result);
  });
}
