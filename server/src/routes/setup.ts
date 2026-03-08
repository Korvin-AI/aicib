import { Hono } from 'hono';
import {
  findBusinessesByOrg,
  createBusiness,
  getActiveSession,
  createSession,
} from '../repositories/business-repo';
import { validateBody } from '../middleware/validate';
import { initSetupSchema, startSetupSchema } from '../schemas/setup';
import type { TenantContext } from '../types';

const setup = new Hono<{ Variables: { tenant: TenantContext } }>();

setup.get('/status', async (c) => {
  const { orgId, businessId } = c.get('tenant');
  const businesses = await findBusinessesByOrg(orgId);
  const activeSession = await getActiveSession(businessId);

  return c.json({
    hasBusinesses: businesses.length > 0,
    businessCount: businesses.length,
    hasActiveSession: !!activeSession,
    activeSessionId: activeSession?.id ?? null,
  });
});

setup.get('/templates', async (c) => {
  return c.json({
    templates: [
      { id: 'default', name: 'Default', description: 'Standard AI company setup' },
      { id: 'startup', name: 'Startup', description: 'Lean startup configuration' },
      { id: 'agency', name: 'Agency', description: 'Digital agency setup' },
      { id: 'saas', name: 'SaaS', description: 'SaaS company configuration' },
    ],
  });
});

setup.post('/init', validateBody(initSetupSchema), async (c) => {
  const { orgId } = c.get('tenant');
  const body = c.req.valid('json');
  const biz = await createBusiness(orgId, body);
  return c.json({ success: true, business: biz }, 201);
});

setup.post('/start', validateBody(startSetupSchema), async (c) => {
  const { orgId, businessId } = c.get('tenant');
  const { sessionId } = c.req.valid('json');
  const session = await createSession(businessId, orgId, sessionId);
  return c.json({ success: true, session });
});

export { setup };
