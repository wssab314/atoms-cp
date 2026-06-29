import { z } from 'zod';
import { buildJobRecordSchema } from './build.js';
import { traceEventRecordSchema } from './runtimeArtifacts.js';

export const generatedFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  purpose: z.string().min(1)
});

export type GeneratedFile = z.infer<typeof generatedFileSchema>;

export const manifestEditableFieldSchema = z.enum(['text', 'className', 'styleTokens', 'props']);

export type ManifestEditableField = z.infer<typeof manifestEditableFieldSchema>;

export const manifestEntrySchema = z.object({
  aiId: z.string().min(1),
  file: z.string().min(1),
  component: z.string().min(1),
  elementType: z.string().min(1),
  editable: z.array(manifestEditableFieldSchema),
  requirementId: z.string().optional()
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export const aiManifestSchema = z.object({
  entries: z.record(manifestEntrySchema)
});

export type AiManifest = z.infer<typeof aiManifestSchema>;

export const inspectorElementSnapshotSchema = z.object({
  type: z.enum(['INSPECTOR_HOVER', 'INSPECTOR_SELECT']),
  aiId: z.string().min(1),
  tagName: z.string().min(1),
  text: z.string().max(500).optional(),
  className: z.string().max(500).optional()
}).strict();

export type InspectorElementSnapshot = z.infer<typeof inspectorElementSnapshotSchema>;

export const projectManifestResponseSchema = z.object({
  projectId: z.string().min(1),
  projectVersionId: z.string().min(1).optional(),
  manifest: aiManifestSchema,
  entries: z.array(manifestEntrySchema)
});

export type ProjectManifestResponse = z.infer<typeof projectManifestResponseSchema>;

export const codegenOutputSchema = z.object({
  summary: z.string().min(1),
  files: z.array(generatedFileSchema).min(1),
  manifest: aiManifestSchema,
  buildCommand: z.string().min(1),
  installCommand: z.string().min(1),
  warnings: z.array(z.string()).default([])
});

export type CodegenOutput = z.infer<typeof codegenOutputSchema>;

export const projectFileRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  contentHash: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type ProjectFileRecord = z.infer<typeof projectFileRecordSchema>;

export const projectVersionSourceSchema = z.enum([
  'initial_generate',
  'selector_edit',
  'code_edit',
  'agent_patch',
  'rollback',
  'deploy',
  'repair'
]);

export type ProjectVersionSource = z.infer<typeof projectVersionSourceSchema>;

export const projectVersionRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  version: z.number().int().positive(),
  source: projectVersionSourceSchema,
  summary: z.string().optional(),
  changedFiles: z.array(z.string().min(1)),
  specVersionId: z.string().optional(),
  designProfileId: z.string().optional(),
  workspacePath: z.string().optional(),
  parentVersionId: z.string().optional(),
  createdAt: z.string()
});

export type ProjectVersionRecord = z.infer<typeof projectVersionRecordSchema>;

export const projectVersionListResponseSchema = z.object({
  versions: z.array(projectVersionRecordSchema)
});

export type ProjectVersionListResponse = z.infer<typeof projectVersionListResponseSchema>;

export const projectVersionRollbackResultSchema = z.object({
  projectVersion: projectVersionRecordSchema,
  buildJob: buildJobRecordSchema,
  traceEvent: traceEventRecordSchema
});

export type ProjectVersionRollbackResult = z.infer<typeof projectVersionRollbackResultSchema>;

export const codegenReactViteInputSchema = z.object({
  designId: z.string().min(1).optional()
});

export type CodegenReactViteInput = z.infer<typeof codegenReactViteInputSchema>;

export const directTextPatchInputSchema = z.object({
  aiId: z.string().min(1),
  text: z.string().min(1).max(120)
});

export type DirectTextPatchInput = z.infer<typeof directTextPatchInputSchema>;

export const aiSelectorPatchInputSchema = z.object({
  aiId: z.string().min(1),
  instruction: z.string().min(1).max(280),
  selectedText: z.string().max(200).optional()
});

export type AiSelectorPatchInput = z.infer<typeof aiSelectorPatchInputSchema>;

export const aiSelectorPatchPlanSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('replace_text'),
    text: z.string().min(1).max(120)
  }),
  z.object({
    operation: z.literal('update_style'),
    instruction: z.string().min(1).max(280)
  }),
  z.object({
    operation: z.literal('update_props'),
    instruction: z.string().min(1).max(280)
  })
]);

export type AiSelectorPatchPlan = z.infer<typeof aiSelectorPatchPlanSchema>;
