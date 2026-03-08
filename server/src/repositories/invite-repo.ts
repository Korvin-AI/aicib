import { eq, and, not } from 'drizzle-orm';
import { db } from '../db/connection';
import { orgInvitations } from '../db/schema/index';
import type { OrgRole } from '../types';

export async function createInvitation(
  orgId: string,
  email: string,
  role: OrgRole,
  invitedBy: string | null,
  tokenHash: string,
  expiresAt: Date,
) {
  // Atomic: remove non-pending invitations then insert, preventing unique
  // constraint violations when re-inviting after revocation/acceptance.
  return db.transaction(async (tx) => {
    await tx
      .delete(orgInvitations)
      .where(
        and(
          eq(orgInvitations.orgId, orgId),
          eq(orgInvitations.email, email.toLowerCase()),
          not(eq(orgInvitations.status, 'pending')),
        ),
      );

    const [inv] = await tx
      .insert(orgInvitations)
      .values({
        orgId,
        email: email.toLowerCase(),
        role,
        tokenHash,
        invitedBy,
        expiresAt,
      })
      .returning();
    return inv;
  });
}

export async function findInvitationByToken(tokenHash: string) {
  const [inv] = await db
    .select()
    .from(orgInvitations)
    .where(eq(orgInvitations.tokenHash, tokenHash))
    .limit(1);
  return inv ?? null;
}

export async function listPendingInvitations(orgId: string) {
  return db
    .select()
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.orgId, orgId),
        eq(orgInvitations.status, 'pending'),
      ),
    );
}

export async function revokeInvitation(orgId: string, invitationId: string) {
  const [inv] = await db
    .update(orgInvitations)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(orgInvitations.id, invitationId),
        eq(orgInvitations.orgId, orgId),
        eq(orgInvitations.status, 'pending'),
      ),
    )
    .returning();
  return inv ?? null;
}

export async function markInvitationAccepted(invitationId: string) {
  await db
    .update(orgInvitations)
    .set({ status: 'accepted' })
    .where(eq(orgInvitations.id, invitationId));
}
