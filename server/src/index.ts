import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { env } from './env';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { tenantMiddleware } from './middleware/tenant';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { health } from './routes/health';
import { auth } from './routes/auth';
import { status } from './routes/status';
import { agents } from './routes/agents';
import { costs } from './routes/costs';
import { tasksRoute } from './routes/tasks';
import { journal } from './routes/journal';
import { brief } from './routes/brief';
import { channels } from './routes/channels';
import { hr } from './routes/hr';
import { knowledge } from './routes/knowledge';
import { projectsRoute } from './routes/projects';
import { settings } from './routes/settings';
import { setup } from './routes/setup';
import { stream } from './routes/stream';
import { businessesRoute } from './routes/businesses';
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

// Org-scoped routes (auth only, no tenant)
const orgRoutes = new Hono();
orgRoutes.use('*', authMiddleware);
orgRoutes.use('*', rateLimitMiddleware);
orgRoutes.route('/businesses', businessesRoute);
app.route('/', orgRoutes);

// Protected business routes (auth + tenant)
const businessRoutes = new Hono();
businessRoutes.use('*', authMiddleware);
businessRoutes.use('*', tenantMiddleware);
businessRoutes.use('*', rateLimitMiddleware);

businessRoutes.route('/status', status);
businessRoutes.route('/agents', agents);
businessRoutes.route('/costs', costs);
businessRoutes.route('/tasks', tasksRoute);
businessRoutes.route('/journal', journal);
businessRoutes.route('/brief', brief);
businessRoutes.route('/channels', channels);
businessRoutes.route('/hr', hr);
businessRoutes.route('/knowledge', knowledge);
businessRoutes.route('/projects', projectsRoute);
businessRoutes.route('/settings', settings);
businessRoutes.route('/setup', setup);
businessRoutes.route('/stream', stream);

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

  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      console.log(`AICIB API server running on http://localhost:${info.port}`);
    },
  );
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
