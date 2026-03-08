import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';

export function validateBody<T extends ZodSchema>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: result.error.issues.map((i) => i.message).join('; '),
          code: 'VALIDATION_ERROR' as const,
          details: result.error.issues,
        },
        400,
      );
    }
  });
}

export function validateQuery<T extends ZodSchema>(schema: T) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: result.error.issues.map((i) => i.message).join('; '),
          code: 'VALIDATION_ERROR' as const,
          details: result.error.issues,
        },
        400,
      );
    }
  });
}
