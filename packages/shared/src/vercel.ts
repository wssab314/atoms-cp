import { z } from 'zod';

const vercelProjectIdOrNameSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Vercel project id or name must be a simple identifier');

export const vercelEnvCheckInputSchema = z.object({
  vercelProjectIdOrName: vercelProjectIdOrNameSchema
});

export type VercelEnvCheckInput = z.infer<typeof vercelEnvCheckInputSchema>;

export const vercelEnvCheckResultSchema = z.object({
  projectId: z.string().min(1),
  vercelProjectIdOrName: vercelProjectIdOrNameSchema,
  status: z.enum(['passed', 'failed', 'blocked']),
  target: z.enum(['production']).default('production'),
  requiredKeys: z.array(z.string().min(1)).min(1),
  missingKeys: z.array(z.string().min(1)).default([]),
  detail: z.string().min(1),
  httpStatus: z.number().int().positive().optional(),
  checkedAt: z.string()
});

export type VercelEnvCheckResult = z.infer<typeof vercelEnvCheckResultSchema>;
