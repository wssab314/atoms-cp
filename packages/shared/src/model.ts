import { z } from 'zod';

export const modelProviderSchema = z.enum(['deepseek', 'volcengine']);

export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const modelRuntimeConfigSchema = z.object({
  provider: modelProviderSchema,
  apiKeyConfigured: z.boolean(),
  baseUrl: z.string().url().optional(),
  model: z.string(),
  fallbackModel: z.string().optional(),
  budgetCny: z.number().positive().optional()
});

export type ModelRuntimeConfig = z.infer<typeof modelRuntimeConfigSchema>;

export const modelUsageRecordSchema = z.object({
  provider: modelProviderSchema,
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  estimatedCostCny: z.number().nonnegative().optional()
});

export type ModelUsageRecord = z.infer<typeof modelUsageRecordSchema>;
