import { eq, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { costEntries, businesses } from '../db/schema/index';

export async function getCosts(
  businessId: string,
  pagination: { page: number; pageSize: number; offset: number },
) {
  // Get business config for limits
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const settings = ((business?.config ?? {}) as Record<string, any>).settings ?? {};

  const bFilter = eq(costEntries.businessId, businessId);

  // Today total
  const [todayResult] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
    })
    .from(costEntries)
    .where(
      sql`${costEntries.businessId} = ${businessId} AND DATE(${costEntries.timestamp} AT TIME ZONE 'UTC') = CURRENT_DATE`,
    );

  // This month total
  const [monthResult] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
    })
    .from(costEntries)
    .where(
      sql`${costEntries.businessId} = ${businessId} AND TO_CHAR(${costEntries.timestamp}, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')`,
    );

  // All-time total
  const [allTimeResult] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
    })
    .from(costEntries)
    .where(bFilter);

  // Daily history (last 14 days)
  const dailyRaw = await db
    .select({
      date: sql<string>`DATE(${costEntries.timestamp} AT TIME ZONE 'UTC')::text`,
      total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
    })
    .from(costEntries)
    .where(
      sql`${costEntries.businessId} = ${businessId} AND DATE(${costEntries.timestamp} AT TIME ZONE 'UTC') >= CURRENT_DATE - INTERVAL '13 days'`,
    )
    .groupBy(sql`DATE(${costEntries.timestamp} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${costEntries.timestamp} AT TIME ZONE 'UTC') ASC`);

  // Fill 14-day range (include zero-spend days)
  const dailyMap = new Map(dailyRaw.map((d) => [d.date, d.total]));
  const dailyHistory: { date: string; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    dailyHistory.push({
      date: dateStr,
      total: Number((dailyMap.get(dateStr) ?? 0).toFixed(4)),
    });
  }

  // By agent
  const byAgent = await db
    .select({
      agent: costEntries.agentRole,
      total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
    })
    .from(costEntries)
    .where(bFilter)
    .groupBy(costEntries.agentRole)
    .orderBy(sql`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0) DESC`);

  // Monthly history (last 6 months)
  const monthlyRaw = await db
    .select({
      month: sql<string>`TO_CHAR(${costEntries.timestamp}, 'YYYY-MM')`,
      total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
    })
    .from(costEntries)
    .where(bFilter)
    .groupBy(sql`TO_CHAR(${costEntries.timestamp}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${costEntries.timestamp}, 'YYYY-MM') DESC`)
    .limit(6);

  const monthlyHistory = monthlyRaw.reverse().map((m) => ({
    month: m.month,
    total: Number(m.total.toFixed(4)),
  }));

  // Total count
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(costEntries)
    .where(bFilter);

  // Paginated entries
  const recentEntries = await db
    .select()
    .from(costEntries)
    .where(bFilter)
    .orderBy(desc(costEntries.timestamp), desc(costEntries.id))
    .limit(pagination.pageSize)
    .offset(pagination.offset);

  const total = countResult?.count ?? 0;

  return {
    today: {
      total: Number((todayResult?.total ?? 0).toFixed(4)),
      limit: settings.costLimitDaily ?? null,
    },
    month: {
      total: Number((monthResult?.total ?? 0).toFixed(4)),
      limit: settings.costLimitMonthly ?? null,
    },
    allTime: Number((allTimeResult?.total ?? 0).toFixed(4)),
    dailyHistory,
    byAgent: byAgent.map((a) => ({
      agent: a.agent,
      total: Number(a.total.toFixed(4)),
    })),
    monthlyHistory,
    recentEntries,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}
