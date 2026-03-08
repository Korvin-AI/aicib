import { randomBytes } from 'node:crypto';

/** Generate a cryptographically secure 64-character hex session token. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}
