import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { notifications, notificationPreferences } from '../db/schema/index';

export async function getNotifications(businessId: string, status?: string) {
  const conditions = [eq(notifications.businessId, businessId)];
  if (status && status !== 'all') {
    conditions.push(eq(notifications.status, status));
  }
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt));
}

export async function getNotificationCounts(businessId: string) {
  const rows = await db
    .select({
      status: notifications.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(notifications)
    .where(eq(notifications.businessId, businessId))
    .groupBy(notifications.status);

  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.status) counts[r.status] = r.count;
  }
  return counts;
}

export async function getNotificationPreferences(businessId: string) {
  return db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.businessId, businessId));
}

export async function dismissNotification(businessId: string, id: number) {
  return db
    .update(notifications)
    .set({ status: 'dismissed' })
    .where(and(eq(notifications.businessId, businessId), eq(notifications.id, id)));
}
