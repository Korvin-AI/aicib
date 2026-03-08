import { Hono } from 'hono';
import {
  getProjects,
  getProject,
  getProjectPhases,
  updateProject,
} from '../repositories/project-repo';
import { validateBody } from '../middleware/validate';
import { updateProjectSchema } from '../schemas/projects';
import { parsePagination } from '../utils/pagination';
import { notFoundError } from '../utils/errors';
import type { TenantContext } from '../types';

const projectsRoute = new Hono<{ Variables: { tenant: TenantContext } }>();

projectsRoute.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const query = c.req.query();
  const pagination = parsePagination(query, { pageSize: 50, maxPageSize: 200 });
  const data = await getProjects(businessId, pagination);
  return c.json(data);
});

projectsRoute.get('/:id', async (c) => {
  const { businessId } = c.get('tenant');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw notFoundError('Invalid project ID');

  const project = await getProject(businessId, id);
  if (!project) throw notFoundError('Project not found');

  const phases = await getProjectPhases(businessId, project.id);
  return c.json({ project, phases });
});

projectsRoute.put('/:id', validateBody(updateProjectSchema), async (c) => {
  const { businessId } = c.get('tenant');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw notFoundError('Invalid project ID');

  const updates = c.req.valid('json');
  const updated = await updateProject(businessId, id, updates);
  if (!updated) throw notFoundError('Project not found');

  return c.json({ project: updated });
});

export { projectsRoute };
