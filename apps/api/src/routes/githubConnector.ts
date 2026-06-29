import type { FastifyInstance } from 'fastify';
import {
  createGitHubRepositoryInputSchema,
  githubConnectorStatusSchema,
  githubOAuthStartSchema,
  githubRepositorySchema
} from '@atoms-cp/shared';
import { loadEnv } from '../config/env.js';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';
import {
  buildGitHubAuthorizationUrl,
  getGitHubAccessTokenForUser,
  isGitHubOAuthConfigured,
  normalizeReturnTo
} from '../modules/github/githubConnector.js';
import type { GitHubApiClient } from '../modules/github/githubClient.js';
import { createGitHubApiClient } from '../modules/github/githubClient.js';
import { createGitHubOAuthState, verifyGitHubOAuthState } from '../modules/github/oauthState.js';
import { encryptToken } from '../modules/github/tokenVault.js';

export interface GitHubConnectorRouteOptions {
  githubClient?: GitHubApiClient;
}

function createClient(options: GitHubConnectorRouteOptions): GitHubApiClient {
  return options.githubClient ?? createGitHubApiClient(loadEnv());
}

export async function registerGitHubConnectorRoutes(
  app: FastifyInstance,
  store: AppStore,
  options: GitHubConnectorRouteOptions = {}
): Promise<void> {
  const githubClient = createClient(options);

  app.get('/api/connectors/github/status', async (request) => {
    const env = loadEnv();
    const user = resolveRequestUser(request);
    const account = await store.getConnectorAccount(user.id, 'github');

    return githubConnectorStatusSchema.parse({
      configured: isGitHubOAuthConfigured(env) || Boolean(env.GITHUB_TOKEN),
      connected: Boolean(account) || Boolean(env.GITHUB_TOKEN),
      externalUsername: account?.externalUsername,
      scopes: account?.scopes ?? []
    });
  });

  app.get('/api/connectors/github/oauth/start', async (request, reply) => {
    const env = loadEnv();

    if (!isGitHubOAuthConfigured(env)) {
      return reply.code(503).send({
        error: 'GitHub OAuth is not configured'
      });
    }

    const user = resolveRequestUser(request);
    const query = request.query as { returnTo?: string };
    const state = createGitHubOAuthState({
      userId: user.id,
      secret: env.GITHUB_TOKEN_ENCRYPTION_KEY,
      returnTo: normalizeReturnTo(query.returnTo)
    });

    return githubOAuthStartSchema.parse({
      authorizationUrl: buildGitHubAuthorizationUrl({
        env,
        state
      })
    });
  });

  app.get('/api/connectors/github/oauth/callback', async (request, reply) => {
    const env = loadEnv();
    const user = resolveRequestUser(request);
    const query = request.query as { code?: string; state?: string };

    if (!query.code || !query.state) {
      return reply.code(400).send({
        error: 'Missing GitHub OAuth callback parameters'
      });
    }

    const state = verifyGitHubOAuthState({
      state: query.state,
      userId: user.id,
      secret: env.GITHUB_TOKEN_ENCRYPTION_KEY
    });

    if (!state) {
      return reply.code(400).send({
        error: 'Invalid GitHub OAuth state'
      });
    }

    try {
      const token = await githubClient.exchangeCodeForToken(query.code);
      const viewer = await githubClient.getViewer(token.accessToken);
      await store.upsertConnectorAccount({
        userId: user.id,
        connector: 'github',
        externalUserId: viewer.id,
        externalUsername: viewer.login,
        scopes: token.scope,
        tokenEncrypted: encryptToken(token.accessToken, env.GITHUB_TOKEN_ENCRYPTION_KEY),
        metadata: {
          tokenType: token.tokenType
        }
      });

      const redirectTarget = new URL(normalizeReturnTo(state.returnTo), 'http://localhost');
      redirectTarget.searchParams.set('github', 'connected');

      return reply.redirect(redirectTarget.pathname + redirectTarget.search);
    } catch (error) {
      request.log.error({ error }, 'GitHub OAuth callback failed');
      return reply.code(502).send({
        error: 'GitHub OAuth callback failed'
      });
    }
  });

  app.get('/api/connectors/github/repos', async (request, reply) => {
    const env = loadEnv();
    const user = resolveRequestUser(request);
    const token = await getGitHubAccessTokenForUser({
      store,
      userId: user.id,
      env
    });

    if (!token) {
      return reply.code(401).send({
        error: 'GitHub is not connected'
      });
    }

    try {
      const repos = await githubClient.listRepositories(token);
      return repos.map((repo) => githubRepositorySchema.parse(repo));
    } catch (error) {
      request.log.error({ error }, 'GitHub repo list failed');
      return reply.code(502).send({
        error: 'GitHub repo list failed'
      });
    }
  });

  app.post('/api/connectors/github/repos', async (request, reply) => {
    const parsed = createGitHubRepositoryInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid GitHub repository input',
        details: parsed.error.flatten()
      });
    }

    const env = loadEnv();
    const user = resolveRequestUser(request);
    const token = await getGitHubAccessTokenForUser({
      store,
      userId: user.id,
      env
    });

    if (!token) {
      return reply.code(401).send({
        error: 'GitHub is not connected'
      });
    }

    try {
      const repo = await githubClient.createRepository(token, parsed.data);
      return reply.code(201).send(githubRepositorySchema.parse(repo));
    } catch (error) {
      request.log.error({ error }, 'GitHub repo create failed');
      return reply.code(502).send({
        error: 'GitHub repo create failed'
      });
    }
  });
}
