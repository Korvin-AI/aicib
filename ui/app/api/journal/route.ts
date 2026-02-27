import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, tableExists } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);

    const tab = searchParams.get("tab") || "ceo";
    const limitRaw = Number.parseInt(searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    if (tab === "ceo") {
      if (!tableExists(db, "ceo_journal")) {
        return NextResponse.json({ tab: "ceo", entries: [] });
      }

      const entries = safeAll<Record<string, unknown>>(
        db,
        "ceo_journal",
        `SELECT * FROM ceo_journal
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        [limit]
      );

      return NextResponse.json({ tab: "ceo", entries });
    }

    if (tab === "agents") {
      if (!tableExists(db, "agent_journals")) {
        return NextResponse.json({ tab: "agents", entries: [], filters: { agents: [], types: [] } });
      }

      const agent = searchParams.get("agent") || "all";
      const type = searchParams.get("type") || "all";

      const where: string[] = [];
      const params: unknown[] = [];

      if (agent !== "all") {
        where.push("agent_role = ?");
        params.push(agent);
      }

      if (type !== "all") {
        where.push("entry_type = ?");
        params.push(type);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

      const entries = safeAll<Record<string, unknown>>(
        db,
        "agent_journals",
        `SELECT * FROM agent_journals
         ${whereClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        [...params, limit]
      );

      const agents = safeAll<{ agent_role: string }>(
        db,
        "agent_journals",
        "SELECT DISTINCT agent_role FROM agent_journals ORDER BY agent_role"
      ).map((row) => row.agent_role);

      const types = safeAll<{ entry_type: string }>(
        db,
        "agent_journals",
        "SELECT DISTINCT entry_type FROM agent_journals ORDER BY entry_type"
      ).map((row) => row.entry_type);

      return NextResponse.json({
        tab: "agents",
        entries,
        filters: { agents, types },
      });
    }

    if (!tableExists(db, "decision_log")) {
      return NextResponse.json({
        tab: "decisions",
        entries: [],
        filters: { statuses: [], departments: [] },
      });
    }

    const status = searchParams.get("status") || "all";
    const department = searchParams.get("department") || "all";

    const where: string[] = [];
    const params: unknown[] = [];

    if (status !== "all") {
      where.push("status = ?");
      params.push(status);
    }

    if (department !== "all") {
      where.push("COALESCE(department, '') = ?");
      params.push(department === "none" ? "" : department);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const entries = safeAll<Record<string, unknown>>(
      db,
      "decision_log",
      `SELECT * FROM decision_log
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [...params, limit]
    );

    const statuses = safeAll<{ status: string }>(
      db,
      "decision_log",
      "SELECT DISTINCT status FROM decision_log ORDER BY status"
    ).map((row) => row.status);

    const departments = safeAll<{ department: string | null }>(
      db,
      "decision_log",
      "SELECT DISTINCT department FROM decision_log ORDER BY department"
    )
      .map((row) => row.department)
      .filter((value): value is string => !!value);

    return NextResponse.json({
      tab: "decisions",
      entries,
      filters: { statuses, departments },
    });
  } catch (error) {
    return jsonError(error);
  }
}
