import { z } from 'zod';

export const briefBodySchema = z.object({
  directive: z.string().min(1, 'Directive is required').max(10000, 'Directive too long'),
});
