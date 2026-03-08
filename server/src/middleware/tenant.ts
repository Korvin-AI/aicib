import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { businesses } from '../db/schema/index';
import type { AuthContext, TenantContext } from '../types';

type TenantEnv = {
  Variables: {
    auth: AuthContext;
    tenant: TenantContext;
  };
};

export const tenantMiddleware = createMiddleware<TenantEnv>(async (c, next) => {
  const businessId = c.req.param('businessId');
  if (!businessId) {
    return c.json({ error: 'Business ID required', code: 'VALIDATION_ERROR' as const }, 400);
  }

  const auth = c.get('auth');

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business || business.orgId !== auth.orgId) {
    return c.json({ error: 'Business not found', code: 'NOT_FOUND' as const }, 404);
  }

  c.set('tenant', {
    ...auth,
    businessId: business.id,
  });

  return next();
});
