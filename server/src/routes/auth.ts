import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { users, organizations, orgMemberships, orgInvitations, authSessions } from '../db/schema/index';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateSessionToken } from '../utils/token';
import { createHash } from 'node:crypto';
import { findUserById, verifyUserPassword } from '../repositories/user-repo';
import { createSession, deleteSession } from '../repositories/session-repo';
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

  // Create session with hashed token
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

// POST /auth/accept-invite — public endpoint, wrapped in a transaction
auth.post(
  '/auth/accept-invite',
  zValidator('json', z.object({
    token: z.string().min(1),
    password: z.string().min(8).optional(),
    displayName: z.string().max(255).optional(),
  })),
  async (c) => {
    const { token, password, displayName } = c.req.valid('json');
    const tokenHash = hashToken(token);

    // Validate invitation outside the transaction (read-only)
    const [invitation] = await db
      .select()
      .from(orgInvitations)
      .where(eq(orgInvitations.tokenHash, tokenHash))
      .limit(1);

    if (!invitation) {
      return c.json({ error: 'Invalid or expired invitation' }, 400);
    }
    if (invitation.status !== 'pending') {
      return c.json({ error: `Invitation already ${invitation.status}` }, 400);
    }
    if (invitation.expiresAt < new Date()) {
      return c.json({ error: 'Invitation has expired' }, 400);
    }

    // Hash password before entering the transaction to avoid blocking the DB connection
    const passwordHash = password ? await hashPassword(password) : null;

    // All mutations in a single transaction to prevent race conditions
    const result = await db.transaction(async (tx) => {
      // Re-check invitation status + expiry inside tx (serializable guard)
      const [inv] = await tx
        .select()
        .from(orgInvitations)
        .where(eq(orgInvitations.id, invitation.id))
        .limit(1);
      if (!inv || inv.status !== 'pending') {
        throw Object.assign(new Error(`Invitation already ${inv?.status ?? 'missing'}`), { status: 400 });
      }
      if (inv.expiresAt < new Date()) {
        throw Object.assign(new Error('Invitation has expired'), { status: 400 });
      }

      // Find or create user
      const [existingUser] = await tx
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.email, inv.email.toLowerCase()))
        .limit(1);

      let user: { id: string; email: string; displayName: string | null };
      if (!existingUser) {
        if (!passwordHash) {
          throw Object.assign(new Error('Password required for new accounts'), { status: 400 });
        }
        const [newUser] = await tx
          .insert(users)
          .values({
            email: inv.email.toLowerCase(),
            passwordHash,
            displayName: displayName ?? null,
          })
          .returning({ id: users.id, email: users.email, displayName: users.displayName });
        user = newUser;
      } else {
        user = existingUser;
      }

      // Add membership (ignore duplicate)
      try {
        await tx.insert(orgMemberships).values({
          userId: user.id,
          orgId: inv.orgId,
          role: inv.role,
        });
      } catch (err: any) {
        if (err?.code !== '23505') throw err;
      }

      // Mark invitation accepted
      await tx
        .update(orgInvitations)
        .set({ status: 'accepted' })
        .where(eq(orgInvitations.id, inv.id));

      return { user, orgId: inv.orgId, role: inv.role };
    });

    // Create session outside the transaction (independent operation)
    const ipAddress = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');
    const { token: sessionToken, expiresAt } = await createSession(
      result.user.id,
      ipAddress,
      userAgent,
    );

    setSessionCookie(c, sessionToken, expiresAt);

    return c.json({
      user: { id: result.user.id, email: result.user.email, displayName: result.user.displayName },
      orgId: result.orgId,
      role: result.role,
    });
  },
);

export { auth };
