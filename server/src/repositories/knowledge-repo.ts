import { eq, and, desc, ilike, sql, or } from 'drizzle-orm';
import { db } from '../db/connection';
import { wikiArticles, wikiArticleVersions, projectArchives } from '../db/schema/index';

function escapeLike(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function getWikiArticles(businessId: string, filters?: { section?: string; search?: string }) {
  const conditions = [eq(wikiArticles.businessId, businessId)];
  if (filters?.section) {
    conditions.push(eq(wikiArticles.section, filters.section));
  }
  if (filters?.search) {
    const search = escapeLike(filters.search.slice(0, 200));
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(wikiArticles.title, pattern),
        ilike(wikiArticles.content, pattern),
      )!,
    );
  }
  return db
    .select()
    .from(wikiArticles)
    .where(and(...conditions)!)
    .orderBy(desc(wikiArticles.updatedAt));
}

export async function getSections(businessId: string) {
  return db
    .select({
      section: wikiArticles.section,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(wikiArticles)
    .where(eq(wikiArticles.businessId, businessId))
    .groupBy(wikiArticles.section);
}

export async function getWikiArticle(businessId: string, slug: string) {
  const [article] = await db
    .select()
    .from(wikiArticles)
    .where(and(eq(wikiArticles.businessId, businessId), eq(wikiArticles.slug, slug)))
    .limit(1);
  return article ?? null;
}

export async function getWikiArticleById(businessId: string, id: number) {
  const [article] = await db
    .select()
    .from(wikiArticles)
    .where(and(eq(wikiArticles.businessId, businessId), eq(wikiArticles.id, id)))
    .limit(1);
  return article ?? null;
}

export async function getWikiArticleVersions(businessId: string, articleId: number) {
  return db
    .select()
    .from(wikiArticleVersions)
    .where(
      and(
        eq(wikiArticleVersions.businessId, businessId),
        eq(wikiArticleVersions.articleId, articleId),
      ),
    )
    .orderBy(desc(wikiArticleVersions.version));
}

export async function updateWikiArticle(
  businessId: string,
  id: number,
  updates: Partial<{ title: string; content: string; section: string | null }>,
) {
  const [updated] = await db
    .update(wikiArticles)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(wikiArticles.businessId, businessId), eq(wikiArticles.id, id)))
    .returning();
  return updated ?? null;
}

export async function deleteWikiArticle(businessId: string, id: number) {
  // Atomic: delete versions + article in a transaction to prevent orphans
  return db.transaction(async (tx) => {
    await tx
      .delete(wikiArticleVersions)
      .where(
        and(
          eq(wikiArticleVersions.businessId, businessId),
          eq(wikiArticleVersions.articleId, id),
        ),
      );

    const [deleted] = await tx
      .delete(wikiArticles)
      .where(and(eq(wikiArticles.businessId, businessId), eq(wikiArticles.id, id)))
      .returning({ id: wikiArticles.id });
    return deleted ?? null;
  });
}

export async function getProjectArchives(businessId: string) {
  return db
    .select()
    .from(projectArchives)
    .where(eq(projectArchives.businessId, businessId))
    .orderBy(desc(projectArchives.createdAt));
}
