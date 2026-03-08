import { Hono } from 'hono';
import { getAgentDetail } from '../repositories/agent-repo';
import type { TenantContext } from '../types';

const agents = new Hono<{ Variables: { tenant: TenantContext } }>();

agents.get('/:role', async (c) => {
  const { businessId } = c.get('tenant');
  const role = c.req.param('role');
  const data = await getAgentDetail(businessId, role);
  return c.json(data);
});

export { agents };
