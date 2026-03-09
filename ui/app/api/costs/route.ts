import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, parsePagination, safeAll, safeGet, tableExists } from "@/lib/api-helpers";
import { readAppConfig } from "@/lib/config-read";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetch } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

interface CostEntryRow {
  id: number;
  agent_role: string;
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  timestamp: string;
}

interface CacheTotals {
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

function queryCacheSavings(
  db: ReturnType<typeof getDb>,
  whereClause: string
): { cacheReadTokens: number; cacheCreationTokens: number; estimatedSavingsUsd: number } {
  const DEFAULT_INPUT_RATE = 3.0; // Sonnet rate
  const hasCacheColumns = columnExists(db, "cost_entries", "cache_read_tokens");

  if (!hasCacheColumns) {
    return { cacheReadTokens: 0, cacheCreationTokens: 0, estimatedSavingsUsd: 0 };
  }

  const result = safeGet<CacheTotals>(
    db,
    "cost_entries",
    `SELECT COALESCE(SUM(cache_read_tokens), 0) as cacheReadTokens,
            COALESCE(SUM(cache_creation_tokens), 0) as cacheCreationTokens
     FROM cost_entries ${whereClause}`
  ) ?? { cacheReadTokens: 0, cacheCreationTokens: 0 };

  return {
    ...result,
    estimatedSavingsUsd: (result.cacheReadTokens / 1_000_000) * DEFAULT_INPUT_RATE * 0.9,
  };
}

const ALLOWED_TABLES = new Set(["cost_entries", "background_jobs", "sessions", "agent_status"]);

function columnExists(db: ReturnType<typeof getDb>, table: string, column: string): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

function queryAverageBriefCost(db: ReturnType<typeof getDb>): number | null {
  if (!tableExists(db, "background_jobs")) return null;
  const result = safeGet<{ avg_cost: number | null }>(
    db,
    "background_jobs",
    `SELECT AVG(total_cost_usd) as avg_cost
     FROM (
       SELECT total_cost_usd FROM background_jobs
       WHERE status = 'completed'
         AND directive LIKE '[foreground]%'
         AND total_cost_usd > 0
       ORDER BY completed_at DESC
       LIMIT 20
     )`
  );
  return result?.avg_cost ?? null;
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
  if (isCloudMode()) return cloudFetch(request, "costs");

  try {
    const db = getDb();
    const config = readAppConfig();

    const pageInfo = parsePagination(request, { pageSize: 50, maxPageSize: 200 });
    const hasCosts = tableExists(db, "cost_entries");

    const zeroCacheSavings = { cacheReadTokens: 0, cacheCreationTokens: 0, estimatedSavingsUsd: 0 };

    if (!hasCosts) {
      return NextResponse.json({
        today: { total: 0, limit: config.settings.costLimitDaily },
        month: { total: 0, limit: config.settings.costLimitMonthly },
        allTime: 0,
        dailyHistory: [],
        byAgent: [],
        monthlyHistory: [],
        recentEntries: [],
        cacheSavings: {
          today: zeroCacheSavings,
          month: zeroCacheSavings,
          allTime: zeroCacheSavings,
        },
        averageBriefCost: null,
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

    // Cache savings
    const cacheSavings = {
      today: queryCacheSavings(db, "WHERE date(timestamp) = date('now')"),
      month: queryCacheSavings(db, "WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')"),
      allTime: queryCacheSavings(db, ""),
    };

    const averageBriefCost = queryAverageBriefCost(db);

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
      cacheSavings,
      averageBriefCost,
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
