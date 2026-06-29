import type { ApiEnv } from '../../config/env.js';
import type { AppStore } from '../data/appStore.js';
import { decryptToken } from './tokenVault.js';

export function isGitHubOAuthConfigured(env: ApiEnv): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export function normalizeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/app/new';
  }

  return value;
}

export function buildGitHubAuthorizationUrl(input: {
  env: ApiEnv;
  state: string;
}): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', input.env.GITHUB_CLIENT_ID ?? '');
  url.searchParams.set('scope', 'repo user:email');
  url.searchParams.set('state', input.state);

  if (input.env.GITHUB_REDIRECT_URI) {
    url.searchParams.set('redirect_uri', input.env.GITHUB_REDIRECT_URI);
  }

  return url.toString();
}

export async function getGitHubAccessTokenForUser(input: {
  store: AppStore;
  userId: string;
  env: ApiEnv;
}): Promise<string | undefined> {
  const account = await input.store.getConnectorAccount(input.userId, 'github');

  if (account) {
    return decryptToken(account.tokenEncrypted, input.env.GITHUB_TOKEN_ENCRYPTION_KEY);
  }

  return input.env.GITHUB_TOKEN?.trim() || undefined;
}
