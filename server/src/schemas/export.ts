import { z } from 'zod';

export const exportQuerySchema = z.object({
  mode: z.enum(['full', 'selective', 'anonymized']).default('full'),
  categories: z.string().optional(), // comma-separated
});
