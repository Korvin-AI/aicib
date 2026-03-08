import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { organizations, orgMemberships } from '../db/schema/index';

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
  role: 'owner' | 'admin' | 'member' | 'viewer',
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
