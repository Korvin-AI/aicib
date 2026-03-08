import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { reports } from '../db/schema/index';

export async function getReports(businessId: string) {
  return db
    .select()
    .from(reports)
    .where(eq(reports.businessId, businessId))
    .orderBy(desc(reports.createdAt));
}

export async function getReport(businessId: string, id: number) {
  const [report] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.businessId, businessId), eq(reports.id, id)))
    .limit(1);
  return report ?? null;
}
