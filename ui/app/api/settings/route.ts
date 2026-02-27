import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, safeAll, safeGet, tableExists } from "@/lib/api-helpers";
import { readAppConfig } from "@/lib/config-read";

export const dynamic = "force-dynamic";

function parseNestedBoolean(
  raw: string,
  section: string,
  key: string,
  fallback: boolean
): boolean {
  const block = raw.match(
    new RegExp(`^${section}:\\s*\\n((?:[ ]{2,}.*\\n?)*)`, "m")
  )?.[1];

  if (!block) return fallback;

  const value = block.match(new RegExp(`^\\s*${key}:\\s*(true|false)\\s*$`, "m"))?.[1];
  if (!value) return fallback;
  return value === "true";
}

export async function GET() {
  try {
    const db = getDb();
    const config = readAppConfig();

    const schedulerRows = tableExists(db, "scheduler_state")
      ? safeAll<{ key: string; value: string; updated_at: string }>(
          db,
          "scheduler_state",
          "SELECT * FROM scheduler_state"
        )
      : [];

    const schedulerState = schedulerRows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const enabledSchedules = tableExists(db, "schedules")
      ? safeAll<Record<string, unknown>>(
          db,
          "schedules",
          `SELECT * FROM schedules
           WHERE enabled = 1
           ORDER BY next_run_at ASC, name ASC`
        )
      : [];

    const mcpIntegrations = tableExists(db, "mcp_integrations")
      ? safeAll<Record<string, unknown>>(
          db,
          "mcp_integrations",
          "SELECT * FROM mcp_integrations ORDER BY use_count DESC, server_name ASC"
        )
      : [];

    const notificationSummary = tableExists(db, "notifications")
      ? safeAll<{ status: string; count: number }>(
          db,
          "notifications",
          "SELECT status, COUNT(*) as count FROM notifications GROUP BY status"
        )
      : [];

    const notificationPreferences = tableExists(db, "notification_preferences")
      ? safeGet<Record<string, unknown>>(
          db,
          "notification_preferences",
          "SELECT * FROM notification_preferences WHERE scope = 'global' LIMIT 1"
        )
      : null;

    const safeguardPending = tableExists(db, "safeguard_pending")
      ? safeGet<{ count: number }>(
          db,
          "safeguard_pending",
          "SELECT COUNT(*) as count FROM safeguard_pending WHERE status = 'pending'"
        )?.count ?? 0
      : 0;

    const externalActions = tableExists(db, "external_actions")
      ? safeAll<{ outcome: string; count: number }>(
          db,
          "external_actions",
          `SELECT outcome, COUNT(*) as count
           FROM external_actions
           WHERE created_at > datetime('now', '-30 days')
           GROUP BY outcome`
        )
      : [];

    const companyEvents = tableExists(db, "company_events")
      ? safeAll<Record<string, unknown>>(
          db,
          "company_events",
          `SELECT * FROM company_events
           WHERE enabled = 1
           ORDER BY name ASC`
        )
      : [];

    return NextResponse.json({
      company: {
        name: config.company.name,
        template: config.company.template,
        projectDir: config.projectDir,
      },
      settings: {
        costLimitDaily: config.settings.costLimitDaily,
        costLimitMonthly: config.settings.costLimitMonthly,
        schedulerEnabled: parseNestedBoolean(config.raw, "scheduler", "enabled", true),
        safeguardsEnabled: parseNestedBoolean(config.raw, "safeguards", "enabled", true),
        trustEnabled: parseNestedBoolean(config.raw, "trust", "enabled", true),
        notificationsEnabled: parseNestedBoolean(
          config.raw,
          "notifications",
          "enabled",
          true
        ),
      },
      scheduler: {
        state: schedulerState,
        schedules: enabledSchedules,
      },
      mcpIntegrations,
      notifications: {
        summary: notificationSummary,
        preference: notificationPreferences,
      },
      safeguards: {
        pendingCount: safeguardPending,
        externalActions,
      },
      companyEvents,
    });
  } catch (error) {
    return jsonError(error);
  }
}
