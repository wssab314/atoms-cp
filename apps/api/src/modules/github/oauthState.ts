import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

interface OAuthStatePayload {
  userId: string;
  nonce: string;
  returnTo?: string;
  issuedAt: number;
}

const maxStateAgeMs = 10 * 60 * 1000;

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createGitHubOAuthState(input: {
  userId: string;
  secret: string;
  returnTo?: string;
  now?: number;
}): string {
  const payload = Buffer.from(JSON.stringify({
    userId: input.userId,
    nonce: randomBytes(16).toString('base64url'),
    returnTo: input.returnTo,
    issuedAt: input.now ?? Date.now()
  } satisfies OAuthStatePayload)).toString('base64url');

  return `${payload}.${signPayload(payload, input.secret)}`;
}

export function verifyGitHubOAuthState(input: {
  state: string;
  userId: string;
  secret: string;
  now?: number;
}): { returnTo?: string } | undefined {
  const [payload, signature] = input.state.split('.');

  if (!payload || !signature || !safeEqual(signature, signPayload(payload, input.secret))) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthStatePayload;
    const age = (input.now ?? Date.now()) - parsed.issuedAt;

    if (parsed.userId !== input.userId || age < 0 || age > maxStateAgeMs) {
      return undefined;
    }

    return {
      returnTo: parsed.returnTo
    };
  } catch {
    return undefined;
  }
}
