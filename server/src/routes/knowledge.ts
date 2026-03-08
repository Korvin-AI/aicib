import { Hono } from 'hono';
import {
  getWikiArticles,
  getSections,
  getWikiArticleById,
  getWikiArticleVersions,
  updateWikiArticle,
  deleteWikiArticle,
  getProjectArchives,
} from '../repositories/knowledge-repo';
import { validateBody } from '../middleware/validate';
import { updateArticleSchema } from '../schemas/knowledge';
import { notFoundError, notImplementedError } from '../utils/errors';
import type { TenantContext } from '../types';

const knowledge = new Hono<{ Variables: { tenant: TenantContext } }>();

knowledge.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const type = c.req.query('type') || 'articles';

  if (type === 'archives') {
    const entries = await getProjectArchives(businessId);
    return c.json({ type: 'archives', entries });
  }

  const [entries, sections] = await Promise.all([
    getWikiArticles(businessId, {
      section: c.req.query('section'),
      search: c.req.query('search'),
    }),
    getSections(businessId),
  ]);
  return c.json({ type: 'articles', entries, sections });
});

knowledge.get('/:id', async (c) => {
  const { businessId } = c.get('tenant');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw notFoundError('Invalid article ID');

  const article = await getWikiArticleById(businessId, id);
  if (!article) throw notFoundError('Article not found');

  const versions = await getWikiArticleVersions(businessId, article.id);
  return c.json({ article, versions });
});

knowledge.post('/', async (c) => {
  throw notImplementedError('Knowledge scan requires cloud CLI');
});

knowledge.put('/:id', validateBody(updateArticleSchema), async (c) => {
  const { businessId } = c.get('tenant');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw notFoundError('Invalid article ID');

  const updates = c.req.valid('json');
  const updated = await updateWikiArticle(businessId, id, updates);
  if (!updated) throw notFoundError('Article not found');

  return c.json({ article: updated });
});

knowledge.delete('/:id', async (c) => {
  const { businessId } = c.get('tenant');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw notFoundError('Invalid article ID');

  const deleted = await deleteWikiArticle(businessId, id);
  if (!deleted) throw notFoundError('Article not found');

  return c.json({ success: true });
});

export { knowledge };
