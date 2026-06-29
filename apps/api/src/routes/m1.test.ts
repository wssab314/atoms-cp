import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../server.js';

async function withApp<T>(run: Awaited<ReturnType<typeof createServer>>, callback: (app: Awaited<ReturnType<typeof createServer>>) => Promise<T>) {
  try {
    return await callback(run);
  } finally {
    await run.close();
  }
}

describe('M1 API routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires authentication for the current user by default', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/auth/me'
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: 'Authentication required'
      });
    });
  });

  it('supports local email/password register, session lookup, and logout', async () => {
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-local-auth-session-secret-32');
    const app = await createServer();

    await withApp(app, async (server) => {
      const unauthenticated = await server.inject({
        method: 'GET',
        url: '/api/auth/me'
      });
      expect(unauthenticated.statusCode).toBe(401);

      const registered = await server.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'Creator+R92@Example.com',
          password: 'correct horse battery staple',
          name: 'R9.2 Creator'
        }
      });
      expect(registered.statusCode).toBe(201);
      expect(registered.json()).toMatchObject({
        email: 'creator+r92@example.com',
        name: 'R9.2 Creator',
        role: 'creator'
      });
      const cookie = registered.headers['set-cookie'];
      expect(String(cookie)).toContain('atoms_cp_session=');
      expect(String(cookie)).toContain('HttpOnly');

      const me = await server.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          cookie: Array.isArray(cookie) ? cookie[0] : String(cookie)
        }
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        email: 'creator+r92@example.com'
      });

      const invalidLogin = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'creator+r92@example.com',
          password: 'wrong-password'
        }
      });
      expect(invalidLogin.statusCode).toBe(401);

      const logout = await server.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie: Array.isArray(cookie) ? cookie[0] : String(cookie)
        }
      });
      expect(logout.statusCode).toBe(204);
    });
  });

  it('can disable public local registration while keeping login and auth settings available', async () => {
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-local-auth-session-secret-32');
    vi.stubEnv('LOCAL_AUTH_REGISTRATION_ENABLED', 'false');
    const app = await createServer();

    await withApp(app, async (server) => {
      const settings = await server.inject({
        method: 'GET',
        url: '/api/auth/settings'
      });
      expect(settings.statusCode).toBe(200);
      expect(settings.json()).toEqual({
        registrationEnabled: false
      });

      const registered = await server.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'blocked@example.com',
          password: 'correct horse battery staple'
        }
      });
      expect(registered.statusCode).toBe(404);
      expect(registered.json()).toMatchObject({
        error: 'Local registration is disabled'
      });

      const login = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'blocked@example.com',
          password: 'correct horse battery staple'
        }
      });
      expect(login.statusCode).toBe(401);
    });
  });

  it('assigns local auth admin role only to configured bootstrap emails', async () => {
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-local-auth-session-secret-32');
    vi.stubEnv('ADMIN_BOOTSTRAP_EMAILS', 'ops@example.com');
    const app = await createServer();

    await withApp(app, async (server) => {
      const registered = await server.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'ops@example.com',
          password: 'correct horse battery staple',
          name: 'Ops'
        }
      });

      expect(registered.statusCode).toBe(201);
      expect(registered.json()).toMatchObject({
        email: 'ops@example.com',
        role: 'admin'
      });
    });
  });

  it('lists and creates projects for the current user', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const listBefore = await server.inject({
        method: 'GET',
        url: '/api/projects'
      });
      expect(listBefore.statusCode).toBe(200);
      expect(listBefore.json()).toHaveLength(2);

      const created = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'M1 API 项目',
          prompt: '生成一个可以查看课程、提交预约、并由管理员处理预约的 Web 应用。'
        }
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        name: 'M1 API 项目',
        status: 'draft',
        target: 'web'
      });

      const detail = await server.inject({
        method: 'GET',
        url: `/api/projects/${created.json().id}`
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        id: created.json().id,
        prompt: '生成一个可以查看课程、提交预约、并由管理员处理预约的 Web 应用。'
      });
    });
  });

  it('rejects invalid project creation input', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: '',
          prompt: ''
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'Invalid project input'
      });
    });
  });

  it('requires admin role for admin overview', async () => {
    const app = await createServer();

    await withApp(app, async (server) => {
      const forbidden = await server.inject({
        method: 'GET',
        url: '/api/admin/overview'
      });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await server.inject({
        method: 'GET',
        url: '/api/admin/overview',
        headers: {
          'x-user-email': 'admin@example.local',
          'x-user-role': 'admin'
        }
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({
        usersCount: 2,
        projectsCount: 2,
        dataSource: 'memory',
        modelProvider: 'volcengine',
        modelBudgetCny: 25
      });
    });
  });

  it('rejects forged admin role headers outside local development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PUBLIC_WEB_ORIGIN', 'https://atoms.example.com');
    vi.stubEnv('PUBLIC_API_ORIGIN', 'https://atoms-api.example.com');
    vi.stubEnv('ALLOWED_CORS_ORIGINS', 'https://atoms.example.com');
    vi.stubEnv('GITHUB_TOKEN_ENCRYPTION_KEY', 'test-prod-github-token-key-32-chars');
    vi.stubEnv('CONNECTOR_TOKEN_ENCRYPTION_KEY', 'test-prod-connector-key-32-chars');
    vi.stubEnv('PREVIEW_ACCESS_SECRET', 'test-prod-preview-secret-32-chars');
    const app = await createServer();

    await withApp(app, async (server) => {
      const forbidden = await server.inject({
        method: 'GET',
        url: '/api/admin/overview',
        headers: {
          'x-user-email': 'creator@example.local',
          'x-user-role': 'admin'
        }
      });
      expect(forbidden.statusCode).toBe(401);

      const bootstrapAdmin = await server.inject({
        method: 'GET',
        url: '/api/admin/overview',
        headers: {
          'x-user-email': 'admin@example.local'
        }
      });
      expect(bootstrapAdmin.statusCode).toBe(401);
    });
  });
});
