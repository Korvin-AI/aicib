import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { getPubClient, hasPubClient } from '../realtime/redis';
import { getWorkerStatus } from '../workers/brief-worker';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const health = new Hono();

const startTime = Date.now();

// Read version from package.json at startup
let appVersion = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
  appVersion = pkg.version ?? appVersion;
} catch {
  // Use default version
}

health.get('/health', async (c) => {
  const components: Record<string, Record<string, unknown>> = {};

  // DB check with latency
  let dbOk = false;
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // DB not reachable
  }
  components.db = {
    status: dbOk ? 'ok' : 'unhealthy',
    latencyMs: Date.now() - dbStart,
  };

  // Redis check with latency (avoid creating a connection as side effect)
  let redisStatus: string;
  const redisStart = Date.now();
  if (hasPubClient()) {
    try {
      const redis = getPubClient();
      const pong = await redis.ping();
      redisStatus = pong === 'PONG' ? 'ok' : 'unhealthy';
    } catch {
      redisStatus = 'unhealthy';
    }
  } else {
    redisStatus = 'unknown';
  }
  components.redis = {
    status: redisStatus,
    latencyMs: Date.now() - redisStart,
  };

  // Worker status
  const workerStatus = getWorkerStatus();
  components.worker = {
    status: workerStatus.running ? 'ok' : 'unhealthy',
    activeJobs: workerStatus.activeCount,
  };

  // Memory usage
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  components.memory = {
    status: heapUsedMB < 512 ? 'ok' : 'degraded',
    heapUsedMB,
    rssMB,
  };

  // Overall status: unhealthy if DB down, degraded if Redis/worker down
  const overallStatus = !dbOk
    ? 'unhealthy'
    : redisStatus !== 'ok' || !workerStatus.running || heapUsedMB >= 512
      ? 'degraded'
      : 'ok';

  const uptimeMs = Date.now() - startTime;

  return c.json(
    {
      status: overallStatus,
      version: appVersion,
      uptime: Math.floor(uptimeMs / 1000),
      components,
    },
    overallStatus === 'unhealthy' ? 503 : 200,
  );
});

export { health };
