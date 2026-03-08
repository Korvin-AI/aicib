import { z } from 'zod';

export const updateArticleSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    content: z.string().max(100000).optional(),
    section: z.string().max(255).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });
