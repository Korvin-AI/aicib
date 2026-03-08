import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../db/connection';
import { authSessions, apiKeys, orgMemberships } from '../db/schema/index';
import type { AuthContext } from '../types';

type AuthEnv = {
  Variables: {
    auth: AuthContext;
  };
};

function hashToken(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  // 1. Check Authorization header (API key)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const keyHash = hashToken(token);

    const [apiKey] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (apiKey) {
      // Check expiry
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        return c.json({ error: 'API key expired', code: 'UNAUTHORIZED' as const }, 401);
      }

      // Update last used
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, apiKey.id));

      // API keys are org-scoped power tokens — fixed admin role
      c.set('auth', {
        userId: null,
        orgId: apiKey.orgId,
        orgRole: 'admin',
      });
      return next();
    }
  }

  // 2. Check session cookie (hash before lookup)
  const sessionToken = getCookie(c, 'aicib_session');
  if (sessionToken) {
    const tokenHash = hashToken(sessionToken);
    const [session] = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.token, tokenHash))
      .limit(1);

    if (session && session.expiresAt > new Date()) {
      // Find the user's org membership
      const [membership] = await db
        .select()
        .from(orgMemberships)
        .where(eq(orgMemberships.userId, session.userId))
        .limit(1);

      if (membership) {
        c.set('auth', {
          userId: session.userId,
          orgId: membership.orgId,
          orgRole: membership.role,
        });
        return next();
      }
    }
  }

  return c.json({ error: 'Authentication required', code: 'UNAUTHORIZED' as const }, 401);
});
