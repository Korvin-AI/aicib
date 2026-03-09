import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  businesses,
  backgroundJobs,
  backgroundLogs,
  agentStatus,
  costEntries,
} from '../db/schema/index';
import { tenantValues } from '../repositories/tenant-helpers';
import { publish } from '../realtime/publisher';
import { validateBody } from '../middleware/validate';
import type { AuthContext } from '../types';

const daemonRoute = new Hono<{ Variables: { auth: AuthContext } }>();

// ---------------------------------------------------------------------------
// POST /daemon/briefs/claim — Poll for next queued job (single-concurrency)
// ---------------------------------------------------------------------------

daemonRoute.post('/briefs/claim', async (c) => {
  const { orgId } = c.get('auth');

  // Atomically claim one queued job from a business with executionMode='local'
  const result = await db.execute(sql`
    UPDATE background_jobs
    SET status = 'claimed', started_at = NOW()
    WHERE id = (
      SELECT bj.id
      FROM background_jobs bj
      JOIN businesses b ON b.id = bj.business_id
      WHERE bj.status = 'queued'
        AND b.execution_mode = 'local'
        AND b.org_id = ${orgId}
      ORDER BY bj.id ASC
      LIMIT 1
      FOR UPDATE OF bj SKIP LOCKED
    )
    RETURNING
      id,
      business_id,
      org_id,
      session_id,
      directive
  `);

  if (!result.length) {
    return c.json({ job: null });
  }

  const job = result[0] as {
    id: unknown;
    business_id: string;
    org_id: string;
    session_id: string;
    directive: string;
  };

  // Load business details for the daemon
  const [business] = await db
    .select({
      name: businesses.name,
      config: businesses.config,
      agentDefinitions: businesses.agentDefinitions,
    })
    .from(businesses)
    .where(eq(businesses.id, String(job.business_id)))
    .limit(1);

  const config = (business?.config ?? {}) as Record<string, any>;
  const companyName = config.company?.name ?? business?.name ?? 'Company';
  const costLimitDaily = config.settings?.costLimitDaily ?? 10;

  // Fresh SDK session ID per brief
  const sdkSessionId = `sdk-${crypto.randomUUID()}`;

  return c.json({
    job: {
      jobId: Number(job.id),
      businessId: job.business_id,
      orgId: job.org_id,
      sessionId: job.session_id,
      sdkSessionId,
      directive: job.directive,
      companyName,
      costLimitDaily,
      agentDefinitions: business?.agentDefinitions ?? [],
    },
  });
});

// ---------------------------------------------------------------------------
// POST /daemon/briefs/:id/messages — Batch message streaming
// ---------------------------------------------------------------------------

const messagesSchema = z.object({
  messages: z.array(
    z.object({
      type: z.string(),
      role: z.string(),
      content: z.string(),
    }),
  ),
  agentStatuses: z
    .array(
      z.object({
        role: z.string(),
        status: z.string(),
        task: z.string().optional(),
      }),
    )
    .optional(),
});

daemonRoute.post(
  '/briefs/:id/messages',
  validateBody(messagesSchema),
  async (c) => {
    const { orgId } = c.get('auth');
    const jobId = Number(c.req.param('id'));

    if (isNaN(jobId)) {
      return c.json({ error: 'Invalid job ID' }, 400);
    }

    // Verify job belongs to daemon's org and is still claimed
    const [job] = await db
      .select({ id: backgroundJobs.id, businessId: backgroundJobs.businessId })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.orgId, orgId),
          eq(backgroundJobs.status, 'claimed'),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: 'Job not found or not in claimed state' }, 409);
    }

    const { messages, agentStatuses } = c.req.valid('json');

    // Insert log messages + publish
    const logPromises = messages.map(async (msg) => {
      const [row] = await db
        .insert(backgroundLogs)
        .values({
          ...tenantValues(orgId, job.businessId),
          jobId,
          messageType: msg.type,
          agentRole: msg.role,
          content: msg.content,
        })
        .returning();

      await publish(job.businessId, jobId, {
        type: 'new_logs',
        data: row,
      });
    });

    // Upsert agent statuses + publish
    const statusPromises = (agentStatuses ?? []).map(async (as) => {
      await db
        .insert(agentStatus)
        .values({
          agentRole: as.role,
          ...tenantValues(orgId, job.businessId),
          status: as.status,
          lastActivity: new Date(),
          currentTask: as.task ?? null,
        })
        .onConflictDoUpdate({
          target: [agentStatus.businessId, agentStatus.agentRole],
          set: {
            status: as.status,
            lastActivity: new Date(),
            currentTask: as.task ?? null,
          },
        });

      await publish(job.businessId, jobId, {
        type: 'agent_status',
        data: { role: as.role, status: as.status, task: as.task ?? null },
      });
    });

    try {
      await Promise.all([...logPromises, ...statusPromises]);
    } catch (err) {
      console.error('Daemon message write error:', (err as Error).message);
      return c.json({ error: 'Failed to write messages' }, 500);
    }

    return c.json({ ok: true }, 202);
  },
);

// ---------------------------------------------------------------------------
// POST /daemon/briefs/:id/result — Final result
// ---------------------------------------------------------------------------

const resultSchema = z.object({
  status: z.enum(['completed', 'failed']),
  totalCostUsd: z.number().optional(),
  numTurns: z.number().optional(),
  durationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  resultSummary: z.string().optional(),
  costEntries: z
    .array(
      z.object({
        role: z.string(),
        sessionId: z.string(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        costUsd: z.number(),
      }),
    )
    .optional(),
});

daemonRoute.post(
  '/briefs/:id/result',
  validateBody(resultSchema),
  async (c) => {
    const { orgId } = c.get('auth');
    const jobId = Number(c.req.param('id'));

    if (isNaN(jobId)) {
      return c.json({ error: 'Invalid job ID' }, 400);
    }

    // Verify job belongs to daemon's org and is still claimed
    const [job] = await db
      .select({ id: backgroundJobs.id, businessId: backgroundJobs.businessId })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.id, jobId),
          eq(backgroundJobs.orgId, orgId),
          eq(backgroundJobs.status, 'claimed'),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: 'Job not found or not in claimed state' }, 409);
    }

    const data = c.req.valid('json');

    // Update background_jobs row
    await db
      .update(backgroundJobs)
      .set({
        status: data.status,
        completedAt: new Date(),
        totalCostUsd: data.totalCostUsd ?? null,
        numTurns: data.numTurns ?? null,
        durationMs: data.durationMs ?? null,
        errorMessage: data.errorMessage ?? null,
        resultSummary: data.resultSummary ?? null,
      })
      .where(eq(backgroundJobs.id, jobId));

    // Insert cost entries
    if (data.costEntries && data.costEntries.length > 0) {
      await db.insert(costEntries).values(
        data.costEntries.map((ce) => ({
          ...tenantValues(orgId, job.businessId),
          agentRole: ce.role,
          sessionId: ce.sessionId,
          inputTokens: ce.inputTokens,
          outputTokens: ce.outputTokens,
          estimatedCostUsd: ce.costUsd,
        })),
      );
    }

    // Set all agent statuses to 'idle'
    await db
      .update(agentStatus)
      .set({ status: 'idle', currentTask: null, lastActivity: new Date() })
      .where(eq(agentStatus.businessId, job.businessId));

    // Publish final events
    await publish(job.businessId, jobId, {
      type: 'job_status',
      data: {
        jobId,
        status: data.status,
        totalCostUsd: data.totalCostUsd,
        errorMessage: data.errorMessage,
      },
    });

    await publish(job.businessId, jobId, {
      type: 'agent_status',
      data: { role: 'ceo', status: 'idle', task: null },
    });

    return c.json({ ok: true });
  },
);

export { daemonRoute };
