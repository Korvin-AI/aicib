import { env } from '../env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;

export async function initSentry(): Promise<void> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;

  try {
    Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    console.log('Sentry initialized');
  } catch (err) {
    Sentry = null;
    console.warn('Sentry init failed:', (err as Error).message);
  }
}

export function captureError(
  err: Error,
  context?: { orgId?: string; businessId?: string },
): void {
  if (!Sentry) return;

  try {
    if (context) {
      Sentry.withScope((scope: { setTag: (key: string, value: string) => void }) => {
        if (context.orgId) scope.setTag('orgId', context.orgId);
        if (context.businessId) scope.setTag('businessId', context.businessId);
        Sentry.captureException(err);
      });
    } else {
      Sentry.captureException(err);
    }
  } catch {
    // Sentry not available — swallow silently
  }
}
