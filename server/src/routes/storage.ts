import { Hono } from 'hono';
import { validateQuery } from '../middleware/validate';
import { listStorageSchema } from '../schemas/storage';
import { listStorageObjects, getDeliverableUrl } from '../storage/storage-service';
import { notFoundError } from '../utils/errors';
import type { TenantContext } from '../types';

const storageRoute = new Hono<{ Variables: { tenant: TenantContext } }>();

// GET /storage — list storage objects
storageRoute.get('/', validateQuery(listStorageSchema), async (c) => {
  const { businessId, orgId } = c.get('tenant');
  const { category, jobId } = c.req.valid('query');
  const objects = await listStorageObjects(orgId, businessId, category, jobId);
  return c.json({ objects });
});

// GET /storage/:objectId/download — redirect to presigned URL
storageRoute.get('/:objectId/download', async (c) => {
  const { businessId, orgId } = c.get('tenant');
  const objectId = c.req.param('objectId');
  const url = await getDeliverableUrl(objectId, orgId, businessId);
  if (!url) throw notFoundError('Storage object not found');
  return c.redirect(url, 302);
});

export { storageRoute };
