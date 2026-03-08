import { Hono } from 'hono';
import { validateQuery } from '../middleware/validate';
import { exportQuerySchema } from '../schemas/export';
import { buildExportArchive } from '../services/cloud-export';
import type { TenantContext } from '../types';

const exportRoute = new Hono<{ Variables: { tenant: TenantContext } }>();

// GET /export — download business data export
exportRoute.get('/', validateQuery(exportQuerySchema), async (c) => {
  const { businessId } = c.get('tenant');
  const { mode, categories } = c.req.valid('query');

  const categoryList = categories
    ? categories.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const archive = await buildExportArchive({
    businessId,
    mode,
    categories: categoryList,
  });

  return new Response(new Uint8Array(archive), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="export-${businessId.slice(0, 8)}-${Date.now()}.tar.gz"`,
    },
  });
});

export { exportRoute };
