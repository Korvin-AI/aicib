import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  agentStatus,
  hrReviews,
  hrOnboarding,
  hrEvents,
  hrImprovementPlans,
  autoReviewQueue,
} from '../db/schema/index';

export async function getHROverview(businessId: string) {
  const [agents, reviewCount, planCount, eventCount, pendingReviews] =
    await Promise.all([
      db
        .select()
        .from(agentStatus)
        .where(eq(agentStatus.businessId, businessId)),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(hrReviews)
        .where(eq(hrReviews.businessId, businessId)),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(hrImprovementPlans)
        .where(
          and(
            eq(hrImprovementPlans.businessId, businessId),
            eq(hrImprovementPlans.status, 'active'),
          ),
        ),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(hrEvents)
        .where(eq(hrEvents.businessId, businessId)),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(autoReviewQueue)
        .where(
          and(
            eq(autoReviewQueue.businessId, businessId),
            eq(autoReviewQueue.status, 'pending'),
          ),
        ),
    ]);

  return {
    agents,
    totalReviews: reviewCount[0]?.count ?? 0,
    activePlans: planCount[0]?.count ?? 0,
    totalEvents: eventCount[0]?.count ?? 0,
    pendingReviews: pendingReviews[0]?.count ?? 0,
  };
}

interface ReviewFilters {
  agentRole?: string;
  reviewType?: string;
}

export async function getHRReviews(businessId: string, filters: ReviewFilters) {
  const conditions = [eq(hrReviews.businessId, businessId)];
  if (filters.agentRole && filters.agentRole !== 'all') {
    conditions.push(eq(hrReviews.agentRole, filters.agentRole));
  }
  if (filters.reviewType && filters.reviewType !== 'all') {
    conditions.push(eq(hrReviews.reviewType, filters.reviewType));
  }

  const [reviews, agentRoles, reviewTypes] = await Promise.all([
    db
      .select()
      .from(hrReviews)
      .where(and(...conditions)!)
      .orderBy(desc(hrReviews.createdAt))
      .limit(100),
    db
      .selectDistinct({ agentRole: hrReviews.agentRole })
      .from(hrReviews)
      .where(eq(hrReviews.businessId, businessId)),
    db
      .selectDistinct({ reviewType: hrReviews.reviewType })
      .from(hrReviews)
      .where(eq(hrReviews.businessId, businessId)),
  ]);

  return {
    reviews,
    filters: {
      agentRoles: agentRoles.map((r) => r.agentRole).filter(Boolean) as string[],
      reviewTypes: reviewTypes.map((r) => r.reviewType).filter(Boolean) as string[],
    },
  };
}

export async function getHROnboarding(businessId: string) {
  return db
    .select()
    .from(hrOnboarding)
    .where(eq(hrOnboarding.businessId, businessId))
    .orderBy(hrOnboarding.agentRole);
}

export async function getHRPlans(businessId: string, statusFilter?: string) {
  const conditions = [eq(hrImprovementPlans.businessId, businessId)];
  if (statusFilter && statusFilter !== 'all') {
    conditions.push(eq(hrImprovementPlans.status, statusFilter));
  }
  return db
    .select()
    .from(hrImprovementPlans)
    .where(and(...conditions)!)
    .orderBy(desc(hrImprovementPlans.createdAt));
}
