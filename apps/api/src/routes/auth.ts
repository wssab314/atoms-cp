import type { FastifyInstance } from 'fastify';
import type { AppStore } from '../modules/data/appStore.js';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import { loadEnv } from '../config/env.js';
import {
  clearLocalAuthSession,
  createLocalAuthSession,
  hashPassword,
  hashSessionToken,
  readSessionToken,
  resolveLocalSessionUser,
  validateLocalAuthInput,
  verifyPassword
} from '../modules/auth/localAuth.js';

function localAuthRoleForEmail(email: string, env: ReturnType<typeof loadEnv>): 'creator' | 'admin' {
  const bootstrapEmails = env.ADMIN_BOOTSTRAP_EMAILS?.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean) ?? [];

  if (bootstrapEmails.includes(email)) {
    return 'admin';
  }

  if (env.NODE_ENV !== 'production' && email === 'admin@example.local') {
    return 'admin';
  }

  return 'creator';
}

export async function registerAuthRoutes(app: FastifyInstance, store: AppStore): Promise<void> {
  app.get('/api/auth/me', async (request, reply) => {
    const env = loadEnv();

    if (env.AUTH_MODE === 'local') {
      const user = await resolveLocalSessionUser(store, request);

      if (!user) {
        return reply.code(401).send({
          error: 'Authentication required'
        });
      }

      return user;
    }

    const user = resolveRequestUser(request);
    return await store.ensureUser(user);
  });

  app.post('/api/auth/register', async (request, reply) => {
    const env = loadEnv();

    if (env.AUTH_MODE !== 'local') {
      return reply.code(404).send({ error: 'Local auth is disabled' });
    }

    try {
      const parsed = validateLocalAuthInput(request.body as { email: string; password: string; name?: string });
      const existing = await store.getLocalAuthUserByEmail(parsed.email);

      if (existing?.passwordHash) {
        return reply.code(409).send({ error: 'Email already registered' });
      }

      const user = await store.upsertLocalAuthUser({
        email: parsed.email,
        name: parsed.name,
        passwordHash: await hashPassword(parsed.password),
        role: localAuthRoleForEmail(parsed.email, env)
      });
      await createLocalAuthSession({ store, reply, env, user });
      return reply.code(201).send(user);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Invalid auth input'
      });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const env = loadEnv();

    if (env.AUTH_MODE !== 'local') {
      return reply.code(404).send({ error: 'Local auth is disabled' });
    }

    try {
      const parsed = validateLocalAuthInput(request.body as { email: string; password: string; name?: string });
      const record = await store.getLocalAuthUserByEmail(parsed.email);
      const passwordOk = await verifyPassword(parsed.password, record?.passwordHash);

      if (!record || !passwordOk) {
        return reply.code(401).send({ error: 'Invalid email or password' });
      }

      await createLocalAuthSession({ store, reply, env, user: record.user });
      return record.user;
    } catch {
      return reply.code(400).send({ error: 'Invalid auth input' });
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const env = loadEnv();

    if (env.AUTH_MODE !== 'local') {
      return reply.code(204).send();
    }

    const token = readSessionToken(request);

    if (token) {
      await store.deleteAuthSession(hashSessionToken(token));
    }

    clearLocalAuthSession(reply, env);
    return reply.code(204).send();
  });
}
