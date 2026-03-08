import { z } from 'zod';

export const updateProjectSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    status: z.string().max(50).optional(),
    originalBrief: z.string().max(10000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });
