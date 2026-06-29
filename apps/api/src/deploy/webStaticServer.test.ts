import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-web-static-test-'));
  roots.push(root);
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("ok");', 'utf8');
  return root;
}

async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP test server address.');
  }

  return `http://127.0.0.1:${address.port}`;
}

describe('web static server proxy', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('proxies API requests before SPA fallback so auth endpoints reach the API service', async () => {
    const rootDir = await makeRoot();
    const module = await import(new URL('../../../../scripts/web-static-server.mjs', import.meta.url).href) as {
      createWebStaticServer: (input: { rootDir: string; apiProxyOrigin?: string }) => ReturnType<typeof createServer>;
      shouldProxyRequest: (pathname: string) => boolean;
    };
    const upstreamRequests: Array<{ method?: string; url?: string; cookie?: string; body: string }> = [];
    const upstream = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        upstreamRequests.push({
          method: request.method,
          url: request.url,
          cookie: request.headers.cookie,
          body
        });
        response.statusCode = 201;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Set-Cookie', 'atoms_cp_session=test-session; Path=/; HttpOnly; SameSite=Lax');
        response.end(JSON.stringify({ ok: true }));
      });
    });
    const upstreamOrigin = await listen(upstream);
    const web = module.createWebStaticServer({
      rootDir,
      apiProxyOrigin: upstreamOrigin
    });
    const webOrigin = await listen(web);

    try {
      expect(module.shouldProxyRequest('/api/auth/register')).toBe(true);
      expect(module.shouldProxyRequest('/preview/snapshot-id/index.html')).toBe(true);
      expect(module.shouldProxyRequest('/app/project-id')).toBe(false);

      const response = await fetch(`${webOrigin}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'client-cookie=value'
        },
        body: JSON.stringify({ email: 'user@example.com' })
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get('set-cookie')).toContain('atoms_cp_session=');
      expect(upstreamRequests).toEqual([{
        method: 'POST',
        url: '/api/auth/register',
        cookie: 'client-cookie=value',
        body: JSON.stringify({ email: 'user@example.com' })
      }]);

      const routeFallback = await fetch(`${webOrigin}/app/project-id`);
      expect(routeFallback.status).toBe(200);
      expect(await routeFallback.text()).toContain('<div id="root"></div>');
    } finally {
      web.close();
      upstream.close();
    }
  });
});
