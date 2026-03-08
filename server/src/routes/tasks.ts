import { Hono } from 'hono';
import { getTasks, getTask, updateTask } from '../repositories/task-repo';
import { parsePagination } from '../utils/pagination';
import { validateBody } from '../middleware/validate';
import { updateTaskSchema } from '../schemas/tasks';
import { notFoundError } from '../utils/errors';
import { requireRole } from '../middleware/rbac';
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

tasksRoute.get('/:id', async (c) => {
  const { businessId } = c.get('tenant');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw notFoundError('Invalid task ID');

  const data = await getTask(businessId, id);
  if (!data) throw notFoundError('Task not found');

  return c.json(data);
});

tasksRoute.put('/:id', requireRole('member'), validateBody(updateTaskSchema), async (c) => {
  const { businessId } = c.get('tenant');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw notFoundError('Invalid task ID');

  const updates = c.req.valid('json');
  const updated = await updateTask(businessId, id, updates);
  if (!updated) throw notFoundError('Task not found');

  return c.json({ task: updated });
});

export { tasksRoute };
