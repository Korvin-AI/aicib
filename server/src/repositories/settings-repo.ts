import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  businesses,
  schedulerState,
  schedules,
  mcpIntegrations,
  notifications,
  notificationPreferences,
  safeguardPending,
  externalActions,
  companyEvents,
} from '../db/schema/index';

export async function getSettings(businessId: string) {
  const [
    [business],
    schedulerStates,
    scheduleRows,
    mcpRows,
    notifSummary,
    [notifPref],
    [safeguardCount],
    actionRows,
    events,
  ] = await Promise.all([
    db
      .select({ config: businesses.config, name: businesses.name, template: businesses.template, executionMode: businesses.executionMode })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1),
    db
      .select({ key: schedulerState.key, value: schedulerState.value })
      .from(schedulerState)
      .where(eq(schedulerState.businessId, businessId)),
    db
      .select()
      .from(schedules)
      .where(and(eq(schedules.businessId, businessId), eq(schedules.enabled, true))),
    db
      .select()
      .from(mcpIntegrations)
      .where(eq(mcpIntegrations.businessId, businessId)),
    db
      .select({
        status: notifications.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(notifications)
      .where(eq(notifications.businessId, businessId))
      .groupBy(notifications.status),
    db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.businessId, businessId),
          eq(notificationPreferences.scope, 'global'),
        ),
      )
      .limit(1),
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(safeguardPending)
      .where(and(eq(safeguardPending.businessId, businessId), eq(safeguardPending.status, 'pending'))),
    db
      .select()
      .from(externalActions)
      .where(
        and(
          eq(externalActions.businessId, businessId),
          sql`${externalActions.createdAt} >= NOW() - INTERVAL '30 days'`,
        ),
      ),
    db
      .select()
      .from(companyEvents)
      .where(eq(companyEvents.businessId, businessId)),
  ]);

  const config = (business?.config ?? {}) as Record<string, unknown>;

  // Reshape schedulerState rows into Record<string, string>
  const stateMap: Record<string, string> = {};
  for (const row of schedulerStates) {
    stateMap[row.key] = row.value ?? '';
  }

  return {
    company: {
      name: business?.name ?? '',
      template: business?.template ?? '',
      projectDir: null,
    },
    executionMode: business?.executionMode ?? 'cloud',
    engine: {
      mode: 'cloud' as const,
      hasApiKey: false,
      maskedKey: null,
    },
    settings: {
      costLimitDaily: (config.costLimitDaily as number) ?? null,
      costLimitMonthly: (config.costLimitMonthly as number) ?? null,
      schedulerEnabled: (config.schedulerEnabled as boolean) ?? false,
      safeguardsEnabled: (config.safeguardsEnabled as boolean) ?? false,
      trustEnabled: (config.trustEnabled as boolean) ?? false,
      notificationsEnabled: (config.notificationsEnabled as boolean) ?? false,
    },
    scheduler: {
      state: stateMap,
      schedules: scheduleRows,
    },
    mcpIntegrations: mcpRows,
    notifications: {
      summary: notifSummary,
      preference: notifPref ?? {},
    },
    safeguards: {
      pendingCount: safeguardCount?.count ?? 0,
      externalActions: actionRows,
    },
    companyEvents: events,
  };
}
