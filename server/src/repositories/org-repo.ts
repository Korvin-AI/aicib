import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { organizations, orgMemberships, users } from '../db/schema/index';
import type { OrgRole } from '../types';

// Cached org plan lookup (60s TTL)
const planCache = new Map<string, { plan: string; expiresAt: number }>();

// Periodic cleanup to prevent memory leaks from expired entries
const cacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [orgId, entry] of planCache) {
    if (entry.expiresAt <= now) planCache.delete(orgId);
  }
}, 5 * 60_000);
cacheCleanupTimer.unref();

export async function getOrgPlan(orgId: string): Promise<string> {
  const now = Date.now();
  const cached = planCache.get(orgId);
  if (cached && cached.expiresAt > now) return cached.plan;

  const [org] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const plan = org?.plan ?? 'free';
  planCache.set(orgId, { plan, expiresAt: now + 60_000 });
  return plan;
}

export async function createOrganization(name: string, slug: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name, slug })
    .returning();
  return org;
}

export async function addMembership(
  userId: string,
  orgId: string,
  role: OrgRole,
) {
  await db.insert(orgMemberships).values({ userId, orgId, role });
}

export async function findOrgByUserId(userId: string) {
  const results = await db
    .select({
      org: organizations,
      role: orgMemberships.role,
    })
    .from(orgMemberships)
    .innerJoin(organizations, eq(orgMemberships.orgId, organizations.id))
    .where(eq(orgMemberships.userId, userId))
    .limit(1);

  if (results.length === 0) return null;
  return { ...results[0].org, role: results[0].role };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function createOrgForUser(
  userId: string,
  displayName?: string | null,
) {
  const orgName = displayName ? `${displayName}'s Org` : 'My Organization';
  let slug = slugify(orgName);

  let org: typeof organizations.$inferSelect;
  try {
    org = await createOrganization(orgName, slug);
  } catch (err: any) {
    if (err?.code === '23505') {
      // unique_violation — append timestamp to slug
      slug = `${slug}-${Date.now().toString(36)}`;
      org = await createOrganization(orgName, slug);
    } else {
      throw err;
    }
  }

  await addMembership(userId, org.id, 'owner');
  return org;
}

export async function getOrgById(orgId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org ?? null;
}

export async function updateOrg(orgId: string, data: { name: string }) {
  const [org] = await db
    .update(organizations)
    .set({ name: data.name })
    .where(eq(organizations.id, orgId))
    .returning();
  return org ?? null;
}

export async function getOrgMembers(orgId: string) {
  return db
    .select({
      userId: orgMemberships.userId,
      role: orgMemberships.role,
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(orgMemberships)
    .innerJoin(users, eq(orgMemberships.userId, users.id))
    .where(eq(orgMemberships.orgId, orgId));
}

export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole,
) {
  const [row] = await db
    .update(orgMemberships)
    .set({ role })
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function removeMember(orgId: string, userId: string) {
  const [row] = await db
    .delete(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function countOrgOwners(orgId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.role, 'owner'),
      ),
    );
  return result?.count ?? 0;
}
