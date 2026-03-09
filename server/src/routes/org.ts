import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/connection';
import { apiKeys } from '../db/schema/index';
import { validateBody } from '../middleware/validate';
import { requireRole, ROLE_LEVELS } from '../middleware/rbac';
import {
  createInvitationSchema,
  updateMemberRoleSchema,
  updateOrgSchema,
} from '../schemas/org';
import {
  getOrgById,
  updateOrg,
  getOrgMembers,
  updateMemberRole,
  removeMember,
  countOrgOwners,
} from '../repositories/org-repo';
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
} from '../repositories/invite-repo';
import { notFoundError, forbiddenError, conflictError } from '../utils/errors';
import type { AuthContext } from '../types';

const orgRoute = new Hono<{ Variables: { auth: AuthContext } }>();

// GET /org — current org details
orgRoute.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const org = await getOrgById(orgId);
  if (!org) throw notFoundError('Organization not found');
  return c.json(org);
});

// PUT /org — update org name (admin+)
orgRoute.put('/', requireRole('admin'), validateBody(updateOrgSchema), async (c) => {
  const { orgId } = c.get('auth');
  const { name } = c.req.valid('json');
  const org = await updateOrg(orgId, { name });
  if (!org) throw notFoundError('Organization not found');
  return c.json(org);
});

// GET /org/members — list members
orgRoute.get('/members', async (c) => {
  const { orgId } = c.get('auth');
  const members = await getOrgMembers(orgId);
  return c.json({ members });
});

// PUT /org/members/:userId — change role
orgRoute.put(
  '/members/:userId',
  requireRole('admin'),
  validateBody(updateMemberRoleSchema),
  async (c) => {
    const { orgId, orgRole, userId } = c.get('auth');
    const targetUserId = c.req.param('userId');
    const { role: newRole } = c.req.valid('json');

    // Prevent self-role-change
    if (targetUserId === userId) {
      throw forbiddenError('Cannot change your own role');
    }

    // Only owners can promote to owner
    if (newRole === 'owner' && orgRole !== 'owner') {
      throw forbiddenError('Only owners can promote to owner');
    }

    // Admins can only manage member/viewer
    if (orgRole === 'admin' && ROLE_LEVELS[newRole] >= ROLE_LEVELS.admin) {
      throw forbiddenError('Admins can only assign member or viewer roles');
    }

    // Prevent demoting the last owner
    const members = await getOrgMembers(orgId);
    const target = members.find((m) => m.userId === targetUserId);
    if (!target) throw notFoundError('Member not found');

    if (target.role === 'owner' && newRole !== 'owner') {
      const ownerCount = await countOrgOwners(orgId);
      if (ownerCount <= 1) {
        throw conflictError('Cannot demote the last owner');
      }
    }

    const result = await updateMemberRole(orgId, targetUserId, newRole);
    if (!result) throw notFoundError('Member not found');
    return c.json({ success: true, role: newRole });
  },
);

// DELETE /org/members/:userId — remove member
orgRoute.delete(
  '/members/:userId',
  requireRole('admin'),
  async (c) => {
    const { orgId } = c.get('auth');
    const targetUserId = c.req.param('userId');

    // Prevent removing last owner
    const members = await getOrgMembers(orgId);
    const target = members.find((m) => m.userId === targetUserId);
    if (!target) throw notFoundError('Member not found');

    if (target.role === 'owner') {
      const ownerCount = await countOrgOwners(orgId);
      if (ownerCount <= 1) {
        throw conflictError('Cannot remove the last owner');
      }
    }

    await removeMember(orgId, targetUserId);
    return c.json({ success: true });
  },
);

// POST /org/invitations — create invite (admin+)
orgRoute.post(
  '/invitations',
  requireRole('admin'),
  validateBody(createInvitationSchema),
  async (c) => {
    const { orgId, userId } = c.get('auth');
    const { email, role } = c.req.valid('json');

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    try {
      const inv = await createInvitation(orgId, email, role, userId, tokenHash, expiresAt);
      return c.json({ invitation: inv, token: rawToken }, 201);
    } catch (err: any) {
      if (err?.code === '23505') {
        throw conflictError('An invitation for this email already exists');
      }
      throw err;
    }
  },
);

// GET /org/invitations — list pending
orgRoute.get('/invitations', requireRole('admin'), async (c) => {
  const { orgId } = c.get('auth');
  const invitations = await listPendingInvitations(orgId);
  return c.json({ invitations });
});

// DELETE /org/invitations/:id — revoke
orgRoute.delete(
  '/invitations/:id',
  requireRole('admin'),
  async (c) => {
    const { orgId } = c.get('auth');
    const invitationId = c.req.param('id');
    const inv = await revokeInvitation(orgId, invitationId);
    if (!inv) throw notFoundError('Invitation not found or already processed');
    return c.json({ success: true });
  },
);

// ---------------------------------------------------------------------------
// API Key CRUD
// ---------------------------------------------------------------------------

const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
});

// POST /org/api-keys — Generate new API key (admin+)
orgRoute.post(
  '/api-keys',
  requireRole('admin'),
  validateBody(createApiKeySchema),
  async (c) => {
    const { orgId } = c.get('auth');
    const { name } = c.req.valid('json');

    // Generate random key
    const rawKey = `aicib_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 12);

    const [apiKey] = await db
      .insert(apiKeys)
      .values({
        orgId,
        name,
        keyHash,
        keyPrefix,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
      });

    // Return plaintext key only once
    return c.json({ apiKey: { ...apiKey, key: rawKey } }, 201);
  },
);

// GET /org/api-keys — List keys (masked)
orgRoute.get('/api-keys', requireRole('admin'), async (c) => {
  const { orgId } = c.get('auth');

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId));

  return c.json({ apiKeys: keys });
});

// DELETE /org/api-keys/:id — Revoke key
orgRoute.delete(
  '/api-keys/:id',
  requireRole('admin'),
  async (c) => {
    const { orgId } = c.get('auth');
    const keyId = c.req.param('id');

    const [deleted] = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId)))
      .returning({ id: apiKeys.id });

    if (!deleted) throw notFoundError('API key not found');
    return c.json({ success: true });
  },
);

export { orgRoute };
