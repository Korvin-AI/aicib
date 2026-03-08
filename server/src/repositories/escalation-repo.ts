import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { escalationEvents, autoReviewQueue } from '../db/schema/index';

export async function getEscalationEvents(businessId: string) {
  return db
    .select()
    .from(escalationEvents)
    .where(eq(escalationEvents.businessId, businessId))
    .orderBy(desc(escalationEvents.createdAt));
}

export async function getEscalationStats(businessId: string) {
  const [total] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(escalationEvents)
    .where(eq(escalationEvents.businessId, businessId));

  const [unresolved] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(escalationEvents)
    .where(
      and(
        eq(escalationEvents.businessId, businessId),
        eq(escalationEvents.resolved, false),
      ),
    );

  const [pendingReviews] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(autoReviewQueue)
    .where(
      and(
        eq(autoReviewQueue.businessId, businessId),
        eq(autoReviewQueue.status, 'pending'),
      ),
    );

  return {
    totalEscalations: total?.count ?? 0,
    unresolvedEscalations: unresolved?.count ?? 0,
    pendingReviews: pendingReviews?.count ?? 0,
  };
}
