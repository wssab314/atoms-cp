import { z } from 'zod';

export const publishChecklistItemIdSchema = z.enum([
  'build',
  'github',
  'env',
  'supabase',
  'vercel'
]);

export type PublishChecklistItemId = z.infer<typeof publishChecklistItemIdSchema>;

export const publishChecklistStatusSchema = z.enum(['passed', 'pending', 'blocked']);

export type PublishChecklistStatus = z.infer<typeof publishChecklistStatusSchema>;

export const publishChecklistItemSchema = z.object({
  id: publishChecklistItemIdSchema,
  label: z.string().min(1),
  status: publishChecklistStatusSchema,
  detail: z.string().min(1)
});

export type PublishChecklistItem = z.infer<typeof publishChecklistItemSchema>;

export const projectPublishStateSchema = z.object({
  projectId: z.string().min(1),
  currentVersionId: z.string().min(1).optional(),
  activePreviewSnapshotId: z.string().min(1).optional(),
  canPublish: z.boolean().default(false),
  blockingReasons: z.array(z.string().min(1)).default([]),
  deploymentUrl: z.string().url().optional(),
  githubRepoFullName: z.string().min(1).optional(),
  githubCommitSha: z.string().regex(/^[0-9a-f]{7,40}$/i).optional(),
  manualVercelImportUrl: z.string().url().optional(),
  checklist: z.array(publishChecklistItemSchema).min(1)
});

export type ProjectPublishState = z.infer<typeof projectPublishStateSchema>;

export const updateProjectDeploymentInputSchema = z.object({
  deploymentUrl: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  }, 'Deployment URL must use http or https')
});

export type UpdateProjectDeploymentInput = z.infer<typeof updateProjectDeploymentInputSchema>;
