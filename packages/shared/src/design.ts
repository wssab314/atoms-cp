import { z } from 'zod';

export const designTokenColorsSchema = z.object({
  background: z.string().min(1),
  foreground: z.string().min(1),
  primary: z.string().min(1),
  secondary: z.string().min(1),
  muted: z.string().min(1),
  border: z.string().min(1),
  accent: z.string().min(1)
});

export type DesignTokenColors = z.infer<typeof designTokenColorsSchema>;

export const designProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  bestFor: z.string().min(1),
  designTokens: z.object({
    colors: designTokenColorsSchema,
    typography: z.object({
      headingFont: z.string().min(1),
      bodyFont: z.string().min(1),
      scale: z.enum(['compact', 'comfortable', 'spacious'])
    }),
    radius: z.enum(['none', 'sm', 'md', 'lg', 'xl']),
    shadow: z.enum(['none', 'subtle', 'medium']),
    density: z.enum(['compact', 'balanced', 'airy'])
  }),
  layoutGuidelines: z.array(z.string().min(1)).min(1),
  componentGuidelines: z.array(z.string().min(1)).min(1),
  previewDescription: z.string().min(1)
});

export type DesignProfile = z.infer<typeof designProfileSchema>;

export const designAgentOutputSchema = z.object({
  profiles: z.array(designProfileSchema).min(1).max(5)
});

export type DesignAgentOutput = z.infer<typeof designAgentOutputSchema>;

export const designProfileRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  specVersionId: z.string().min(1),
  version: z.number().int().positive(),
  profile: designProfileSchema,
  selected: z.boolean().default(false),
  createdAt: z.string()
});

export type DesignProfileRecord = z.infer<typeof designProfileRecordSchema>;
