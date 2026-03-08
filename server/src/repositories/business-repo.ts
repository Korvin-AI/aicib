import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { businesses } from '../db/schema/index';

export async function findBusinessesByOrg(orgId: string) {
  return db
    .select({
      id: businesses.id,
      name: businesses.name,
      template: businesses.template,
      executionMode: businesses.executionMode,
      createdAt: businesses.createdAt,
    })
    .from(businesses)
    .where(eq(businesses.orgId, orgId));
}

export async function findBusinessById(businessId: string) {
  const [biz] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return biz ?? null;
}
