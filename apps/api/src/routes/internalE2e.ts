import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import type { AppStore } from '../modules/data/appStore.js';
import { runInternalBetaSmoke } from '../modules/smoke/internalBetaSmoke.js';

const internalE2eInputSchema = z.object({
  projectName: z.string().min(1).max(80).optional()
}).default({});

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isInternalE2eAuthorized(request: FastifyRequest, expectedToken?: string): boolean {
  if (!expectedToken) {
    return true;
  }

  const header = request.headers['x-internal-e2e-token'];
  const token = Array.isArray(header) ? header[0] : header;
  return typeof token === 'string' && safeEqual(token, expectedToken);
}

function traceLabel(type: string): string {
  switch (type) {
    case 'agent_started':
      return '准备应用';
    case 'codex_task_created':
    case 'codex_task_claimed':
    case 'codex_task_completed':
      return '生成版本';
    case 'preview_snapshot_created':
      return '预览快照';
    case 'selector_patch_created':
    case 'patch_applied':
      return '继续修改';
    case 'version_rollback_created':
      return '回退版本';
    case 'build_started':
    case 'build_completed':
    case 'build_queued':
      return '构建校验';
    case 'agent_completed':
      return '发布检查';
    case 'error':
      return '异常恢复';
    default:
      return '运行事件';
  }
}

export async function registerInternalE2eRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.post('/api/internal/e2e/internal-beta-lifecycle', async (request, reply) => {
    const env = loadEnv();

    if (env.NODE_ENV === 'production' || !env.INTERNAL_E2E_ENABLED) {
      return reply.code(404).send({
        error: 'Not found'
      });
    }

    if (!isInternalE2eAuthorized(request, env.INTERNAL_E2E_TOKEN)) {
      return reply.code(403).send({
        error: 'Internal E2E token required'
      });
    }

    const parsed = internalE2eInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid internal E2E input',
        details: parsed.error.flatten()
      });
    }

    const report = await runInternalBetaSmoke({
      store,
      workspaceRoot: env.CODEX_WORKSPACE_ROOT,
      previewRoot: env.PREVIEW_ROOT_DIR,
      previewBaseUrl: env.PREVIEW_BASE_URL,
      previewAccessSecret: env.PREVIEW_ACCESS_SECRET,
      projectName: parsed.data.projectName ?? 'R8 Internal Beta Lifecycle'
    });
    const traces = report.projectId ? await store.listTraceEvents(report.projectId, 50) : [];
    const frontendRoutes = report.projectId
      ? {
          workbench: `/app/${report.projectId}`,
          inspector: `/app/${report.projectId}/inspect`,
          versions: `/app/${report.projectId}/versions`,
          publish: `/app/${report.projectId}/publish`,
          admin: '/admin'
        }
      : {
          admin: '/admin'
        };

    return reply.code(report.status === 'passed' ? 201 : 500).send({
      status: report.status,
      projectId: report.projectId,
      codexTaskId: report.codexTaskId,
      initialBuildJobId: report.initialBuildJobId,
      initialPreviewSnapshotId: report.initialPreviewSnapshotId,
      selectorPatchBuildJobId: report.selectorPatchBuildJobId,
      selectorPatchPreviewSnapshotId: report.selectorPatchPreviewSnapshotId,
      rollbackVersionId: report.rollbackVersionId,
      rollbackBuildJobId: report.rollbackBuildJobId,
      rollbackPreviewSnapshotId: report.rollbackPreviewSnapshotId,
      previewUrl: report.previewUrl,
      publishCanProceed: report.publishCanProceed,
      frontendRoutes,
      traceSummary: traces.slice().reverse().map((event) => ({
        id: event.id,
        type: event.type,
        label: traceLabel(event.type),
        visibility: event.visibility,
        message: event.message,
        createdAt: event.createdAt
      })),
      errors: report.errors
    });
  });
}
