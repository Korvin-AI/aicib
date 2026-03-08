import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { users, organizations, orgMemberships, authSessions } from '../db/schema/index';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateSessionToken } from '../utils/token';
import { createHash } from 'node:crypto';
import { findUserById, verifyUserPassword } from '../repositories/user-repo';
import { deleteSession } from '../repositories/session-repo';
import { findOrgByUserId } from '../repositories/org-repo';
import { findBusinessesByOrg } from '../repositories/business-repo';
import { authMiddleware } from '../middleware/auth';
import { env } from '../env';
import type { AuthContext } from '../types';

const auth = new Hono<{ Variables: { auth: AuthContext } }>();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SESSION_DURATION_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function setSessionCookie(c: Context, token: string, expiresAt: Date) {
  setCookie(c, 'aicib_session', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });
}

// POST /auth/signup — wrapped in a transaction
auth.post('/auth/signup', zValidator('json', signupSchema), async (c) => {
  const { email, password, displayName } = c.req.valid('json');

  try {
    const result = await db.transaction(async (tx) => {
      // Check if email already exists
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      if (existing) {
        throw Object.assign(new Error('Email already registered'), { status: 409 });
      }

      // Create user
      const passwordHash = await hashPassword(password);
      const [user] = await tx
        .insert(users)
        .values({
          email: email.toLowerCase(),
          passwordHash,
          displayName: displayName ?? null,
        })
        .returning({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        });

      // Create org with slug collision handling
      const orgName = displayName ? `${displayName}'s Org` : 'My Organization';
      let slug = slugify(orgName);
      let org: typeof organizations.$inferSelect;
      try {
        [org] = await tx
          .insert(organizations)
          .values({ name: orgName, slug })
          .returning();
      } catch (insertErr: any) {
        if (insertErr?.code === '23505') {
          slug = `${slug}-${Date.now().toString(36)}`;
          [org] = await tx
            .insert(organizations)
            .values({ name: orgName, slug })
            .returning();
        } else {
          throw insertErr;
        }
      }

      // Add membership
      await tx.insert(orgMemberships).values({
        userId: user.id,
        orgId: org.id,
        role: 'owner',
      });

      // Create session (hashed token)
      const token = generateSessionToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

      await tx.insert(authSessions).values({
        token: tokenHash,
        userId: user.id,
        expiresAt,
        ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null,
        userAgent: c.req.header('user-agent') ?? null,
      });

      return { user, org, token, expiresAt };
    });

    setSessionCookie(c, result.token, result.expiresAt);

    return c.json(
      {
        user: { id: result.user.id, email: result.user.email, displayName: result.user.displayName },
        org: { id: result.org.id, name: result.org.name, slug: result.org.slug, plan: result.org.plan },
      },
      201,
    );
  } catch (err: any) {
    if (err?.status === 409 || err?.code === '23505') {
      return c.json({ error: 'Email already registered' }, 409);
    }
    throw err;
  }
});

// POST /auth/login
auth.post('/auth/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const user = await verifyUserPassword(email, password);
  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const org = await findOrgByUserId(user.id);

  // Create session with hashed token (uses session-repo)
  const { createSession } = await import('../repositories/session-repo');
  const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
  const userAgent = c.req.header('user-agent');
  const { token, expiresAt } = await createSession(user.id, ipAddress, userAgent);

  setSessionCookie(c, token, expiresAt);

  return c.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, plan: org.plan }
      : null,
  });
});

// POST /auth/logout
auth.post('/auth/logout', async (c) => {
  const sessionToken = getCookie(c, 'aicib_session');
  if (sessionToken) {
    await deleteSession(sessionToken);
  }
  deleteCookie(c, 'aicib_session', { path: '/' });
  return c.json({ success: true });
});

// GET /auth/me (protected)
auth.get('/auth/me', authMiddleware, async (c) => {
  const { userId } = c.get('auth');

  // API key auth has no user context
  if (!userId) {
    return c.json({ error: 'API key auth does not have a user context' }, 403);
  }

  const user = await findUserById(userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const org = await findOrgByUserId(userId);
  const businessList = org ? await findBusinessesByOrg(org.id) : [];

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, plan: org.plan }
      : null,
    businesses: businessList,
  });
});

export { auth };
