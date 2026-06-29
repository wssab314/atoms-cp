import { scrypt as scryptCallback, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserProfile } from '@atoms-cp/shared';
import type { ApiEnv } from '../../config/env.js';
import type { AppStore } from '../data/appStore.js';

const scrypt = promisify(scryptCallback);
export const authSessionCookieName = 'atoms_cp_session';

export interface LocalAuthCredentials {
  email: string;
  password: string;
  name?: string;
}

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateLocalAuthInput(input: LocalAuthCredentials): { email: string; password: string; name: string } {
  const email = normalizeAuthEmail(input.email);
  const password = input.password;
  const name = input.name?.trim() || email.split('@')[0] || 'Creator';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email');
  }

  if (password.length < 8 || password.length > 128) {
    throw new Error('Password must be 8-128 characters');
  }

  return { email, password, name: name.slice(0, 80) };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  const [algorithm, salt, hash] = storedHash.split('$');

  if (algorithm !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(cookieHeader: string | string[] | undefined): Record<string, string> {
  const source = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader ?? '';
  const cookies: Record<string, string> = {};

  for (const item of source.split(';')) {
    const [rawName, ...rawValueParts] = item.trim().split('=');

    if (!rawName || rawValueParts.length === 0) {
      continue;
    }

    cookies[rawName] = decodeURIComponent(rawValueParts.join('='));
  }

  return cookies;
}

function cookieMaxAgeSeconds(env: ApiEnv): number {
  return env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60;
}

function cookieAttributes(env: ApiEnv, maxAge: number): string {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    env.NODE_ENV === 'production' ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

export function readSessionToken(request: FastifyRequest): string | undefined {
  return parseCookies(request.headers.cookie)[authSessionCookieName];
}

export async function createLocalAuthSession(input: {
  store: AppStore;
  reply: FastifyReply;
  env: ApiEnv;
  user: UserProfile;
}): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + cookieMaxAgeSeconds(input.env) * 1000).toISOString();
  await input.store.createAuthSession({
    userId: input.user.id,
    tokenHash: hashSessionToken(token),
    expiresAt
  });
  input.reply.header(
    'set-cookie',
    `${authSessionCookieName}=${encodeURIComponent(token)}; ${cookieAttributes(input.env, cookieMaxAgeSeconds(input.env))}`
  );
}

export function clearLocalAuthSession(reply: FastifyReply, env: ApiEnv): void {
  reply.header(
    'set-cookie',
    `${authSessionCookieName}=; ${cookieAttributes(env, 0)}`
  );
}

export async function resolveLocalSessionUser(store: AppStore, request: FastifyRequest): Promise<UserProfile | undefined> {
  const token = readSessionToken(request);

  if (!token) {
    return undefined;
  }

  const session = await store.getAuthSession(hashSessionToken(token));
  return session?.user;
}

export function registerLocalAuthHook(app: FastifyInstance, store: AppStore, env: ApiEnv): void {
  app.addHook('preHandler', async (request, reply) => {
    const testAuthBypass = env.NODE_ENV === 'test' && process.env.AUTH_MODE !== 'local';

    if (env.AUTH_MODE !== 'local' || testAuthBypass) {
      return;
    }

    const path = request.url.split('?')[0] ?? '';
    const publicPath = path === '/api/auth/register'
      || path === '/api/auth/login'
      || path === '/api/health'
      || path.startsWith('/preview/')
      || path.startsWith('/api/internal/e2e/');

    if (publicPath) {
      return;
    }

    const user = await resolveLocalSessionUser(store, request);

    if (!user) {
      await reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    request.headers['x-user-email'] = user.email;
    request.headers['x-user-id'] = user.id;
    request.headers['x-user-role'] = user.role;
  });
}
