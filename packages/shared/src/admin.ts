import { z } from 'zod';
import { agentRunSummarySchema, modelInvocationSummarySchema } from './agent.js';
import { modelProviderSchema } from './model.js';
import { projectSummarySchema } from './project.js';
import { codexTaskRecordSchema, previewSnapshotRecordSchema, traceEventRecordSchema } from './runtimeArtifacts.js';
import { userProfileSchema } from './user.js';

export const adminMetricSchema = z.object({
  label: z.string(),
  value: z.number(),
  tone: z.enum(['neutral', 'success', 'warning', 'danger']).default('neutral')
});

export type AdminMetric = z.infer<typeof adminMetricSchema>;

export const adminBuildJobStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'building',
  'success',
  'succeeded',
  'failed',
  'canceled',
  'cancelled'
]);

export type AdminBuildJobStatus = z.infer<typeof adminBuildJobStatusSchema>;

export const adminBuildJobSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  status: adminBuildJobStatusSchema,
  command: z.string().optional(),
  previewUrl: z.string().url().optional(),
  errorSummary: z.string().optional(),
  createdAt: z.string()
});

export type AdminBuildJob = z.infer<typeof adminBuildJobSchema>;

export const adminConnectorStatusSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['configured', 'not_configured', 'error', 'unavailable']),
  secretState: z.enum(['not_required', 'configured', 'missing']),
  detail: z.string(),
  projectsAffected: z.number().int().nonnegative().optional(),
  lastCheckStatus: z.enum(['passed', 'failed', 'blocked']).optional(),
  lastCheckedAt: z.string().optional()
});

export type AdminConnectorStatus = z.infer<typeof adminConnectorStatusSchema>;

export const adminSystemConfigEntrySchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  sensitive: z.boolean()
});

export type AdminSystemConfigEntry = z.infer<typeof adminSystemConfigEntrySchema>;

export const adminOverviewSchema = z.object({
  usersCount: z.number().int().nonnegative(),
  projectsCount: z.number().int().nonnegative(),
  buildJobsToday: z.number().int().nonnegative(),
  failedBuildsToday: z.number().int().nonnegative(),
  modelCallsToday: z.number().int().nonnegative(),
  estimatedSpendCny: z.number().nonnegative(),
  appSpecsCount: z.number().int().nonnegative().default(0),
  agentRunsCount: z.number().int().nonnegative().default(0),
  modelInvocationsCount: z.number().int().nonnegative().default(0),
  dataSource: z.enum(['memory', 'postgres']).default('memory'),
  modelProvider: modelProviderSchema.default('volcengine'),
  modelBudgetCny: z.number().nonnegative().optional(),
  recentAgentRuns: z.array(agentRunSummarySchema).default([]),
  recentModelInvocations: z.array(modelInvocationSummarySchema).default([])
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminRuntimeSummarySchema = z.object({
  activeCodexTasks: z.number().int().nonnegative(),
  failedCodexTasks: z.number().int().nonnegative(),
  activeBuildJobs: z.number().int().nonnegative(),
  failedBuildJobs: z.number().int().nonnegative(),
  readyPreviewSnapshots: z.number().int().nonnegative(),
  activePreviewSnapshots: z.number().int().nonnegative(),
  recoveredEvents: z.number().int().nonnegative(),
  lastFailureSummary: z.string().min(1).optional()
});

export type AdminRuntimeSummary = z.infer<typeof adminRuntimeSummarySchema>;

export const adminOperationsSchema = z.object({
  dataSource: z.enum(['memory', 'postgres']).default('memory'),
  users: z.array(userProfileSchema),
  projects: z.array(projectSummarySchema),
  buildJobs: z.array(adminBuildJobSchema),
  agentRuns: z.array(agentRunSummarySchema),
  modelInvocations: z.array(modelInvocationSummarySchema),
  codexTasks: z.array(codexTaskRecordSchema).default([]),
  previewSnapshots: z.array(previewSnapshotRecordSchema).default([]),
  traceEvents: z.array(traceEventRecordSchema).default([]),
  runtimeSummary: adminRuntimeSummarySchema,
  connectors: z.array(adminConnectorStatusSchema),
  systemConfig: z.array(adminSystemConfigEntrySchema),
  modelUsage: z.object({
    provider: modelProviderSchema,
    budgetCny: z.number().nonnegative().optional(),
    estimatedSpendCny: z.number().nonnegative(),
    modelCallsToday: z.number().int().nonnegative(),
    invocationsCount: z.number().int().nonnegative()
  })
});

export type AdminOperations = z.infer<typeof adminOperationsSchema>;
