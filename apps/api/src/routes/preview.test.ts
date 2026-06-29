import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewAccessToken } from '@atoms-cp/shared';
import { describe, expect, it } from 'vitest';
import { createServer } from '../server.js';

describe('preview routes', () => {
  it('requires a valid build-scoped preview token before serving files', async () => {
    const root = join(tmpdir(), `atoms-preview-route-${Date.now()}`);
    const originalPreviewRoot = process.env.PREVIEW_ROOT_DIR;
    const originalPreviewSecret = process.env.PREVIEW_ACCESS_SECRET;
    const buildJobId = 'build-token-route';
    const secret = 'preview-route-secret';

    await mkdir(join(root, buildJobId), { recursive: true });
    await mkdir(join(root, buildJobId, 'assets'), { recursive: true });
    await writeFile(join(root, buildJobId, 'index.html'), '<main>Preview token ok</main>', 'utf8');
    await writeFile(join(root, buildJobId, 'assets', 'index.js'), 'console.log("asset ok");', 'utf8');
    process.env.PREVIEW_ROOT_DIR = root;
    process.env.PREVIEW_ACCESS_SECRET = secret;

    const app = await createServer();

    try {
      const noToken = await app.inject({
        method: 'GET',
        url: `/preview/${buildJobId}/index.html`
      });
      expect(noToken.statusCode).toBe(403);

      const badToken = await app.inject({
        method: 'GET',
        url: `/preview/${buildJobId}/index.html?token=bad-token`
      });
      expect(badToken.statusCode).toBe(403);

      const token = createPreviewAccessToken({ buildJobId, secret });
      const ok = await app.inject({
        method: 'GET',
        url: `/preview/${buildJobId}/index.html?token=${token}`
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toContain('Preview token ok');
      expect(ok.headers['cache-control']).toBe('no-store');
      expect(ok.headers['content-security-policy']).toContain("default-src 'self'");
      expect(ok.headers['content-security-policy']).toContain("frame-ancestors 'self'");
      expect(ok.headers['x-content-type-options']).toBe('nosniff');
      expect(ok.headers['x-frame-options']).toBeUndefined();

      const setCookie = ok.headers['set-cookie'];
      expect(String(setCookie)).toContain('atoms_cp_preview_token=');

      const asset = await app.inject({
        method: 'GET',
        url: `/preview/${buildJobId}/assets/index.js`,
        headers: {
          cookie: Array.isArray(setCookie) ? setCookie[0] : String(setCookie)
        }
      });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toContain('asset ok');
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });

      if (originalPreviewRoot === undefined) {
        delete process.env.PREVIEW_ROOT_DIR;
      } else {
        process.env.PREVIEW_ROOT_DIR = originalPreviewRoot;
      }

      if (originalPreviewSecret === undefined) {
        delete process.env.PREVIEW_ACCESS_SECRET;
      } else {
        process.env.PREVIEW_ACCESS_SECRET = originalPreviewSecret;
      }
    }
  });
});
