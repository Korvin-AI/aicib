import { Hono } from 'hono';
import { getSettings } from '../repositories/settings-repo';
import { updateBusinessConfig } from '../repositories/business-repo';
import { validateBody } from '../middleware/validate';
import { updateSettingsSchema } from '../schemas/settings';
import type { TenantContext } from '../types';

const settings = new Hono<{ Variables: { tenant: TenantContext } }>();

settings.get('/', async (c) => {
  const { businessId } = c.get('tenant');
  const data = await getSettings(businessId);
  return c.json(data);
});

settings.put('/', validateBody(updateSettingsSchema), async (c) => {
  const { businessId } = c.get('tenant');
  const { config } = c.req.valid('json');

  if (config) {
    await updateBusinessConfig(businessId, config);
  }

  const data = await getSettings(businessId);
  return c.json(data);
});

export { settings };
