import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnv } from './config/env.js';
import { hashPassword, normalizeAuthEmail, validateLocalAuthInput } from './modules/auth/localAuth.js';
import { createInMemoryStore } from './modules/data/inMemoryStore.js';
import { createMigratedPostgresPoolStore } from './modules/data/postgresStore.js';
import type { UserProfile } from '@atoms-cp/shared';

interface SeedUserArgs {
  email: string;
  role: UserProfile['role'];
  name?: string;
  password?: string;
  passwordFile?: string;
}

export function parseSeedUserArgs(argv: string[]): SeedUserArgs {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index] ?? '';

    if (!item.startsWith('--')) {
      continue;
    }

    const key = item.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args.set(key, value);
    index += 1;
  }

  const email = args.get('email');

  if (!email) {
    throw new Error('Missing required --email');
  }

  const role = args.get('role') ?? 'creator';

  if (role !== 'creator' && role !== 'admin') {
    throw new Error('--role must be creator or admin');
  }

  const password = args.get('password');
  const passwordFile = args.get('password-file');

  if (password && passwordFile) {
    throw new Error('Use either --password or --password-file, not both');
  }

  return {
    email: normalizeAuthEmail(email),
    role,
    name: args.get('name'),
    password,
    passwordFile
  };
}

async function resolvePassword(args: SeedUserArgs): Promise<{ password: string; generated: boolean }> {
  if (args.password) {
    return { password: args.password, generated: false };
  }

  if (args.passwordFile) {
    const password = (await readFile(args.passwordFile, 'utf8')).trim();
    return { password, generated: false };
  }

  return {
    password: randomBytes(18).toString('base64url'),
    generated: true
  };
}

async function main(): Promise<void> {
  const args = parseSeedUserArgs(process.argv.slice(2));
  const env = loadEnv();
  const passwordResult = await resolvePassword(args);
  const parsed = validateLocalAuthInput({
    email: args.email,
    password: passwordResult.password,
    name: args.name
  });
  const store = env.DATA_STORE === 'postgres'
    ? await createMigratedPostgresPoolStore(env.DATABASE_URL, env.DATABASE_SCHEMA)
    : createInMemoryStore();

  try {
    const user = await store.upsertLocalAuthUser({
      email: parsed.email,
      name: parsed.name,
      role: args.role,
      passwordHash: await hashPassword(parsed.password)
    });

    process.stdout.write(`Seeded user ${user.email} with role ${user.role}\n`);

    if (passwordResult.generated) {
      process.stdout.write(`Generated password: ${passwordResult.password}\n`);
    }
  } finally {
    await store.close?.();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Failed to seed user'}\n`);
    process.exitCode = 1;
  });
}
