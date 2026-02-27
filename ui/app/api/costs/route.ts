import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, parsePagination, safeAll, safeGet, tableExists } from "@/lib/api-helpers";
import { readAppConfig } from "@/lib/config-read";

export const dynamic = "force-dynamic";

interface CostEntryRow {
  id: number;
  agent_role: string;
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  timestamp: string;
}

function buildDateRange(days: number): string[] {
  const now = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const config = readAppConfig();

    const pageInfo = parsePagination(request, { pageSize: 50, maxPageSize: 200 });
    const hasCosts = tableExists(db, "cost_entries");

    if (!hasCosts) {
      return NextResponse.json({
        today: { total: 0, limit: config.settings.costLimitDaily },
        month: { total: 0, limit: config.settings.costLimitMonthly },
        allTime: 0,
        dailyHistory: [],
        byAgent: [],
        monthlyHistory: [],
        recentEntries: [],
        pagination: {
          page: pageInfo.page,
          pageSize: pageInfo.pageSize,
          total: 0,
          totalPages: 1,
        },
      });
    }

    const today =
      safeGet<{ total: number }>(
        db,
        "cost_entries",
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
         FROM cost_entries
         WHERE date(timestamp) = date('now')`
      )?.total ?? 0;

    const month =
      safeGet<{ total: number }>(
        db,
        "cost_entries",
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
         FROM cost_entries
         WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`
      )?.total ?? 0;

    const allTime =
      safeGet<{ total: number }>(
        db,
        "cost_entries",
        "SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM cost_entries"
      )?.total ?? 0;

    const dailyRows = safeAll<{ date: string; total: number }>(
      db,
      "cost_entries",
      `SELECT date(timestamp) as date, COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM cost_entries
       WHERE date(timestamp) >= date('now', '-13 days')
       GROUP BY date(timestamp)
       ORDER BY date(timestamp) ASC`
    );

    const dailyMap = new Map(dailyRows.map((row) => [row.date, row.total]));
    const dailyHistory = buildDateRange(14).map((date) => ({
      date,
      total: Number((dailyMap.get(date) ?? 0).toFixed(4)),
    }));

    const byAgent = safeAll<{ agent: string; total: number }>(
      db,
      "cost_entries",
      `SELECT agent_role as agent, COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM cost_entries
       GROUP BY agent_role
       ORDER BY total DESC`
    ).map((row) => ({ ...row, total: Number(row.total.toFixed(4)) }));

    const monthlyHistory = safeAll<{ month: string; total: number }>(
      db,
      "cost_entries",
      `SELECT strftime('%Y-%m', timestamp) as month, COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM cost_entries
       GROUP BY strftime('%Y-%m', timestamp)
       ORDER BY month DESC
       LIMIT 6`
    )
      .reverse()
      .map((row) => ({ ...row, total: Number(row.total.toFixed(4)) }));

    const total =
      safeGet<{ count: number }>(
        db,
        "cost_entries",
        "SELECT COUNT(*) as count FROM cost_entries"
      )?.count ?? 0;

    const recentEntries = safeAll<CostEntryRow>(
      db,
      "cost_entries",
      `SELECT * FROM cost_entries
       ORDER BY timestamp DESC, id DESC
       LIMIT ? OFFSET ?`,
      [pageInfo.pageSize, pageInfo.offset]
    );

    return NextResponse.json({
      today: {
        total: Number(today.toFixed(4)),
        limit: config.settings.costLimitDaily,
      },
      month: {
        total: Number(month.toFixed(4)),
        limit: config.settings.costLimitMonthly,
      },
      allTime: Number(allTime.toFixed(4)),
      dailyHistory,
      byAgent,
      monthlyHistory,
      recentEntries,
      pagination: {
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageInfo.pageSize)),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
