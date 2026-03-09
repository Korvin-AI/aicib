import { Hono } from 'hono';
import { z } from 'zod';
import { getSettings } from '../repositories/settings-repo';
import { updateBusinessConfig, updateBusinessExecutionMode } from '../repositories/business-repo';
import { setOrgSecret, deleteOrgSecret, listOrgSecretKeys } from '../repositories/secrets-repo';
import { validateBody } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';
import { updateSettingsSchema } from '../schemas/settings';
import type { TenantContext } from '../types';

const settings = new Hono<{ Variables: { tenant: TenantContext } }>();

settings.get('/', async (c) => {
  const { businessId, orgId } = c.get('tenant');
  const data = await getSettings(businessId);

  // Check key existence without decryption — never expose plaintext on reads
  let hasApiKey = false;
  try {
    const keys = await listOrgSecretKeys(orgId);
    hasApiKey = keys.includes('anthropic_api_key');
  } catch {
    // Encryption key not configured — skip
  }

  return c.json({
    ...data,
    engine: { hasApiKey, maskedKey: hasApiKey ? 'sk-ant-•••••••' : undefined },
  });
});

settings.put('/', requireRole('admin'), validateBody(updateSettingsSchema), async (c) => {
  const { businessId } = c.get('tenant');
  const { config } = c.req.valid('json');

  if (config) {
    await updateBusinessConfig(businessId, config);
  }

  const data = await getSettings(businessId);
  return c.json(data);
});

// PUT /settings/anthropic-key — store per-org Anthropic key
settings.put(
  '/anthropic-key',
  requireRole('admin'),
  validateBody(z.object({ apiKey: z.string().min(1) })),
  async (c) => {
    const { orgId } = c.get('tenant');
    const { apiKey } = c.req.valid('json');

    await setOrgSecret(orgId, 'anthropic_api_key', apiKey);
    const prefix = apiKey.slice(0, 7) + '...';
    return c.json({ success: true, prefix });
  },
);

// PUT /settings/execution-mode — toggle cloud/local execution mode
settings.put(
  '/execution-mode',
  requireRole('admin'),
  validateBody(z.object({ executionMode: z.enum(['cloud', 'local']) })),
  async (c) => {
    const { businessId } = c.get('tenant');
    const { executionMode } = c.req.valid('json');

    await updateBusinessExecutionMode(businessId, executionMode);
    return c.json({ executionMode });
  },
);

// DELETE /settings/anthropic-key — remove per-org key
settings.delete('/anthropic-key', requireRole('admin'), async (c) => {
  const { orgId } = c.get('tenant');
  await deleteOrgSecret(orgId, 'anthropic_api_key');
  return c.json({ success: true });
});

export { settings };
