import { z } from 'zod';
import { modelProviderSchema } from './model.js';

export const agentPurposeSchema = z.enum(['app_spec_generation', 'app_spec_repair', 'design_direction', 'selector_patch']);

export type AgentPurpose = z.infer<typeof agentPurposeSchema>;

export const agentRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_model',
  'validating',
  'succeeded',
  'failed',
  'cancelled'
]);

export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentErrorTypeSchema = z.enum([
  'MODEL_TIMEOUT',
  'MODEL_RATE_LIMIT',
  'MODEL_AUTH_FAILED',
  'MODEL_BUDGET_EXCEEDED',
  'MODEL_INVALID_JSON',
  'SCHEMA_VALIDATION_FAILED',
  'INTERNAL_ERROR'
]);

export type AgentErrorType = z.infer<typeof agentErrorTypeSchema>;

export const agentRunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  purpose: agentPurposeSchema,
  provider: modelProviderSchema,
  status: agentRunStatusSchema,
  inputSnapshot: z.record(z.unknown()),
  outputSnapshot: z.record(z.unknown()).optional(),
  errorType: agentErrorTypeSchema.optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type AgentRun = z.infer<typeof agentRunSchema>;

export const modelInvocationStatusSchema = z.enum(['skipped', 'running', 'succeeded', 'failed']);

export type ModelInvocationStatus = z.infer<typeof modelInvocationStatusSchema>;

export const modelInvocationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  agentRunId: z.string().min(1),
  provider: modelProviderSchema,
  model: z.string().min(1),
  purpose: agentPurposeSchema,
  status: modelInvocationStatusSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  estimatedCostCny: z.number().nonnegative(),
  budgetLimitCny: z.number().nonnegative(),
  errorType: agentErrorTypeSchema.optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string()
});

export type ModelInvocation = z.infer<typeof modelInvocationSchema>;

export const agentRunSummarySchema = agentRunSchema.pick({
  id: true,
  projectId: true,
  purpose: true,
  provider: true,
  status: true,
  errorType: true,
  updatedAt: true
});

export type AgentRunSummary = z.infer<typeof agentRunSummarySchema>;

export const modelInvocationSummarySchema = modelInvocationSchema.pick({
  id: true,
  projectId: true,
  agentRunId: true,
  provider: true,
  model: true,
  purpose: true,
  status: true,
  estimatedCostCny: true,
  errorType: true,
  createdAt: true
});

export type ModelInvocationSummary = z.infer<typeof modelInvocationSummarySchema>;
