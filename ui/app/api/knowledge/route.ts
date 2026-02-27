import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, tableExists } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "articles";

    if (type === "archives") {
      if (!tableExists(db, "project_archives")) {
        return NextResponse.json({ type: "archives", entries: [] });
      }

      const entries = safeAll<Record<string, unknown>>(
        db,
        "project_archives",
        `SELECT * FROM project_archives
         ORDER BY completed_at DESC, id DESC`
      );

      return NextResponse.json({ type: "archives", entries });
    }

    if (!tableExists(db, "wiki_articles")) {
      return NextResponse.json({
        type: "articles",
        entries: [],
        sections: [],
      });
    }

    const section = searchParams.get("section") || "all";
    const search = (searchParams.get("search") || "").trim();

    const where: string[] = [];
    const params: unknown[] = [];

    if (section !== "all") {
      where.push("section = ?");
      params.push(section);
    }

    if (search) {
      where.push("(title LIKE ? OR content LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const entries = safeAll<Record<string, unknown>>(
      db,
      "wiki_articles",
      `SELECT * FROM wiki_articles
       ${whereClause}
       ORDER BY section ASC, updated_at DESC, id DESC`,
      params
    );

    const sections = safeAll<{ section: string; count: number }>(
      db,
      "wiki_articles",
      `SELECT section, COUNT(*) as count
       FROM wiki_articles
       GROUP BY section
       ORDER BY section ASC`
    );

    return NextResponse.json({
      type: "articles",
      entries,
      sections,
    });
  } catch (error) {
    return jsonError(error);
  }
}
