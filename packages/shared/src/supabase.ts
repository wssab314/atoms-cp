import { z } from 'zod';

const httpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'https:' || protocol === 'http:';
}, 'URL must use http or https');

const supabaseKeySchema = z.string().trim().min(8).max(3000);
const supabaseConnectionStatusSchema = z.enum(['passed', 'failed', 'blocked']);

export const supabaseConfigInputSchema = z.object({
  supabaseUrl: httpUrlSchema,
  anonKey: supabaseKeySchema,
  serviceRoleKey: supabaseKeySchema.optional()
});

export type SupabaseConfigInput = z.infer<typeof supabaseConfigInputSchema>;

export const supabaseProjectConfigSchema = z.object({
  projectId: z.string().min(1),
  configured: z.boolean(),
  supabaseUrl: httpUrlSchema.optional(),
  anonKeyConfigured: z.boolean(),
  anonKeyMasked: z.string().min(1).optional(),
  serviceRoleKeyConfigured: z.boolean(),
  envReady: z.boolean(),
  frontendEnvConfirmedAt: z.string().optional(),
  lastConnectionStatus: supabaseConnectionStatusSchema.optional(),
  lastConnectionDetail: z.string().min(1).optional(),
  lastConnectionHttpStatus: z.number().int().positive().optional(),
  lastConnectionCheckedAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export type SupabaseProjectConfig = z.infer<typeof supabaseProjectConfigSchema>;

export const supabaseConfigRecordSchema = z.object({
  projectId: z.string().min(1),
  supabaseUrl: httpUrlSchema,
  anonKey: supabaseKeySchema,
  serviceRoleKeyEncrypted: z.string().min(1).optional(),
  frontendEnvConfirmedAt: z.string().optional(),
  lastConnectionStatus: supabaseConnectionStatusSchema.optional(),
  lastConnectionDetail: z.string().min(1).optional(),
  lastConnectionHttpStatus: z.number().int().positive().optional(),
  lastConnectionCheckedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type SupabaseConfigRecord = z.infer<typeof supabaseConfigRecordSchema>;

export const supabaseSchemaSqlResponseSchema = z.object({
  projectId: z.string().min(1),
  tables: z.array(z.string().min(1)),
  sql: z.string().min(1),
  warnings: z.array(z.string()).default([])
});

export type SupabaseSchemaSqlResponse = z.infer<typeof supabaseSchemaSqlResponseSchema>;

export const supabaseConnectionTestResultSchema = z.object({
  projectId: z.string().min(1),
  status: supabaseConnectionStatusSchema,
  detail: z.string().min(1),
  httpStatus: z.number().int().positive().optional(),
  checkedAt: z.string()
});

export type SupabaseConnectionTestResult = z.infer<typeof supabaseConnectionTestResultSchema>;

export const supabaseFrontendEnvConfirmationInputSchema = z.object({
  confirmed: z.literal(true)
});

export type SupabaseFrontendEnvConfirmationInput = z.infer<typeof supabaseFrontendEnvConfirmationInputSchema>;
