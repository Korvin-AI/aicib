import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { env } from '../env';
import { AppError } from '../utils/errors';
import { captureError } from '../monitoring/sentry';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      console.error('Server error:', err);
      captureError(err);
    }
    return c.json(
      {
        error: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
      err.status as ContentfulStatusCode,
    );
  }

  console.error('Unhandled error:', err);

  const statusCode = 'status' in err ? (err as { status: number }).status : 500;
  const message =
    env.NODE_ENV === 'development'
      ? err.message
      : statusCode >= 500
        ? 'Internal server error'
        : err.message;

  const code =
    statusCode === 404
      ? 'NOT_FOUND'
      : statusCode === 401
        ? 'UNAUTHORIZED'
        : statusCode === 403
          ? 'FORBIDDEN'
          : statusCode === 409
            ? 'CONFLICT'
            : statusCode === 429
              ? 'RATE_LIMITED'
              : statusCode >= 500
                ? 'INTERNAL_ERROR'
                : 'VALIDATION_ERROR';

  if (statusCode >= 500) {
    captureError(err instanceof Error ? err : new Error(String(err)));
  }

  return c.json({ error: message, code }, statusCode as ContentfulStatusCode);
};
