import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { hrEvents, hrImprovementPlans } from '../db/schema/index';

export async function getHREvents(businessId: string, agentRole?: string) {
  const conditions = [eq(hrEvents.businessId, businessId)];
  if (agentRole) {
    conditions.push(eq(hrEvents.agentRole, agentRole));
  }
  return db
    .select()
    .from(hrEvents)
    .where(and(...conditions))
    .orderBy(desc(hrEvents.createdAt));
}

export async function getImprovementPlans(businessId: string, agentRole?: string) {
  const conditions = [eq(hrImprovementPlans.businessId, businessId)];
  if (agentRole) {
    conditions.push(eq(hrImprovementPlans.agentRole, agentRole));
  }
  return db
    .select()
    .from(hrImprovementPlans)
    .where(and(...conditions))
    .orderBy(desc(hrImprovementPlans.createdAt));
}
