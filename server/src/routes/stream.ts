import { Hono } from 'hono';
import { getStatus } from '../repositories/status-repo';
import { createSSEStream } from '../realtime/sse-handler';
import { businessChannel } from '../realtime/redis';
import type { TenantContext } from '../types';

const stream = new Hono<{ Variables: { tenant: TenantContext } }>();

// GET / — Dashboard-level SSE stream for all business events
stream.get('/', async (c) => {
  const { businessId } = c.get('tenant');

  return createSSEStream(
    c,
    [businessChannel(businessId)],
    async () => {
      const snapshot = await getStatus(businessId);
      return { type: 'job_status', data: snapshot };
    },
  );
});

export { stream };
