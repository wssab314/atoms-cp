import { z } from 'zod';

export const userRoleSchema = z.enum(['creator', 'admin']);

export type UserRole = z.infer<typeof userRoleSchema>;

export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().min(1),
  role: userRoleSchema
});

export type UserProfile = z.infer<typeof userProfileSchema>;
