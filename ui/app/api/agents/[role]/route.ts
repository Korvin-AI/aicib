import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, safeGet, tableExists } from "@/lib/api-helpers";
import { readAppConfig } from "@/lib/config-read";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ role: string }> }
) {
  try {
    const db = getDb();
    const { role } = await params;
    const config = readAppConfig();

    const baseAgent = config.agents.find((agent) => agent.role === role);
    const status = tableExists(db, "agent_status")
      ? safeGet<{ status: string; last_activity: string | null; current_task: string | null }>(
          db,
          "agent_status",
          "SELECT status, last_activity, current_task FROM agent_status WHERE agent_role = ?",
          [role]
        )
      : null;

    const taskStats = tableExists(db, "tasks")
      ? safeAll<{ status: string; count: number }>(
          db,
          "tasks",
          "SELECT status, COUNT(*) as count FROM tasks WHERE assignee = ? GROUP BY status",
          [role]
        )
      : [];

    const totalAssigned = taskStats.reduce((sum, row) => sum + row.count, 0);

    const costStats = tableExists(db, "cost_entries")
      ? safeGet<{ total: number; entries: number; average: number }>(
          db,
          "cost_entries",
          `SELECT
            COALESCE(SUM(estimated_cost_usd), 0) as total,
            COUNT(*) as entries,
            COALESCE(AVG(estimated_cost_usd), 0) as average
          FROM cost_entries
          WHERE agent_role = ?`,
          [role]
        )
      : null;

    const onboarding = tableExists(db, "hr_onboarding")
      ? safeGet<Record<string, unknown>>(
          db,
          "hr_onboarding",
          "SELECT * FROM hr_onboarding WHERE agent_role = ?",
          [role]
        )
      : null;

    const reviews = tableExists(db, "hr_reviews")
      ? safeAll<Record<string, unknown>>(
          db,
          "hr_reviews",
          `SELECT * FROM hr_reviews
           WHERE agent_role = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 5`,
          [role]
        )
      : [];

    const journals = tableExists(db, "agent_journals")
      ? safeAll<Record<string, unknown>>(
          db,
          "agent_journals",
          `SELECT * FROM agent_journals
           WHERE agent_role = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 10`,
          [role]
        )
      : [];

    const recentLogs = tableExists(db, "background_logs")
      ? safeAll<Record<string, unknown>>(
          db,
          "background_logs",
          `SELECT * FROM background_logs
           WHERE agent_role = ?
           ORDER BY id DESC
           LIMIT 20`,
          [role]
        )
      : [];

    return NextResponse.json({
      role,
      profile: {
        model: baseAgent?.model || "unknown",
        department: baseAgent?.department || role,
        enabled: baseAgent?.enabled ?? true,
        displayName: baseAgent?.displayName || null,
        status: status?.status || "stopped",
        lastActivity: status?.last_activity || null,
        currentTask: status?.current_task || null,
      },
      taskStats: {
        byStatus: taskStats,
        totalAssigned,
      },
      costStats: {
        total: costStats?.total ?? 0,
        entries: costStats?.entries ?? 0,
        average: costStats?.average ?? 0,
      },
      hr: {
        onboarding,
        reviews,
      },
      journals,
      recentLogs,
    });
  } catch (error) {
    return jsonError(error);
  }
}
