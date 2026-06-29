import type { FastifyRequest } from 'fastify';
import { userProfileSchema, userRoleSchema, type UserProfile, type UserRole } from '@atoms-cp/shared';
import { loadEnv, type ApiEnv } from '../../config/env.js';

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function userIdFromEmail(email: string): string {
  if (email === 'creator@example.local') {
    return 'user-creator';
  }

  if (email === 'admin@example.local') {
    return 'user-admin';
  }

  const slug = email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `user-${slug || 'anonymous'}`;
}

function readSafeUserId(value: string | string[] | undefined): string | undefined {
  const userId = readHeader(value)?.trim();

  if (!userId || userId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(userId)) {
    return undefined;
  }

  return userId;
}

function getBootstrapAdminEmails(env: ApiEnv): Set<string> {
  const emails = env.ADMIN_BOOTSTRAP_EMAILS?.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean) ?? [];

  return new Set(['admin@example.local', ...emails]);
}

export function resolveRequestUser(request: FastifyRequest, env: ApiEnv = loadEnv()): UserProfile {
  const email = readHeader(request.headers['x-user-email'])?.trim().toLowerCase() || 'creator@example.local';
  const userId = readSafeUserId(request.headers['x-user-id']) ?? userIdFromEmail(email);
  const roleHeader = readHeader(request.headers['x-user-role'])?.trim();
  const parsedRole = userRoleSchema.safeParse(roleHeader);
  const bootstrapAdmins = getBootstrapAdminEmails(env);
  const role: UserRole = resolveRole({
    email,
    headerRole: parsedRole.success ? parsedRole.data : undefined,
    bootstrapAdmins,
    nodeEnv: env.NODE_ENV,
    authMode: env.AUTH_MODE
  });

  return userProfileSchema.parse({
    id: userId,
    email,
    name: email === 'admin@example.local' ? 'Admin' : 'Creator',
    role
  });
}

export function isAdminUser(user: UserProfile): boolean {
  return user.role === 'admin';
}

function resolveRole(input: {
  email: string;
  headerRole: UserRole | undefined;
  bootstrapAdmins: Set<string>;
  nodeEnv: ApiEnv['NODE_ENV'];
  authMode: ApiEnv['AUTH_MODE'];
}): UserRole {
  if (input.authMode === 'local' && input.headerRole && input.nodeEnv !== 'production') {
    return input.headerRole;
  }

  if (input.nodeEnv === 'development' || input.nodeEnv === 'test') {
    return input.headerRole ?? (input.bootstrapAdmins.has(input.email) ? 'admin' : 'creator');
  }

  return input.bootstrapAdmins.has(input.email) ? 'admin' : 'creator';
}
