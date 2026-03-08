import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { schedules, scheduleExecutions, schedulerState } from '../db/schema/index';

export async function getSchedules(businessId: string) {
  return db
    .select()
    .from(schedules)
    .where(eq(schedules.businessId, businessId))
    .orderBy(desc(schedules.updatedAt));
}

export async function getSchedule(businessId: string, id: number) {
  const [schedule] = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.businessId, businessId), eq(schedules.id, id)))
    .limit(1);
  return schedule ?? null;
}

export async function getScheduleExecutions(businessId: string, scheduleId: number) {
  return db
    .select()
    .from(scheduleExecutions)
    .where(
      and(
        eq(scheduleExecutions.businessId, businessId),
        eq(scheduleExecutions.scheduleId, scheduleId),
      ),
    )
    .orderBy(desc(scheduleExecutions.createdAt));
}

export async function getSchedulerState(businessId: string) {
  return db
    .select()
    .from(schedulerState)
    .where(eq(schedulerState.businessId, businessId));
}
