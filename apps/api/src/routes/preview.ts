import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { verifyPreviewAccessToken } from '@atoms-cp/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { loadEnv } from '../config/env.js';

interface PreviewParams {
  buildJobId: string;
  '*': string;
}

interface PreviewIndexParams {
  buildJobId: string;
}

export async function registerPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/preview/:buildJobId', async (request, reply) => {
    const { buildJobId } = request.params as PreviewIndexParams;
    return await sendPreviewFile(reply, buildJobId, 'index.html', request.query, request.headers.cookie);
  });

  app.get('/preview/:buildJobId/*', async (request, reply) => {
    const { buildJobId } = request.params as PreviewParams;
    const requestedPath = (request.params as PreviewParams)['*'] || 'index.html';
    return await sendPreviewFile(reply, buildJobId, requestedPath, request.query, request.headers.cookie);
  });
}

async function sendPreviewFile(
  reply: FastifyReply,
  buildJobId: string,
  requestedPath: string,
  query: unknown,
  cookieHeader?: string
) {
  const env = loadEnv();
  const token = extractPreviewToken(query, cookieHeader);
  applyPreviewSecurityHeaders(reply, env);

  if (!token || !verifyPreviewAccessToken({
    buildJobId,
    secret: env.PREVIEW_ACCESS_SECRET,
    token
  })) {
    return reply.code(403).send({
      error: 'Preview access denied'
    });
  }

  if (extractPreviewToken(query) === token) {
    reply.header(
      'set-cookie',
      `atoms_cp_preview_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/preview/${encodeURIComponent(buildJobId)}`
    );
  }

  try {
    const filePath = safePreviewPath(env.PREVIEW_ROOT_DIR, buildJobId, requestedPath);
    const content = await readFile(filePath);
    return reply.type(contentType(filePath)).send(content);
  } catch {
    if (!requestedPath.includes('.') && requestedPath !== 'index.html') {
      try {
        const fallbackPath = safePreviewPath(env.PREVIEW_ROOT_DIR, buildJobId, 'index.html');
        const fallbackContent = await readFile(fallbackPath);
        return reply.type(contentType(fallbackPath)).send(fallbackContent);
      } catch {
        return reply.code(404).send({
          error: 'Preview file not found'
        });
      }
    }

    return reply.code(404).send({
      error: 'Preview file not found'
    });
  }
}

function applyPreviewSecurityHeaders(reply: FastifyReply, env: ReturnType<typeof loadEnv>): void {
  const frameAncestorOrigins = [
    "'self'",
    env.PUBLIC_WEB_ORIGIN,
    env.E2E_WEB_ORIGIN
  ].filter((origin): origin is string => Boolean(origin));

  reply
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .header(
      'content-security-policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        `frame-ancestors ${[...new Set(frameAncestorOrigins)].join(' ')}`
      ].join('; ')
    );
}

function extractPreviewToken(query: unknown, cookieHeader?: string): string | undefined {
  if (!query || typeof query !== 'object') {
    return extractPreviewTokenCookie(cookieHeader);
  }

  const token = (query as { token?: unknown }).token;
  return typeof token === 'string' ? token : extractPreviewTokenCookie(cookieHeader);
}

function extractPreviewTokenCookie(cookieHeader?: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name === 'atoms_cp_preview_token') {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return undefined;
}

function safePreviewPath(previewRoot: string, buildJobId: string, requestedPath: string): string {
  const normalizedBuildJobId = normalize(buildJobId);
  const normalizedRequestedPath = normalize(requestedPath || 'index.html');

  if (
    normalizedBuildJobId.startsWith('..') ||
    normalizedBuildJobId.includes('/') ||
    normalizedRequestedPath.startsWith('..') ||
    normalizedRequestedPath.startsWith('/')
  ) {
    throw new Error('Unsafe preview path');
  }

  const root = resolve(previewRoot);
  const target = resolve(join(root, normalizedBuildJobId, normalizedRequestedPath));

  if (!target.startsWith(root)) {
    throw new Error('Unsafe preview path');
  }

  return target;
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}
