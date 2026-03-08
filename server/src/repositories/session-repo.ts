import { eq, lt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../db/connection';
import { authSessions } from '../db/schema/index';
import { generateSessionToken } from '../utils/token';

const SESSION_DURATION_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  ipAddress?: string,
  userAgent?: string,
) {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

  await db.insert(authSessions).values({
    token: tokenHash,
    userId,
    expiresAt,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });

  return { token, expiresAt }; // raw token returned ONCE
}

export async function deleteSession(token: string) {
  await db.delete(authSessions).where(eq(authSessions.token, hashToken(token)));
}

export async function cleanExpiredSessions() {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}
