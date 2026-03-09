import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { env } from './env';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { tenantMiddleware } from './middleware/tenant';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { requireRole } from './middleware/rbac';
import { rlsMiddleware } from './middleware/rls';
import { health } from './routes/health';
import { auth } from './routes/auth';
import { status } from './routes/status';
import { agents } from './routes/agents';
import { costs } from './routes/costs';
import { tasksRoute } from './routes/tasks';
import { journal } from './routes/journal';
import { brief } from './routes/brief';
import { briefs } from './routes/briefs';
import { channels } from './routes/channels';
import { hr } from './routes/hr';
import { knowledge } from './routes/knowledge';
import { projectsRoute } from './routes/projects';
import { settings } from './routes/settings';
import { setup } from './routes/setup';
import { stream } from './routes/stream';
import { businessesRoute } from './routes/businesses';
import { orgRoute } from './routes/org';
import { daemonRoute } from './routes/daemon';
import { storageRoute } from './routes/storage';
import { exportRoute } from './routes/export';
import { startBriefWorker, closeBriefQueue } from './workers/brief-worker';
import { closeRedis } from './realtime/redis';
import { runMigrations } from './db/migrate';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.onError(errorHandler);

// Public routes
app.route('/', health);
app.route('/', auth);

// Org-scoped routes (auth + rate-limit, no tenant)
const orgRoutes = new Hono();
orgRoutes.use('*', authMiddleware);
orgRoutes.use('*', rateLimitMiddleware);
orgRoutes.route('/businesses', businessesRoute);
orgRoutes.route('/org', orgRoute);
orgRoutes.route('/daemon', daemonRoute);
app.route('/', orgRoutes);

// Protected business routes (auth + tenant + rate-limit)
const businessRoutes = new Hono();
businessRoutes.use('*', authMiddleware);
businessRoutes.use('*', tenantMiddleware);
businessRoutes.use('*', rateLimitMiddleware);

// RLS middleware — excluded for SSE streaming routes (long-lived connections)
businessRoutes.use('/status/*', rlsMiddleware);
businessRoutes.use('/agents/*', rlsMiddleware);
businessRoutes.use('/costs/*', rlsMiddleware);
businessRoutes.use('/tasks/*', rlsMiddleware);
businessRoutes.use('/journal/*', rlsMiddleware);
businessRoutes.use('/brief/*', rlsMiddleware);
businessRoutes.use('/briefs/*', rlsMiddleware);
businessRoutes.use('/channels/*', rlsMiddleware);
businessRoutes.use('/hr/*', rlsMiddleware);
businessRoutes.use('/knowledge/*', rlsMiddleware);
businessRoutes.use('/projects/*', rlsMiddleware);
businessRoutes.use('/settings/*', rlsMiddleware);
businessRoutes.use('/setup/*', rlsMiddleware);
businessRoutes.use('/storage/*', rlsMiddleware);
businessRoutes.use('/export/*', rlsMiddleware);

// RBAC: member+ required for brief submission
businessRoutes.use('/brief/*', requireRole('member'));

// RBAC: admin+ required for admin routes (settings RBAC is inline on PUT/DELETE)
businessRoutes.use('/setup/*', requireRole('admin'));
businessRoutes.use('/export/*', requireRole('admin'));

// Mount all routes
businessRoutes.route('/status', status);
businessRoutes.route('/agents', agents);
businessRoutes.route('/costs', costs);
businessRoutes.route('/tasks', tasksRoute);
businessRoutes.route('/journal', journal);
businessRoutes.route('/brief', brief);
businessRoutes.route('/briefs', briefs);
businessRoutes.route('/channels', channels);
businessRoutes.route('/hr', hr);
businessRoutes.route('/knowledge', knowledge);
businessRoutes.route('/projects', projectsRoute);
businessRoutes.route('/settings', settings);
businessRoutes.route('/setup', setup);
businessRoutes.route('/stream', stream);
businessRoutes.route('/storage', storageRoute);
businessRoutes.route('/export', exportRoute);

app.route('/businesses/:businessId', businessRoutes);

// Start server
async function main() {
  try {
    await runMigrations();
  } catch (err) {
    if (env.NODE_ENV === 'production') {
      console.error('Migration failed:', (err as Error).message);
      process.exit(1);
    }
    console.warn('Migration warning:', (err as Error).message);
    console.warn('Server will start, but DB may not be fully set up.');
  }

  const worker = await startBriefWorker();

  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      console.log(`AICIB API server running on http://localhost:${info.port}`);
    },
  );

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await worker.close();
    await closeBriefQueue();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
