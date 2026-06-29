import {
  createGitHubRepositoryInputSchema,
  githubRepositorySchema,
  type CreateGitHubRepositoryInput,
  type GitHubRepository,
  type ProjectFileRecord
} from '@atoms-cp/shared';
import type { ApiEnv } from '../../config/env.js';

export interface GitHubTokenResult {
  accessToken: string;
  scope: string[];
  tokenType: string;
}

export interface GitHubViewer {
  id: string;
  login: string;
}

export interface GitHubCommitFilesInput {
  repoFullName: string;
  branch: string;
  message: string;
  files: Array<Pick<ProjectFileRecord, 'path' | 'content'>>;
}

export interface GitHubCommitFilesResult {
  commitSha: string;
  filesCommitted: number;
}

export interface GitHubApiClient {
  exchangeCodeForToken(code: string): Promise<GitHubTokenResult>;
  getViewer(token: string): Promise<GitHubViewer>;
  listRepositories(token: string): Promise<GitHubRepository[]>;
  createRepository(token: string, input: CreateGitHubRepositoryInput): Promise<GitHubRepository>;
  commitFiles(token: string, input: GitHubCommitFilesInput): Promise<GitHubCommitFilesResult>;
}

interface GitHubRepositoryResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch?: string;
  html_url?: string;
}

interface GitHubUserResponse {
  id: number | string;
  login: string;
}

interface GitHubContentResponse {
  sha?: string;
}

interface GitHubPutContentResponse {
  commit?: {
    sha?: string;
  };
}

function mapRepository(repo: GitHubRepositoryResponse): GitHubRepository {
  return githubRepositorySchema.parse({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch ?? 'main',
    htmlUrl: repo.html_url
  });
}

function assertConfigured(env: ApiEnv): void {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new Error('GitHub OAuth is not configured');
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status}`);
  }

  return text ? JSON.parse(text) as T : {} as T;
}

function repositoryParts(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split('/');

  if (!owner || !repo) {
    throw new Error('Invalid GitHub repository full name');
  }

  return {
    owner,
    repo
  };
}

function encodePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

export function createGitHubApiClient(env: ApiEnv): GitHubApiClient {
  return {
    async exchangeCodeForToken(code) {
      assertConfigured(env);
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: env.GITHUB_REDIRECT_URI
        })
      });
      const body = await readJson<{
        access_token?: string;
        scope?: string;
        token_type?: string;
        error?: string;
      }>(response);

      if (!body.access_token || body.error) {
        throw new Error('GitHub OAuth token exchange failed');
      }

      return {
        accessToken: body.access_token,
        scope: body.scope ? body.scope.split(',').map((scope) => scope.trim()).filter(Boolean) : [],
        tokenType: body.token_type ?? 'bearer'
      };
    },

    async getViewer(token) {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28'
        }
      });
      const body = await readJson<GitHubUserResponse>(response);

      return {
        id: String(body.id),
        login: body.login
      };
    },

    async listRepositories(token) {
      const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28'
        }
      });
      const body = await readJson<GitHubRepositoryResponse[]>(response);
      return body.map(mapRepository);
    },

    async createRepository(token, input) {
      const parsed = createGitHubRepositoryInputSchema.parse(input);
      const response = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28'
        },
        body: JSON.stringify({
          name: parsed.name,
          private: parsed.private,
          description: parsed.description
        })
      });
      const body = await readJson<GitHubRepositoryResponse>(response);
      return mapRepository(body);
    },

    async commitFiles(token, input) {
      const { owner, repo } = repositoryParts(input.repoFullName);
      let lastCommitSha = '';
      let filesCommitted = 0;

      for (const file of input.files) {
        const encodedPath = encodePath(file.path);
        const existingResponse = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(input.branch)}`,
          {
            headers: {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${token}`,
              'x-github-api-version': '2022-11-28'
            }
          }
        );
        let existingSha: string | undefined;

        if (existingResponse.status !== 404) {
          const existing = await readJson<GitHubContentResponse>(existingResponse);
          existingSha = existing.sha;
        }

        const response = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
          {
            method: 'PUT',
            headers: {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
              'x-github-api-version': '2022-11-28'
            },
            body: JSON.stringify({
              message: `${input.message}: ${file.path}`,
              branch: input.branch,
              content: Buffer.from(file.content, 'utf8').toString('base64'),
              sha: existingSha
            })
          }
        );
        const body = await readJson<GitHubPutContentResponse>(response);
        lastCommitSha = body.commit?.sha ?? lastCommitSha;
        filesCommitted += 1;
      }

      if (!lastCommitSha) {
        throw new Error('GitHub file commit did not return a commit sha');
      }

      return {
        commitSha: lastCommitSha,
        filesCommitted
      };
    }
  };
}
