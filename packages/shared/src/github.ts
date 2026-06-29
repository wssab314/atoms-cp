import { z } from 'zod';

export const githubRepoFullNameSchema = z.string()
  .min(3)
  .max(120)
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .refine((value) => value.split('/').every((segment) =>
    segment !== '.'
    && segment !== '..'
    && !segment.startsWith('.')
    && !segment.endsWith('.')
  ));

export type GitHubRepoFullName = z.infer<typeof githubRepoFullNameSchema>;

export const githubBranchNameSchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((value) => !value.startsWith('/') && !value.endsWith('/') && !value.includes('..'));

export const githubCommitRequestSchema = z.object({
  repoFullName: githubRepoFullNameSchema,
  branch: githubBranchNameSchema.default('main'),
  message: z.string().trim().min(1).max(180),
  projectVersionId: z.string().min(1).optional(),
  confirmed: z.boolean().default(false)
});

export type GitHubCommitRequest = z.infer<typeof githubCommitRequestSchema>;

export const githubCommitFileSchema = z.object({
  path: z.string().min(1).max(260),
  sizeBytes: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/i)
});

export type GitHubCommitFile = z.infer<typeof githubCommitFileSchema>;

export const githubCommitPlanSchema = z.object({
  projectId: z.string().min(1),
  repoFullName: githubRepoFullNameSchema,
  branch: githubBranchNameSchema,
  message: z.string().min(1).max(180),
  projectVersionId: z.string().min(1).optional(),
  requiresConfirmation: z.literal(true),
  files: z.array(githubCommitFileSchema).min(1)
});

export type GitHubCommitPlan = z.infer<typeof githubCommitPlanSchema>;

export const githubCommitResultSchema = githubCommitPlanSchema.omit({
  requiresConfirmation: true
}).extend({
  provider: z.literal('github'),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
  filesCommitted: z.number().int().positive()
});

export type GitHubCommitResult = z.infer<typeof githubCommitResultSchema>;

export const githubConnectorStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  externalUsername: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).default([])
});

export type GitHubConnectorStatus = z.infer<typeof githubConnectorStatusSchema>;

export const githubRepositorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  fullName: githubRepoFullNameSchema,
  private: z.boolean(),
  defaultBranch: githubBranchNameSchema.default('main'),
  htmlUrl: z.string().url().optional()
});

export type GitHubRepository = z.infer<typeof githubRepositorySchema>;

export const createGitHubRepositoryInputSchema = z.object({
  name: z.string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.-]+$/)
    .refine((value) =>
      value !== '.'
      && value !== '..'
      && !value.startsWith('.')
      && !value.endsWith('.')
    ),
  private: z.boolean().default(true),
  description: z.string().trim().max(200).optional()
});

export type CreateGitHubRepositoryInput = z.infer<typeof createGitHubRepositoryInputSchema>;

export const githubOAuthStartSchema = z.object({
  authorizationUrl: z.string().url()
});

export type GitHubOAuthStart = z.infer<typeof githubOAuthStartSchema>;

export const connectorAccountSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  connector: z.enum(['github', 'supabase', 'vercel']),
  externalUserId: z.string().min(1).optional(),
  externalUsername: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).default([]),
  tokenEncrypted: z.string().min(1),
  refreshTokenEncrypted: z.string().min(1).optional(),
  expiresAt: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type ConnectorAccount = z.infer<typeof connectorAccountSchema>;
