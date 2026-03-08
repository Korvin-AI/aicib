import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  agentStatus,
  tasks,
  costEntries,
  hrOnboarding,
  hrReviews,
  agentJournals,
  backgroundLogs,
  businesses,
} from '../db/schema/index';

export async function getAgentDetail(businessId: string, role: string) {
  // Get business for agent definitions
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  const agentDefs = business?.agentDefinitions ?? [];
  const agentDef = agentDefs.find((a) => a.role === role);

  // Agent status from DB
  const [dbStatus] = await db
    .select()
    .from(agentStatus)
    .where(
      and(
        eq(agentStatus.businessId, businessId),
        eq(agentStatus.agentRole, role),
      ),
    )
    .limit(1);

  const profile = {
    model: agentDef?.model ?? 'sonnet',
    department: agentDef?.department ?? role,
    enabled: agentDef?.enabled ?? true,
    displayName: agentDef?.displayName ?? null,
    status: dbStatus?.status ?? 'stopped',
    lastActivity: dbStatus?.lastActivity ?? null,
    currentTask: dbStatus?.currentTask ?? null,
  };

  // Task stats
  const taskStats = await db
    .select({
      status: tasks.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(tasks)
    .where(
      and(eq(tasks.businessId, businessId), eq(tasks.assignee, role)),
    )
    .groupBy(tasks.status);

  const totalAssigned = taskStats.reduce((sum, t) => sum + t.count, 0);

  // Cost stats
  const [costStats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
      entries: sql<number>`COUNT(*)::int`,
      average: sql<number>`COALESCE(AVG(${costEntries.estimatedCostUsd}), 0)`,
    })
    .from(costEntries)
    .where(
      and(
        eq(costEntries.businessId, businessId),
        eq(costEntries.agentRole, role),
      ),
    );

  // HR onboarding
  const [onboarding] = await db
    .select()
    .from(hrOnboarding)
    .where(
      and(
        eq(hrOnboarding.businessId, businessId),
        eq(hrOnboarding.agentRole, role),
      ),
    )
    .limit(1);

  // HR reviews (last 5)
  const reviews = await db
    .select()
    .from(hrReviews)
    .where(
      and(
        eq(hrReviews.businessId, businessId),
        eq(hrReviews.agentRole, role),
      ),
    )
    .orderBy(desc(hrReviews.createdAt), desc(hrReviews.id))
    .limit(5);

  // Agent journals (last 10)
  const journals = await db
    .select()
    .from(agentJournals)
    .where(
      and(
        eq(agentJournals.businessId, businessId),
        eq(agentJournals.agentRole, role),
      ),
    )
    .orderBy(desc(agentJournals.createdAt), desc(agentJournals.id))
    .limit(10);

  // Recent background logs (last 20)
  const recentLogs = await db
    .select()
    .from(backgroundLogs)
    .where(
      and(
        eq(backgroundLogs.businessId, businessId),
        eq(backgroundLogs.agentRole, role),
      ),
    )
    .orderBy(desc(backgroundLogs.id))
    .limit(20);

  return {
    role,
    profile,
    taskStats: {
      byStatus: taskStats.map((t) => ({ status: t.status, count: t.count })),
      totalAssigned,
    },
    costStats: {
      total: Number((costStats?.total ?? 0).toFixed(4)),
      entries: costStats?.entries ?? 0,
      average: Number((costStats?.average ?? 0).toFixed(4)),
    },
    hr: {
      onboarding: onboarding ?? null,
      reviews,
    },
    journals,
    recentLogs,
  };
}
