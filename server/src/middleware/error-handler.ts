import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { env } from '../env';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error('Unhandled error:', err);

  const statusCode = 'status' in err ? (err as { status: number }).status : 500;
  const message =
    env.NODE_ENV === 'development'
      ? err.message
      : statusCode >= 500
        ? 'Internal server error'
        : err.message;

  return c.json({ error: message }, statusCode as ContentfulStatusCode);
};
