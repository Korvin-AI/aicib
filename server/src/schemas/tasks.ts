import { z } from 'zod';

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(1000).optional(),
    description: z.string().max(10000).optional(),
    status: z.string().max(50).optional(),
    priority: z.string().max(50).optional(),
    assignee: z.string().max(100).nullable().optional(),
    reviewer: z.string().max(100).nullable().optional(),
    department: z.string().max(100).nullable().optional(),
    project: z.string().max(255).nullable().optional(),
    deadline: z.string().datetime().nullable().optional(),
    outputSummary: z.string().max(10000).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });
