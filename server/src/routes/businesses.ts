import { Hono } from 'hono';
import {
  findBusinessesByOrg,
  createBusiness,
  deleteBusiness,
} from '../repositories/business-repo';
import { validateBody } from '../middleware/validate';
import {
  createBusinessSchema,
  deleteBusinessSchema,
  selectBusinessSchema,
} from '../schemas/businesses';
import { notFoundError } from '../utils/errors';
import type { AuthContext } from '../types';

// Org-scoped routes — no tenantMiddleware, just authMiddleware
const businessesRoute = new Hono<{ Variables: { auth: AuthContext } }>();

businessesRoute.get('/', async (c) => {
  const { orgId } = c.get('auth');
  const data = await findBusinessesByOrg(orgId);
  return c.json({ businesses: data });
});

businessesRoute.post('/', validateBody(createBusinessSchema), async (c) => {
  const { orgId } = c.get('auth');
  const body = c.req.valid('json');
  const biz = await createBusiness(orgId, body);
  return c.json({ success: true, business: biz }, 201);
});

businessesRoute.post('/delete', validateBody(deleteBusinessSchema), async (c) => {
  const { orgId } = c.get('auth');
  const { businessId } = c.req.valid('json');
  const deleted = await deleteBusiness(orgId, businessId);
  if (!deleted) throw notFoundError('Business not found');
  return c.json({ success: true });
});

businessesRoute.post('/select', validateBody(selectBusinessSchema), async (c) => {
  // Cloud stub — selection is handled client-side via URL
  return c.json({ success: true });
});

businessesRoute.post('/start', async (c) => {
  // Cloud stub — engine start is handled by cloud orchestration
  return c.json({ success: true });
});

businessesRoute.post('/stop', async (c) => {
  // Cloud stub — engine stop is handled by cloud orchestration
  return c.json({ success: true });
});

export { businessesRoute };
