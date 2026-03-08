import { Hono } from 'hono';
import { getTasks } from '../repositories/task-repo';
import { parsePagination } from '../utils/pagination';
import type { TenantContext } from '../types';

const tasksRoute = new Hono<{ Variables: { tenant: TenantContext } }>();

tasksRoute.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const query = c.req.query();

  const filters = {
    status: query.status ?? 'all',
    priority: query.priority ?? 'all',
    assignee: query.assignee ?? 'all',
    department: query.department ?? 'all',
    project: query.project ?? 'all',
  };

  const pagination = parsePagination(query, {
    pageSize: 50,
    maxPageSize: 200,
  });

  const data = await getTasks(businessId, filters, pagination);
  return c.json(data);
});

export { tasksRoute };
