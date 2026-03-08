import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { safeguardPending, externalActions } from '../db/schema/index';

export async function getPendingActions(businessId: string) {
  return db
    .select()
    .from(safeguardPending)
    .where(
      and(
        eq(safeguardPending.businessId, businessId),
        eq(safeguardPending.status, 'pending'),
      ),
    )
    .orderBy(desc(safeguardPending.createdAt));
}

export async function getExternalActions(businessId: string) {
  return db
    .select()
    .from(externalActions)
    .where(eq(externalActions.businessId, businessId))
    .orderBy(desc(externalActions.createdAt));
}

export async function getSafeguardStats(businessId: string) {
  const [pending] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(safeguardPending)
    .where(
      and(
        eq(safeguardPending.businessId, businessId),
        eq(safeguardPending.status, 'pending'),
      ),
    );

  const [total] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(externalActions)
    .where(eq(externalActions.businessId, businessId));

  return {
    pendingCount: pending?.count ?? 0,
    totalExternalActions: total?.count ?? 0,
  };
}
