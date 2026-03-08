import { Hono } from 'hono';
import {
  getHROverview,
  getHRReviews,
  getHROnboarding,
  getHRPlans,
} from '../repositories/hr-repo';
import type { TenantContext } from '../types';

const hr = new Hono<{ Variables: { tenant: TenantContext } }>();

hr.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const tab = c.req.query('tab') || 'overview';

  switch (tab) {
    case 'overview': {
      const data = await getHROverview(businessId);
      return c.json(data);
    }
    case 'reviews': {
      const data = await getHRReviews(businessId, {
        agentRole: c.req.query('agentRole'),
        reviewType: c.req.query('reviewType'),
      });
      return c.json(data);
    }
    case 'onboarding': {
      const data = await getHROnboarding(businessId);
      return c.json({ onboarding: data });
    }
    case 'plans': {
      const data = await getHRPlans(businessId, c.req.query('status'));
      return c.json({ plans: data });
    }
    default:
      return c.json({ error: 'Invalid tab', code: 'VALIDATION_ERROR' }, 400);
  }
});

export { hr };
