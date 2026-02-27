import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, safeGet, tableExists } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;

    if (!tableExists(db, "wiki_articles")) {
      return NextResponse.json({ error: "Wiki table not found" }, { status: 404 });
    }

    const asNumber = Number.parseInt(id, 10);
    const article = Number.isFinite(asNumber)
      ? safeGet<Record<string, unknown>>(
          db,
          "wiki_articles",
          "SELECT * FROM wiki_articles WHERE id = ?",
          [asNumber]
        )
      : safeGet<Record<string, unknown>>(
          db,
          "wiki_articles",
          "SELECT * FROM wiki_articles WHERE slug = ?",
          [id]
        );

    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const articleId = Number(article.id);

    const versions = tableExists(db, "wiki_article_versions")
      ? safeAll<Record<string, unknown>>(
          db,
          "wiki_article_versions",
          `SELECT * FROM wiki_article_versions
           WHERE article_id = ?
           ORDER BY version DESC, id DESC`,
          [articleId]
        )
      : [];

    return NextResponse.json({ article, versions });
  } catch (error) {
    return jsonError(error);
  }
}
