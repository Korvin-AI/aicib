import { env } from '../env';

let sentryLoaded = false;

export function initSentry(): void {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;

  try {
    // Dynamic import to avoid bundling Sentry when not configured
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    sentryLoaded = true;
    console.log('Sentry initialized');
  } catch (err) {
    console.warn('Sentry init failed:', (err as Error).message);
  }
}

export function captureError(
  err: Error,
  context?: { orgId?: string; businessId?: string },
): void {
  if (!sentryLoaded) return;

  try {
    const Sentry = require('@sentry/node');
    if (context) {
      Sentry.withScope((scope: any) => {
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
