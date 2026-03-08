import { eq, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  sessions,
  sessionData,
  agentStatus,
  costEntries,
  tasks,
  backgroundLogs,
  backgroundJobs,
  businesses,
} from '../db/schema/index';

export async function getStatus(businessId: string) {
  // Get business config for company name and agent definitions
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  const config = (business?.config ?? {}) as Record<string, any>;
  const agentDefs = business?.agentDefinitions ?? [];

  // Active session (depends on business query)
  const [activeSession] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.businessId, businessId))
    .orderBy(desc(sessions.startedAt))
    .limit(1);

  let sdkSessionId: string | null = null;
  if (activeSession) {
    const [sd] = await db
      .select({ sdkSessionId: sessionData.sdkSessionId })
      .from(sessionData)
      .where(eq(sessionData.sessionId, activeSession.id))
      .limit(1);
    sdkSessionId = sd?.sdkSessionId ?? null;
  }

  // Run 5 independent queries in parallel
  const [dbAgents, [todayCost], [monthCost], taskCounts, recentLogs, recentJobs] =
    await Promise.all([
      db
        .select()
        .from(agentStatus)
        .where(eq(agentStatus.businessId, businessId))
        .orderBy(agentStatus.agentRole),
      db
        .select({
          total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
        })
        .from(costEntries)
        .where(
          sql`${costEntries.businessId} = ${businessId} AND DATE(${costEntries.timestamp} AT TIME ZONE 'UTC') = CURRENT_DATE`,
        ),
      db
        .select({
          total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
        })
        .from(costEntries)
        .where(
          sql`${costEntries.businessId} = ${businessId} AND TO_CHAR(${costEntries.timestamp}, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')`,
        ),
      db
        .select({
          status: tasks.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(tasks)
        .where(eq(tasks.businessId, businessId))
        .groupBy(tasks.status),
      db
        .select()
        .from(backgroundLogs)
        .where(eq(backgroundLogs.businessId, businessId))
        .orderBy(desc(backgroundLogs.id))
        .limit(20),
      db
        .select()
        .from(backgroundJobs)
        .where(eq(backgroundJobs.businessId, businessId))
        .orderBy(desc(backgroundJobs.startedAt))
        .limit(5),
    ]);

  // Merge config agents with DB statuses
  const agentMap = new Map(dbAgents.map((a) => [a.agentRole, a]));
  const mergedAgents =
    agentDefs.length > 0
      ? agentDefs.map((def) => {
          const dbAgent = agentMap.get(def.role);
          return {
            role: def.role,
            model: def.model ?? 'sonnet',
            department: def.department ?? def.role,
            enabled: def.enabled ?? true,
            displayName: def.displayName ?? null,
            status: dbAgent?.status ?? 'stopped',
            lastActivity: dbAgent?.lastActivity ?? null,
            currentTask: dbAgent?.currentTask ?? null,
          };
        })
      : dbAgents.map((a) => ({
          role: a.agentRole,
          model: 'sonnet',
          department: a.agentRole,
          enabled: true,
          displayName: null,
          status: a.status,
          lastActivity: a.lastActivity,
          currentTask: a.currentTask,
        }));

  const taskMap: Record<string, number> = {};
  let totalTasks = 0;
  for (const tc of taskCounts) {
    taskMap[tc.status] = tc.count;
    totalTasks += tc.count;
  }

  const settings = config.settings ?? {};

  return {
    company: {
      name: config.company?.name ?? business?.name ?? '',
      template: business?.template ?? '',
    },
    session: {
      active: !!activeSession,
      sessionId: activeSession?.id ?? null,
      sdkSessionId,
    },
    agents: mergedAgents,
    costs: {
      today: Number((todayCost?.total ?? 0).toFixed(4)),
      month: Number((monthCost?.total ?? 0).toFixed(4)),
      dailyLimit: settings.costLimitDaily ?? null,
      monthlyLimit: settings.costLimitMonthly ?? null,
    },
    tasks: {
      backlog: taskMap['backlog'] ?? 0,
      todo: taskMap['todo'] ?? 0,
      in_progress: taskMap['in_progress'] ?? 0,
      in_review: taskMap['in_review'] ?? 0,
      done: taskMap['done'] ?? 0,
      cancelled: taskMap['cancelled'] ?? 0,
      total: totalTasks,
    },
    recentLogs,
    recentJobs,
  };
}
