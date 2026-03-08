import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection';

const health = new Hono();

const startTime = Date.now();

health.get('/health', async (c) => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // DB not reachable
  }

  const uptimeMs = Date.now() - startTime;

  return c.json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    uptime: Math.floor(uptimeMs / 1000),
  });
});

export { health };
