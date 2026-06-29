import { z } from 'zod';

export const projectTargetSchema = z.enum(['web', 'mini_program']);

export type ProjectTarget = z.infer<typeof projectTargetSchema>;

export const projectStatusSchema = z.enum([
  'draft',
  'spec_generating',
  'spec_ready',
  'design_generating',
  'design_ready',
  'code_generating',
  'building',
  'preview_ready',
  'build_failed',
  'deployed'
]);

export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: projectStatusSchema,
  target: projectTargetSchema.default('web'),
  deploymentUrl: z.string().url().optional(),
  githubRepoFullName: z.string().min(1).optional(),
  githubCommitSha: z.string().regex(/^[0-9a-f]{7,40}$/i).optional(),
  updatedAt: z.string()
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectDetailSchema = projectSummarySchema.extend({
  ownerId: z.string(),
  prompt: z.string(),
  createdAt: z.string()
});

export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(10).max(8000),
  target: projectTargetSchema.default('web')
});

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(10).max(8000).optional(),
  status: projectStatusSchema.optional(),
  target: projectTargetSchema.optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one project field is required'
});

export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
