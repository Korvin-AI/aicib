import { Hono } from 'hono';
import { getStatus } from '../repositories/status-repo';
import type { TenantContext } from '../types';

const status = new Hono<{ Variables: { tenant: TenantContext } }>();

status.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const data = await getStatus(businessId);
  return c.json(data);
});

export { status };
