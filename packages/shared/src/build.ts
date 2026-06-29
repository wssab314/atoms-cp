import { z } from 'zod';

export const buildJobStatusSchema = z.enum(['queued', 'running', 'success', 'failed', 'canceled']);

export type BuildJobStatus = z.infer<typeof buildJobStatusSchema>;

export const buildJobRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  projectVersionId: z.string().min(1).optional(),
  status: buildJobStatusSchema,
  command: z.string().optional(),
  previewUrl: z.string().url().optional(),
  errorSummary: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional()
});

export type BuildJobRecord = z.infer<typeof buildJobRecordSchema>;

export const buildLogStreamSchema = z.enum(['stdout', 'stderr', 'system']);

export type BuildLogStream = z.infer<typeof buildLogStreamSchema>;

export const buildLogRecordSchema = z.object({
  id: z.string().min(1),
  buildJobId: z.string().min(1),
  stream: buildLogStreamSchema,
  line: z.string(),
  createdAt: z.string()
});

export type BuildLogRecord = z.infer<typeof buildLogRecordSchema>;

export const createBuildJobInputSchema = z.object({
  projectVersionId: z.string().min(1).optional()
});

export type CreateBuildJobInput = z.infer<typeof createBuildJobInputSchema>;
