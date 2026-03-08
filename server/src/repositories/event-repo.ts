import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { companyEvents, eventInstances } from '../db/schema/index';

export async function getCompanyEvents(businessId: string) {
  return db
    .select()
    .from(companyEvents)
    .where(eq(companyEvents.businessId, businessId))
    .orderBy(desc(companyEvents.updatedAt));
}

export async function getCompanyEvent(businessId: string, id: number) {
  const [event] = await db
    .select()
    .from(companyEvents)
    .where(and(eq(companyEvents.businessId, businessId), eq(companyEvents.id, id)))
    .limit(1);
  return event ?? null;
}

export async function getEventInstances(businessId: string, eventId: number) {
  return db
    .select()
    .from(eventInstances)
    .where(
      and(
        eq(eventInstances.businessId, businessId),
        eq(eventInstances.eventId, eventId),
      ),
    )
    .orderBy(desc(eventInstances.createdAt));
}
