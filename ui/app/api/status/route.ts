import { NextResponse } from "next/server";
import { tryGetProjectDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, safeGet, tableExists } from "@/lib/api-helpers";
import { readAppConfig } from "@/lib/config-read";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projectDir = tryGetProjectDir();
    if (!projectDir) {
      return NextResponse.json({
        company: { name: "No business selected", template: "none" },
        session: { active: false },
        agents: [],
        costs: {
          today: 0,
          month: 0,
          dailyLimit: 0,
          monthlyLimit: 0,
        },
        tasks: {
          backlog: 0,
          todo: 0,
          in_progress: 0,
          in_review: 0,
          done: 0,
          cancelled: 0,
          total: 0,
        },
        recentLogs: [],
        recentJobs: [],
      });
    }

    const db = getDb();
    const config = readAppConfig();

    const activeSession = tableExists(db, "sessions")
      ? safeGet<{ id: string }>(
          db,
          "sessions",
          "SELECT id FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
        )
      : null;

    const sdkSessionId =
      activeSession && tableExists(db, "session_data")
        ? safeGet<{ sdk_session_id: string }>(
            db,
            "session_data",
            "SELECT sdk_session_id FROM session_data WHERE session_id = ?",
            [activeSession.id]
          )?.sdk_session_id ?? null
        : null;

    const dbStatuses = tableExists(db, "agent_status")
      ? safeAll<{
          agent_role: string;
          status: string;
          last_activity: string | null;
          current_task: string | null;
        }>(db, "agent_status", "SELECT * FROM agent_status ORDER BY agent_role")
      : [];

    const statusMap = new Map(dbStatuses.map((status) => [status.agent_role, status]));

    const agents =
      config.agents.length > 0
        ? config.agents.map((agent) => {
            const status = statusMap.get(agent.role);
            return {
              role: agent.role,
              model: agent.model,
              department: agent.department,
              enabled: agent.enabled,
              displayName: agent.displayName || null,
              status: status?.status || "stopped",
              lastActivity: status?.last_activity || null,
              currentTask: status?.current_task || null,
            };
          })
        : dbStatuses.map((status) => ({
            role: status.agent_role,
            model: "unknown",
            department: status.agent_role,
            enabled: true,
            displayName: null,
            status: status.status,
            lastActivity: status.last_activity,
            currentTask: status.current_task,
          }));

    const todayCost = tableExists(db, "cost_entries")
      ? safeGet<{ total: number }>(
          db,
          "cost_entries",
          `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
           FROM cost_entries
           WHERE date(timestamp) = date('now')`
        )?.total ?? 0
      : 0;

    const monthCost = tableExists(db, "cost_entries")
      ? safeGet<{ total: number }>(
          db,
          "cost_entries",
          `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
           FROM cost_entries
           WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`
        )?.total ?? 0
      : 0;

    const taskCounts: Record<string, number> = {
      backlog: 0,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      cancelled: 0,
      total: 0,
    };

    if (tableExists(db, "tasks")) {
      const rows = safeAll<{ status: string; count: number }>(
        db,
        "tasks",
        "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
      );

      for (const row of rows) {
        if (row.status in taskCounts) {
          taskCounts[row.status] = row.count;
          taskCounts.total += row.count;
        }
      }
    }

    const recentLogs = tableExists(db, "background_logs")
      ? safeAll<Record<string, unknown>>(
          db,
          "background_logs",
          "SELECT * FROM background_logs ORDER BY id DESC LIMIT 20"
        )
      : [];

    const recentJobs = tableExists(db, "background_jobs")
      ? safeAll<Record<string, unknown>>(
          db,
          "background_jobs",
          "SELECT * FROM background_jobs ORDER BY started_at DESC LIMIT 5"
        )
      : [];

    return NextResponse.json({
      company: config.company,
      session: activeSession
        ? {
            active: true,
            sessionId: activeSession.id,
            sdkSessionId,
          }
        : { active: false },
      agents,
      costs: {
        today: todayCost,
        month: monthCost,
        dailyLimit: config.settings.costLimitDaily,
        monthlyLimit: config.settings.costLimitMonthly,
      },
      tasks: taskCounts,
      recentLogs,
      recentJobs,
    });
  } catch (error) {
    return jsonError(error);
  }
}
