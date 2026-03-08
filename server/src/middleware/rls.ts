import { createMiddleware } from 'hono/factory';
import type { AuthContext } from '../types';

// RLS middleware — placeholder for future activation.
// FORCE ROW LEVEL SECURITY is deferred until repos use request-scoped
// transactions (via AsyncLocalStorage). Policies and indexes exist in the DB
// but are inert for the table owner role. This middleware is kept mounted so
// the activation path only requires restoring the transaction logic here.

type RlsEnv = {
  Variables: {
    auth: AuthContext;
  };
};

export const rlsMiddleware = createMiddleware<RlsEnv>(async (_c, next) => {
  await next();
});
