import { Hono } from 'hono';
import { getCosts } from '../repositories/cost-repo';
import { parsePagination } from '../utils/pagination';
import type { TenantContext } from '../types';

const costs = new Hono<{ Variables: { tenant: TenantContext } }>();

costs.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const pagination = parsePagination(c.req.query(), {
    pageSize: 50,
    maxPageSize: 200,
  });
  const data = await getCosts(businessId, pagination);
  return c.json(data);
});

export { costs };
