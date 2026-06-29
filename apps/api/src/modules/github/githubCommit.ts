import {
  githubCommitPlanSchema,
  type GitHubCommitPlan,
  type GitHubCommitRequest
} from '@atoms-cp/shared';

export interface GitHubCommitSourceFile {
  path: string;
  content: string;
  contentHash: string;
}

export function createGitHubCommitPlan(input: {
  projectId: string;
  files: GitHubCommitSourceFile[];
  request: GitHubCommitRequest;
}): GitHubCommitPlan {
  return githubCommitPlanSchema.parse({
    projectId: input.projectId,
    repoFullName: input.request.repoFullName,
    branch: input.request.branch,
    message: input.request.message,
    projectVersionId: input.request.projectVersionId,
    requiresConfirmation: true,
    files: input.files.map((file) => ({
      path: file.path,
      sizeBytes: Buffer.byteLength(file.content, 'utf8'),
      contentHash: file.contentHash
    }))
  });
}
