/**
 * CLI commands for the Notification System: dashboard, list, show, dismiss, preferences, send.
 *
 * Pattern follows src/cli/schedule.ts.
 */

import path from "node:path";
import chalk from "chalk";

import { loadConfig } from "../core/config.js";
import { header, createTable, formatTimeAgo } from "./ui.js";
import {
  NotificationManager,
  type NotificationsConfig,
  type NotificationUrgency,
  type NotificationCategory,
  type NotificationStatus,
} from "../core/notifications.js";

// --- Helpers ---

interface NotifOptions {
  dir: string;
}

function getNotificationManager(dir: string): NotificationManager {
  const projectDir = path.resolve(dir);
  loadConfig(projectDir);
  return new NotificationManager(projectDir);
}

function urgencyIcon(urgency: string): string {
  switch (urgency) {
    case "critical":
      return chalk.red("critical");
    case "high":
      return chalk.yellow("high");
    case "medium":
      return chalk.cyan("medium");
    case "low":
      return chalk.dim("low");
    default:
      return urgency;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "pending":
      return chalk.yellow("pending");
    case "delivered":
      return chalk.green("delivered");
    case "read":
      return chalk.blue("read");
    case "dismissed":
      return chalk.dim("dismissed");
    case "batched":
      return chalk.cyan("batched");
    default:
      return status;
  }
}

// --- Dashboard (bare `aicib notifications`) ---

export async function notificationsCommand(
  options: NotifOptions
): Promise<void> {
  console.log(header("Notifications"));

  const nm = getNotificationManager(options.dir);
  try {
    const all = nm.listNotifications(undefined, 100);
    const pending = all.filter((n) => n.status === "pending");
    const critical = pending.filter((n) => n.urgency === "critical");
    const high = pending.filter((n) => n.urgency === "high");
    const medium = pending.filter((n) => n.urgency === "medium");
    const low = pending.filter((n) => n.urgency === "low");

    console.log(`  Total:    ${all.length} notifications`);
    console.log(`  Pending:  ${pending.length}`);
    console.log(
      `  By urgency: ${chalk.red(`${critical.length} critical`)}, ${chalk.yellow(`${high.length} high`)}, ${chalk.cyan(`${medium.length} medium`)}, ${chalk.dim(`${low.length} low`)}`
    );

    // Recent critical/high
    const urgent = pending.filter(
      (n) => n.urgency === "critical" || n.urgency === "high"
    );
    if (urgent.length > 0) {
      console.log(chalk.bold("\n  Urgent Notifications:"));
      const table = createTable([
        "ID",
        "Urgency",
        "Title",
        "Category",
        "Created",
      ]);
      for (const n of urgent.slice(0, 10)) {
        table.push([
          `#${n.id}`,
          urgencyIcon(n.urgency),
          n.title.slice(0, 50),
          n.category,
          formatTimeAgo(n.created_at),
        ]);
      }
      console.log(table.toString());
    }

    // Delivery stats
    const delivered = all.filter((n) => n.status === "delivered");
    const dismissed = all.filter((n) => n.status === "dismissed");
    if (delivered.length > 0 || dismissed.length > 0) {
      console.log(
        `\n  Delivered: ${delivered.length}, Dismissed: ${dismissed.length}`
      );
    }

    if (all.length === 0) {
      console.log(
        chalk.dim(
          "\n  No notifications yet. Send one with: aicib notifications send --title \"Test\"\n"
        )
      );
    }
    console.log();
  } finally {
    nm.close();
  }
}

// --- List ---

interface NotifListOptions extends NotifOptions {
  urgency?: string;
  status?: string;
  target?: string;
  since?: string;
  limit?: string;
}

export async function notificationsListCommand(
  options: NotifListOptions
): Promise<void> {
  console.log(header("Notifications"));

  const nm = getNotificationManager(options.dir);
  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 50;
    const notifications = nm.listNotifications(
      {
        urgency: options.urgency as NotificationUrgency | undefined,
        status: options.status as NotificationStatus | undefined,
        target_agent: options.target,
        since: options.since,
      },
      limit
    );

    if (notifications.length === 0) {
      console.log(chalk.dim("  No notifications found.\n"));
      return;
    }

    const table = createTable([
      "ID",
      "Urgency",
      "Title",
      "Category",
      "Status",
      "Target",
      "Created",
    ]);

    for (const n of notifications) {
      table.push([
        `#${n.id}`,
        urgencyIcon(n.urgency),
        n.title.slice(0, 40),
        n.category,
        statusIcon(n.status),
        n.target_agent || "-",
        formatTimeAgo(n.created_at),
      ]);
    }

    console.log(table.toString());
    console.log();
  } finally {
    nm.close();
  }
}

// --- Show ---

export async function notificationsShowCommand(
  id: string,
  options: NotifOptions
): Promise<void> {
  const nm = getNotificationManager(options.dir);
  try {
    const notification = nm.getNotification(parseInt(id, 10));
    if (!notification) {
      console.error(chalk.red(`  Notification #${id} not found.\n`));
      process.exit(1);
    }

    console.log(header(`Notification #${notification.id}`));
    console.log(`  Title:       ${notification.title}`);
    console.log(`  Urgency:     ${urgencyIcon(notification.urgency)}`);
    console.log(`  Category:    ${notification.category}`);
    console.log(`  Status:      ${statusIcon(notification.status)}`);
    console.log(`  Source:      ${notification.source_agent}`);
    console.log(`  Target:      ${notification.target_agent || "-"}`);
    if (notification.target_department) {
      console.log(`  Department:  ${notification.target_department}`);
    }
    if (notification.body) {
      console.log(`\n  Body:\n  ${notification.body}`);
    }
    if (notification.delivered_at) {
      console.log(`  Delivered:   ${formatTimeAgo(notification.delivered_at)}`);
    }
    if (notification.delivery_channel) {
      console.log(`  Channel:     ${notification.delivery_channel}`);
    }
    console.log(`  Created:     ${formatTimeAgo(notification.created_at)}`);
    console.log();
  } finally {
    nm.close();
  }
}

// --- Dismiss ---

export async function notificationsDismissCommand(
  id: string,
  options: NotifOptions
): Promise<void> {
  const nm = getNotificationManager(options.dir);
  try {
    const notification = nm.getNotification(parseInt(id, 10));
    if (!notification) {
      console.error(chalk.red(`  Notification #${id} not found.\n`));
      process.exit(1);
    }

    nm.dismissNotification(notification.id);
    console.log(
      chalk.green(`  Dismissed notification #${id}: ${notification.title}\n`)
    );
  } finally {
    nm.close();
  }
}

// --- Preferences ---

export async function notificationsPreferencesCommand(
  options: NotifOptions
): Promise<void> {
  console.log(header("Notification Preferences"));

  const nm = getNotificationManager(options.dir);
  try {
    const prefs = nm.getPreferences();

    if (prefs.length === 0) {
      console.log(
        chalk.dim(
          "  No custom preferences set. Using defaults.\n"
        )
      );

      const projectDir = path.resolve(options.dir);
      const config = loadConfig(projectDir);
      const notifConfig = (config.extensions?.notifications || {}) as NotificationsConfig;
      console.log(`  Default channel:     ${notifConfig.default_channel || "slack_dm"}`);
      console.log(`  Min push urgency:    ${notifConfig.min_push_urgency || "high"}`);
      console.log(`  Digest frequency:    ${notifConfig.digest_frequency || "hourly"}`);
      console.log(`  Quiet hours:         ${notifConfig.quiet_hours_start || "none"} - ${notifConfig.quiet_hours_end || "none"}`);
      console.log();
      return;
    }

    const table = createTable([
      "Scope",
      "Value",
      "Min Push",
      "Digest",
      "Quiet Start",
      "Quiet End",
      "Enabled",
    ]);

    for (const p of prefs) {
      table.push([
        p.scope,
        p.scope_value || "-",
        p.min_push_urgency,
        p.digest_frequency,
        p.quiet_hours_start || "-",
        p.quiet_hours_end || "-",
        p.enabled ? chalk.green("yes") : chalk.red("no"),
      ]);
    }

    console.log(table.toString());
    console.log();
  } finally {
    nm.close();
  }
}

// --- Preferences Set ---

interface PreferencesSetOptions extends NotifOptions {
  scope: string;
  value: string;
  pushUrgency?: string;
  digest?: string;
  quietStart?: string;
  quietEnd?: string;
}

export async function notificationsPreferencesSetCommand(
  options: PreferencesSetOptions
): Promise<void> {
  const nm = getNotificationManager(options.dir);
  try {
    nm.setPreference(
      options.scope as "global" | "department" | "agent",
      options.value,
      {
        min_push_urgency: options.pushUrgency as NotificationUrgency | undefined,
        digest_frequency: options.digest,
        quiet_hours_start: options.quietStart,
        quiet_hours_end: options.quietEnd,
      }
    );

    console.log(
      chalk.green(
        `  Preference updated for ${options.scope}: ${options.value}\n`
      )
    );
  } finally {
    nm.close();
  }
}

// --- Send ---

interface SendOptions extends NotifOptions {
  title: string;
  urgency?: string;
  category?: string;
  target?: string;
  body?: string;
}

export async function notificationsSendCommand(
  options: SendOptions
): Promise<void> {
  const nm = getNotificationManager(options.dir);
  try {
    const notification = nm.createNotification({
      title: options.title,
      body: options.body || "",
      urgency: options.urgency as NotificationUrgency | undefined,
      category: (options.category as NotificationCategory) || "general",
      target_agent: options.target,
      source_agent: "cli",
    });

    console.log(header("Notification Created"));
    console.log(`  ID:        #${notification.id}`);
    console.log(`  Title:     ${notification.title}`);
    console.log(`  Urgency:   ${urgencyIcon(notification.urgency)}`);
    console.log(`  Category:  ${notification.category}`);
    if (notification.target_agent) {
      console.log(`  Target:    ${notification.target_agent}`);
    }
    if (notification.body) {
      console.log(`  Body:      ${notification.body}`);
    }
    console.log();
  } finally {
    nm.close();
  }
}
