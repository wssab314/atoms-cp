import { z } from 'zod';

export const appSpecSectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['hero', 'list', 'form', 'table', 'stats', 'content', 'navigation']),
  title: z.string().min(1),
  content: z.string().min(1)
});

export type AppSpecSection = z.infer<typeof appSpecSectionSchema>;

export const appSpecActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['navigate', 'submit', 'open_modal', 'filter', 'external_link'])
});

export type AppSpecAction = z.infer<typeof appSpecActionSchema>;

export const appSpecPageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  route: z.string().min(1).startsWith('/'),
  purpose: z.string().min(1),
  sections: z.array(appSpecSectionSchema).min(1),
  actions: z.array(appSpecActionSchema).default([])
});

export type AppSpecPage = z.infer<typeof appSpecPageSchema>;

export const appSpecDataModelFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'enum', 'relation']),
  required: z.boolean().default(false)
});

export type AppSpecDataModelField = z.infer<typeof appSpecDataModelFieldSchema>;

export const appSpecDataModelSchema = z.object({
  name: z.string().min(1),
  fields: z.array(appSpecDataModelFieldSchema).min(1)
});

export type AppSpecDataModel = z.infer<typeof appSpecDataModelSchema>;

export const appSpecSchema = z.object({
  appName: z.string().min(1).max(120),
  appGoal: z.string().min(1),
  targetUser: z.string().min(1),
  pages: z.array(appSpecPageSchema).min(1),
  dataModels: z.array(appSpecDataModelSchema).default([]),
  integrations: z.array(z.string().min(1)).default([]),
  styleIntent: z.object({
    tone: z.string().min(1),
    primaryColor: z.string().optional(),
    layoutDensity: z.enum(['compact', 'comfortable', 'spacious'])
  }),
  constraints: z.array(z.string().min(1)).default([]),
  nonGoals: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).min(1)
});

export type AppSpec = z.infer<typeof appSpecSchema>;

export const appSpecStatusSchema = z.enum(['draft', 'validating', 'validated', 'rejected', 'confirmed']);

export type AppSpecStatus = z.infer<typeof appSpecStatusSchema>;

export const appSpecRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sourceAgentRunId: z.string().min(1),
  version: z.number().int().positive(),
  status: appSpecStatusSchema,
  spec: appSpecSchema,
  validationErrors: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type AppSpecRecord = z.infer<typeof appSpecRecordSchema>;

export const updateAppSpecInputSchema = z.object({
  spec: appSpecSchema
});

export type UpdateAppSpecInput = z.infer<typeof updateAppSpecInputSchema>;

export const confirmAppSpecInputSchema = z.object({
  specId: z.string().min(1)
});

export type ConfirmAppSpecInput = z.infer<typeof confirmAppSpecInputSchema>;
