import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { env } from './env';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { tenantMiddleware } from './middleware/tenant';
import { health } from './routes/health';
import { auth } from './routes/auth';
import { status } from './routes/status';
import { agents } from './routes/agents';
import { costs } from './routes/costs';
import { tasksRoute } from './routes/tasks';
import { journal } from './routes/journal';
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

// Protected business routes (auth + tenant)
const businessRoutes = new Hono();
businessRoutes.use('*', authMiddleware);
businessRoutes.use('*', tenantMiddleware);

businessRoutes.route('/status', status);
businessRoutes.route('/agents', agents);
businessRoutes.route('/costs', costs);
businessRoutes.route('/tasks', tasksRoute);
businessRoutes.route('/journal', journal);

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
