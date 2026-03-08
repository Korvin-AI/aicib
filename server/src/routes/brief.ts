import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { backgroundJobs, sessions } from '../db/schema/index';
import { validateBody } from '../middleware/validate';
import { briefBodySchema } from '../schemas/brief';
import { conflictError } from '../utils/errors';
import type { TenantContext } from '../types';

const brief = new Hono<{ Variables: { tenant: TenantContext } }>();

brief.post('/', validateBody(briefBodySchema), async (c) => {
  const { orgId, businessId } = c.get('tenant');
  const { directive } = c.req.valid('json');

  // Check for active session
  const [activeSession] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.businessId, businessId), eq(sessions.status, 'active')))
    .limit(1);

  if (!activeSession) {
    throw conflictError('No active session. Start the business first.');
  }

  // Atomic insert — prevents TOCTOU race condition; checks both queued + running
  const result = await db.execute(
    sql`INSERT INTO background_jobs (org_id, business_id, session_id, directive, status)
        SELECT ${orgId}, ${businessId}, ${activeSession.id}, ${directive}, 'queued'
        WHERE NOT EXISTS (
          SELECT 1 FROM background_jobs
          WHERE business_id = ${businessId}
          AND status IN ('queued', 'running')
        )
        RETURNING id`,
  );

  if (!result.length) {
    throw conflictError('A job is already queued or running. Wait for it to complete.');
  }

  // bigserial may return BigInt from raw db.execute(); coerce to number for JSON safety
  return c.json({ success: true, jobId: Number((result[0] as { id: unknown }).id) }, 201);
});

export { brief };
