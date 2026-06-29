import { z } from 'zod';
import { appSpecSchema } from './appSpec.js';
import { designProfileSchema } from './design.js';

function isSafeArtifactPath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0') && !value.includes('/../') && !value.endsWith('/..');
}

export const workspaceStatusSchema = z.enum(['creating', 'ready', 'locked', 'archived', 'failed']);

export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

export const workspaceRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  projectVersionId: z.string().min(1).optional(),
  path: z.string().min(1).refine(isSafeArtifactPath, 'Workspace path must be an absolute safe path'),
  status: workspaceStatusSchema,
  lockedBy: z.string().min(1).optional(),
  errorSummary: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

export const codexTaskTypeSchema = z.enum(['initial_generate', 'selector_patch', 'qa_fix', 'code_edit', 'rollback', 'repair']);

export type CodexTaskType = z.infer<typeof codexTaskTypeSchema>;

export const codexTaskStatusSchema = z.enum([
  'queued',
  'claimed',
  'preparing_workspace',
  'codex_running',
  'validating',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]);

export type CodexTaskStatus = z.infer<typeof codexTaskStatusSchema>;

export const dependencyPolicySchema = z.enum(['forbid_new_dependencies', 'allow_package_json_with_review']);

export type DependencyPolicy = z.infer<typeof dependencyPolicySchema>;

export const codexTaskTargetChangeSchema = z.object({
  type: codexTaskTypeSchema,
  summary: z.string().min(1),
  affectedAiIds: z.array(z.string().min(1)).optional()
}).strict();

export type CodexTaskTargetChange = z.infer<typeof codexTaskTargetChangeSchema>;

export const codexTaskSpecSchema = z.object({
  goal: z.string().min(1),
  appSpec: appSpecSchema,
  designProfile: designProfileSchema,
  targetChange: codexTaskTargetChangeSchema,
  allowedPaths: z.array(z.string().min(1)).min(1),
  forbiddenPaths: z.array(z.string().min(1)).default([]),
  dependencyPolicy: dependencyPolicySchema.default('forbid_new_dependencies'),
  validationCommands: z.array(z.string().min(1)).min(1),
  expectedOutputs: z.array(z.string().min(1)).min(1)
}).strict();

export type CodexTaskSpec = z.infer<typeof codexTaskSpecSchema>;

export const codexTaskRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  projectVersionId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  taskType: codexTaskTypeSchema,
  status: codexTaskStatusSchema,
  objective: z.string().min(1),
  inputSummary: z.string().min(1),
  taskSpec: codexTaskSpecSchema.optional(),
  allowedPaths: z.array(z.string().min(1)).min(1),
  forbiddenPaths: z.array(z.string().min(1)).default([]),
  validationCommands: z.array(z.string().min(1)).min(1),
  attemptCount: z.number().int().nonnegative().default(0),
  claimedBy: z.string().min(1).optional(),
  claimedAt: z.string().optional(),
  resultSummary: z.string().optional(),
  errorSummary: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional()
});

export type CodexTaskRecord = z.infer<typeof codexTaskRecordSchema>;

export const previewSnapshotStatusSchema = z.enum(['creating', 'ready', 'failed', 'archived']);

export type PreviewSnapshotStatus = z.infer<typeof previewSnapshotStatusSchema>;

export const previewSnapshotRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  projectVersionId: z.string().min(1),
  buildJobId: z.string().min(1).optional(),
  status: previewSnapshotStatusSchema,
  path: z.string().min(1).refine(isSafeArtifactPath, 'Preview path must be an absolute safe path'),
  url: z.string().url(),
  active: z.boolean().default(false),
  errorSummary: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type PreviewSnapshotRecord = z.infer<typeof previewSnapshotRecordSchema>;

export const traceEventTypeSchema = z.enum([
  'agent_started',
  'agent_completed',
  'codex_task_created',
  'codex_task_progress',
  'codex_task_claimed',
  'codex_task_completed',
  'workspace_created',
  'workspace_locked',
  'workspace_copied',
  'selector_patch_created',
  'patch_applied',
  'build_queued',
  'patch_failed',
  'preview_snapshot_created',
  'preview_snapshot_activated',
  'version_rollback_created',
  'build_started',
  'build_completed',
  'error'
]);

export type TraceEventType = z.infer<typeof traceEventTypeSchema>;

export const traceEventVisibilitySchema = z.enum(['user', 'admin']);

export type TraceEventVisibility = z.infer<typeof traceEventVisibilitySchema>;

export const traceEventRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  agentRunId: z.string().min(1).optional(),
  codexTaskId: z.string().min(1).optional(),
  buildJobId: z.string().min(1).optional(),
  type: traceEventTypeSchema,
  visibility: traceEventVisibilitySchema,
  message: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string()
});

export type TraceEventRecord = z.infer<typeof traceEventRecordSchema>;

export const previewSnapshotActivationResultSchema = z.object({
  previewSnapshot: previewSnapshotRecordSchema,
  traceEvent: traceEventRecordSchema
});

export type PreviewSnapshotActivationResult = z.infer<typeof previewSnapshotActivationResultSchema>;

export const agentMessageStatusSchema = z.enum(['received', 'deferred', 'processing', 'completed', 'failed']);

export type AgentMessageStatus = z.infer<typeof agentMessageStatusSchema>;

export const agentMessageRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  userId: z.string().min(1),
  content: z.string().min(1),
  status: agentMessageStatusSchema,
  relatedTaskId: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type AgentMessageRecord = z.infer<typeof agentMessageRecordSchema>;
