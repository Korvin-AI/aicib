import { Hono } from 'hono';
import { getJournal } from '../repositories/journal-repo';
import type { TenantContext } from '../types';

const journal = new Hono<{ Variables: { tenant: TenantContext } }>();

journal.get('/', async (c) => {
  const query = c.req.query();
  const { businessId } = c.get('tenant');

  const tab = query.tab ?? 'ceo';
  let limit = parseInt(query.limit ?? '50', 10);
  if (isNaN(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  const filters = {
    tab,
    limit,
    agent: query.agent,
    type: query.type,
    status: query.status,
    department: query.department,
  };

  const data = await getJournal(businessId, filters);
  return c.json(data);
});

export { journal };
