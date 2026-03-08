import { createMiddleware } from 'hono/factory';
import type { AuthContext } from '../types';
import { getOrgPlan } from '../repositories/org-repo';

type RateLimitEnv = {
  Variables: {
    auth: AuthContext;
  };
};

const PLAN_LIMITS: Record<string, number> = {
  free: 60,
  pro: 300,
  team: 1000,
  enterprise: 5000,
};

const WINDOW_MS = 60_000; // 1 minute

// In-memory sliding window: orgId -> timestamp[]
const windows = new Map<string, number[]>();

// Periodic cleanup to prevent memory leaks from expired entries
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  for (const [orgId, timestamps] of windows) {
    const pruned = timestamps.filter((t) => t >= cutoff);
    if (pruned.length === 0) windows.delete(orgId);
    else windows.set(orgId, pruned);
  }
}, 5 * 60_000);
cleanupTimer.unref();

function pruneWindow(timestamps: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  // Find first index that's within window
  let i = 0;
  while (i < timestamps.length && timestamps[i] < cutoff) i++;
  return i > 0 ? timestamps.slice(i) : timestamps;
}

export const rateLimitMiddleware = createMiddleware<RateLimitEnv>(async (c, next) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  const now = Date.now();

  const plan = await getOrgPlan(orgId);
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  let timestamps = windows.get(orgId) ?? [];
  timestamps = pruneWindow(timestamps, now);

  const remaining = Math.max(0, limit - timestamps.length);
  const reset = Math.ceil((now + WINDOW_MS) / 1000);

  c.header('X-RateLimit-Limit', String(limit));
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(reset));

  if (timestamps.length >= limit) {
    return c.json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED' as const },
      429,
    );
  }

  timestamps.push(now);
  windows.set(orgId, timestamps);

  await next();
});
