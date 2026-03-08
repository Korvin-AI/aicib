import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { agentStatus, costEntries, backgroundLogs, tasks } from '../db/schema/index';
import { createHash } from 'node:crypto';
import type { TenantContext } from '../types';

const stream = new Hono<{ Variables: { tenant: TenantContext } }>();

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30_000;

function hashJson(data: unknown): string {
  return createHash('md5').update(JSON.stringify(data)).digest('hex');
}

stream.get('/', async (c) => {
  const { businessId } = c.get('tenant');

  return streamSSE(c, async (sseStream) => {
    let lastAgentHash = '';
    let lastCostTotal = -1;
    let lastLogId = 0;
    let lastTaskUpdated = '';
    let aborted = false;
    let lastHeartbeat = Date.now();

    sseStream.onAbort(() => {
      aborted = true;
    });

    // Write unnamed SSE event with { type, data } envelope (matches UI's es.onmessage contract)
    const sendEvent = async (type: string, data: unknown) => {
      await sseStream.writeSSE({
        data: JSON.stringify({ type, data }),
      });
    };

    // Send connected event
    await sendEvent('connected', { timestamp: new Date().toISOString() });

    // Awaited poll loop (prevents overlap vs setInterval)
    while (!aborted) {
      // Agent status (ORDER BY agent_role for stable hash)
      try {
        const agents = await db
          .select()
          .from(agentStatus)
          .where(eq(agentStatus.businessId, businessId))
          .orderBy(agentStatus.agentRole);
        const agentHash = hashJson(agents);
        if (agentHash !== lastAgentHash) {
          lastAgentHash = agentHash;
          await sendEvent('agent_status', agents);
        }
      } catch (err) {
        if (!aborted) console.error('SSE agent_status poll error:', err);
      }

      // Cost total for today (UTC midnight)
      try {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const [costRow] = await db
          .select({
            total: sql<number>`COALESCE(SUM(${costEntries.estimatedCostUsd}), 0)`,
          })
          .from(costEntries)
          .where(
            sql`${costEntries.businessId} = ${businessId} AND ${costEntries.timestamp} >= ${today}`,
          );
        const costTotal = costRow?.total ?? 0;
        if (costTotal !== lastCostTotal) {
          lastCostTotal = costTotal;
          await sendEvent('cost_update', { today: costTotal });
        }
      } catch (err) {
        if (!aborted) console.error('SSE cost_update poll error:', err);
      }

      // New logs — send actual log rows (up to 50) matching UI contract
      try {
        const newLogs = await db
          .select()
          .from(backgroundLogs)
          .where(
            sql`${backgroundLogs.businessId} = ${businessId} AND ${backgroundLogs.id} > ${lastLogId}`,
          )
          .orderBy(backgroundLogs.id)
          .limit(50);
        if (newLogs.length > 0) {
          lastLogId = newLogs[newLogs.length - 1].id;
          await sendEvent('new_logs', newLogs);
        }
      } catch (err) {
        if (!aborted) console.error('SSE new_logs poll error:', err);
      }

      // Task updates
      try {
        const [taskRow] = await db
          .select({
            maxUpdated: sql<string>`COALESCE(MAX(${tasks.updatedAt})::text, '')`,
          })
          .from(tasks)
          .where(eq(tasks.businessId, businessId));
        const taskUpdated = taskRow?.maxUpdated ?? '';
        if (taskUpdated !== lastTaskUpdated) {
          lastTaskUpdated = taskUpdated;
          await sendEvent('task_update', { maxUpdated: taskUpdated });
        }
      } catch (err) {
        if (!aborted) console.error('SSE task_update poll error:', err);
      }

      // Heartbeat (SSE comment keeps connection alive)
      const now = Date.now();
      if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        try {
          await sseStream.write(':\n\n');
        } catch {
          // Connection closed
        }
        lastHeartbeat = now;
      }

      // Wait before next poll
      if (!aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  });
});

export { stream };
