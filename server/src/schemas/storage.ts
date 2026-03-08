import { z } from 'zod';

export const listStorageSchema = z.object({
  category: z.enum(['deliverable', 'export', 'upload']).optional(),
  jobId: z.coerce.number().optional(),
});
