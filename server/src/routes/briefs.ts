import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  businesses,
  sessions,
  sessionData,
  backgroundJobs,
  backgroundLogs,
} from '../db/schema/index';
import { tenantValues } from '../repositories/tenant-helpers';
import { getBriefQueue } from '../workers/brief-worker';
import { createSSEStream } from '../realtime/sse-handler';
import { jobChannel } from '../realtime/redis';
import { requireRole } from '../middleware/rbac';
import type { TenantContext } from '../types';

const briefs = new Hono<{ Variables: { tenant: TenantContext } }>();

const submitSchema = z.object({
  directive: z.string().min(1).max(50_000),
});

// POST / — Submit a brief (member+)
briefs.post('/', requireRole('member'), async (c) => {
  const { orgId, businessId } = c.get('tenant');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid directive', details: parsed.error.issues }, 400);
  }
  const { directive } = parsed.data;

  // Load business
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    return c.json({ error: 'Business not found' }, 404);
  }

  const config = (business.config ?? {}) as Record<string, any>;
  const agentDefs = business.agentDefinitions ?? [];
  const companyName = config.company?.name ?? business.name ?? 'Company';
  const costLimitDaily = config.settings?.costLimitDaily ?? 10;

  // Find or create active session
  let [activeSession] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.businessId, businessId))
    .orderBy(desc(sessions.startedAt))
    .limit(1);

  if (!activeSession) {
    const sessionId = `session-${Date.now()}`;
    [activeSession] = await db
      .insert(sessions)
      .values({
        id: sessionId,
        ...tenantValues(orgId, businessId),
        status: 'active',
      })
      .returning();
  }

  // Find or create sessionData
  let [sd] = await db
    .select()
    .from(sessionData)
    .where(eq(sessionData.sessionId, activeSession.id))
    .limit(1);

  if (!sd) {
    const sdkSessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    [sd] = await db
      .insert(sessionData)
      .values({
        sessionId: activeSession.id,
        ...tenantValues(orgId, businessId),
        sdkSessionId,
        companyName,
      })
      .returning();
  }

  // Fresh SDK session ID per brief — prevents two briefs from resuming the same conversation
  const briefSdkSessionId = `sdk-${crypto.randomUUID()}`;

  // Insert background job
  const [job] = await db
    .insert(backgroundJobs)
    .values({
      ...tenantValues(orgId, businessId),
      sessionId: activeSession.id,
      directive,
      status: 'queued',
    })
    .returning();

  // Enqueue BullMQ job — mark failed if enqueue fails
  try {
    await getBriefQueue().add('brief', {
      jobId: job.id,
      businessId,
      orgId,
      sessionId: activeSession.id,
      sdkSessionId: briefSdkSessionId,
      directive,
      companyName,
      costLimitDaily,
      agentDefinitions: agentDefs,
    });
  } catch (err) {
    await db.update(backgroundJobs)
      .set({ status: 'failed', errorMessage: 'Failed to enqueue: ' + String(err) })
      .where(eq(backgroundJobs.id, job.id));
    return c.json({ error: 'Failed to queue brief' }, 500);
  }

  return c.json({ jobId: job.id, status: 'queued' }, 202);
});

// GET /:id — Get job status
briefs.get('/:id', async (c) => {
  const { businessId } = c.get('tenant');
  const jobId = Number(c.req.param('id'));

  if (isNaN(jobId)) {
    return c.json({ error: 'Invalid job ID' }, 400);
  }

  const [job] = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.businessId, businessId)))
    .limit(1);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const logs = await db
    .select()
    .from(backgroundLogs)
    .where(and(eq(backgroundLogs.jobId, jobId), eq(backgroundLogs.businessId, businessId)))
    .orderBy(desc(backgroundLogs.id))
    .limit(50);

  return c.json({ job, logs });
});

// GET /:id/stream — SSE for a specific brief
briefs.get('/:id/stream', async (c) => {
  const { businessId } = c.get('tenant');
  const jobId = Number(c.req.param('id'));

  if (isNaN(jobId)) {
    return c.json({ error: 'Invalid job ID' }, 400);
  }

  // Verify job exists and belongs to this business
  const [job] = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.businessId, businessId)))
    .limit(1);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  return createSSEStream(
    c,
    [jobChannel(businessId, jobId)],
    async () => ({
      type: 'job_status',
      data: { jobId: job.id, status: job.status, directive: job.directive },
    }),
  );
});

export { briefs };
