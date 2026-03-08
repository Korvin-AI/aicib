export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED';

export class AppError extends Error {
  status: number;
  code: ErrorCode;
  details?: unknown;

  constructor(message: string, status: number, code: ErrorCode, details?: unknown) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details?: unknown) {
  return new AppError(message, 400, 'VALIDATION_ERROR', details);
}

export function notFoundError(message = 'Not found') {
  return new AppError(message, 404, 'NOT_FOUND');
}

export function conflictError(message: string) {
  return new AppError(message, 409, 'CONFLICT');
}

export function rateLimitedError(message = 'Rate limit exceeded') {
  return new AppError(message, 429, 'RATE_LIMITED');
}

export function notImplementedError(message: string) {
  return new AppError(message, 501, 'NOT_IMPLEMENTED');
}
