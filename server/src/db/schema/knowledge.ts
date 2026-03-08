import {
  pgTable,
  varchar,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  bigserial,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenantCols } from './helpers';

// --- wiki_articles ---
export const wikiArticles = pgTable('wiki_articles', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  slug: varchar('slug', { length: 255 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  section: varchar('section', { length: 255 }),
  content: text('content'),
  version: integer('version').default(1),
  createdBy: varchar('created_by', { length: 100 }),
  updatedBy: varchar('updated_by', { length: 100 }),
  sessionId: varchar('session_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('wiki_articles_business_slug_idx').on(t.businessId, t.slug),
]);

// --- wiki_article_versions ---
export const wikiArticleVersions = pgTable('wiki_article_versions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  articleId: integer('article_id').notNull(),
  version: integer('version').notNull(),
  title: varchar('title', { length: 500 }),
  content: text('content'),
  editedBy: varchar('edited_by', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('wiki_versions_article_version_idx').on(t.articleId, t.version),
]);

// --- project_archives ---
export const projectArchives = pgTable('project_archives', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ...tenantCols(),
  projectName: varchar('project_name', { length: 500 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }),
  deliverables: jsonb('deliverables'),
  lessonsLearned: text('lessons_learned'),
  totalCostUsd: doublePrecision('total_cost_usd'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: varchar('created_by', { length: 100 }),
  sessionId: varchar('session_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
