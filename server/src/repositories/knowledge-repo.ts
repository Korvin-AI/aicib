import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/connection';
import { wikiArticles, wikiArticleVersions, projectArchives } from '../db/schema/index';

export async function getWikiArticles(businessId: string) {
  return db
    .select()
    .from(wikiArticles)
    .where(eq(wikiArticles.businessId, businessId))
    .orderBy(desc(wikiArticles.updatedAt));
}

export async function getWikiArticle(businessId: string, slug: string) {
  const [article] = await db
    .select()
    .from(wikiArticles)
    .where(and(eq(wikiArticles.businessId, businessId), eq(wikiArticles.slug, slug)))
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

export async function getProjectArchives(businessId: string) {
  return db
    .select()
    .from(projectArchives)
    .where(eq(projectArchives.businessId, businessId))
    .orderBy(desc(projectArchives.createdAt));
}
