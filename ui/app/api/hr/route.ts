import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, safeGet, tableExists } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") || "overview";
    const limitRaw = Number.parseInt(searchParams.get("limit") || "100", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 250) : 100;

    if (tab === "overview") {
      const activeAgents = tableExists(db, "agent_status")
        ? safeGet<{ count: number }>(
            db,
            "agent_status",
            "SELECT COUNT(*) as count FROM agent_status WHERE status != 'stopped'"
          )?.count ?? 0
        : 0;

      const avgReviewScore = tableExists(db, "hr_reviews")
        ? safeGet<{ avg_score: number }>(
            db,
            "hr_reviews",
            "SELECT COALESCE(AVG(overall_score), 0) as avg_score FROM hr_reviews"
          )?.avg_score ?? 0
        : 0;

      const activePlans = tableExists(db, "hr_improvement_plans")
        ? safeGet<{ count: number }>(
            db,
            "hr_improvement_plans",
            "SELECT COUNT(*) as count FROM hr_improvement_plans WHERE status = 'active'"
          )?.count ?? 0
        : 0;

      const pendingAutoReviews = tableExists(db, "auto_review_queue")
        ? safeGet<{ count: number }>(
            db,
            "auto_review_queue",
            "SELECT COUNT(*) as count FROM auto_review_queue WHERE status = 'pending'"
          )?.count ?? 0
        : 0;

      const recentEvents = tableExists(db, "hr_events")
        ? safeAll<Record<string, unknown>>(
            db,
            "hr_events",
            `SELECT * FROM hr_events
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
            [50]
          )
        : [];

      return NextResponse.json({
        tab: "overview",
        stats: {
          activeAgents,
          avgReviewScore: Number(avgReviewScore.toFixed(2)),
          activePlans,
          pendingAutoReviews,
        },
        recentEvents,
      });
    }

    if (tab === "reviews") {
      if (!tableExists(db, "hr_reviews")) {
        return NextResponse.json({ tab: "reviews", entries: [], filters: { agents: [], types: [] } });
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
        where.push("review_type = ?");
        params.push(type);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const entries = safeAll<Record<string, unknown>>(
        db,
        "hr_reviews",
        `SELECT * FROM hr_reviews
         ${whereClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        [...params, limit]
      );

      const agents = safeAll<{ agent_role: string }>(
        db,
        "hr_reviews",
        "SELECT DISTINCT agent_role FROM hr_reviews ORDER BY agent_role"
      ).map((row) => row.agent_role);

      const types = safeAll<{ review_type: string }>(
        db,
        "hr_reviews",
        "SELECT DISTINCT review_type FROM hr_reviews ORDER BY review_type"
      ).map((row) => row.review_type);

      return NextResponse.json({
        tab: "reviews",
        entries,
        filters: { agents, types },
      });
    }

    if (tab === "onboarding") {
      if (!tableExists(db, "hr_onboarding")) {
        return NextResponse.json({ tab: "onboarding", entries: [] });
      }

      const entries = safeAll<Record<string, unknown>>(
        db,
        "hr_onboarding",
        `SELECT * FROM hr_onboarding
         ORDER BY completed_at IS NULL DESC, current_phase DESC, created_at DESC
         LIMIT ?`,
        [limit]
      );

      return NextResponse.json({ tab: "onboarding", entries });
    }

    if (!tableExists(db, "hr_improvement_plans")) {
      return NextResponse.json({ tab: "plans", entries: [], filters: { statuses: [] } });
    }

    const status = searchParams.get("status") || "all";
    const whereClause = status !== "all" ? "WHERE status = ?" : "";
    const entries = safeAll<Record<string, unknown>>(
      db,
      "hr_improvement_plans",
      `SELECT * FROM hr_improvement_plans
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      status !== "all" ? [status, limit] : [limit]
    );

    const statuses = safeAll<{ status: string }>(
      db,
      "hr_improvement_plans",
      "SELECT DISTINCT status FROM hr_improvement_plans ORDER BY status"
    ).map((row) => row.status);

    return NextResponse.json({
      tab: "plans",
      entries,
      filters: { statuses },
    });
  } catch (error) {
    return jsonError(error);
  }
}
