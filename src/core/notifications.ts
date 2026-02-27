/**
 * Core business logic for the Notification System.
 *
 * Provides types, defaults, and the NotificationManager class that handles
 * notification CRUD, urgency evaluation, digest batching, Slack DM delivery,
 * and context formatting for agent prompt injection.
 */

import Database from "better-sqlite3";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationUrgency = "critical" | "high" | "medium" | "low";
export type NotificationCategory =
  | "system_error"
  | "budget"
  | "blocked_deal"
  | "approval_needed"
  | "escalation"
  | "task_completion"
  | "status_update"
  | "agent_activity"
  | "event_reminder"
  | "event_output"
  | "action_item"
  | "general";
export type NotificationStatus =
  | "pending"
  | "delivered"
  | "read"
  | "dismissed"
  | "batched";
export type DeliveryChannel =
  | "slack_dm"
  | "slack_channel"
  | "dashboard"
  | "digest";

export interface Notification {
  id: number;
  title: string;
  body: string;
  urgency: NotificationUrgency;
  category: NotificationCategory;
  source_agent: string;
  target_agent: string | null;
  target_department: string | null;
  event_id: number | null;
  status: NotificationStatus;
  delivery_channel: DeliveryChannel | null;
  delivered_at: string | null;
  scheduled_for: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface CreateNotificationInput {
  title: string;
  body?: string;
  urgency?: NotificationUrgency;
  category?: NotificationCategory;
  source_agent?: string;
  target_agent?: string;
  target_department?: string;
  event_id?: number;
  scheduled_for?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationFilter {
  urgency?: NotificationUrgency;
  status?: NotificationStatus;
  target_agent?: string;
  category?: NotificationCategory;
  since?: string;
}

export interface NotificationPreference {
  id: number;
  scope: "global" | "department" | "agent";
  scope_value: string;
  min_push_urgency: NotificationUrgency;
  digest_frequency: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  enabled: number;
  created_at: string;
}

export interface DigestBatch {
  target: string;
  notifications: Notification[];
}

export interface NotificationsConfig {
  enabled: boolean;
  default_channel: DeliveryChannel;
  min_push_urgency: NotificationUrgency;
  digest_frequency: string;
  digest_cron: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  max_context_notifications: number;
  retention_days: number;
}

export const NOTIFICATIONS_CONFIG_DEFAULTS: NotificationsConfig = {
  enabled: true,
  default_channel: "slack_dm",
  min_push_urgency: "high",
  digest_frequency: "hourly",
  digest_cron: "0 * * * *",
  quiet_hours_start: null,
  quiet_hours_end: null,
  max_context_notifications: 10,
  retention_days: 30,
};

// ---------------------------------------------------------------------------
// Category-to-urgency auto-mapping
// ---------------------------------------------------------------------------

const CATEGORY_URGENCY_MAP: Record<NotificationCategory, NotificationUrgency> =
  {
    system_error: "critical",
    budget: "critical",
    blocked_deal: "critical",
    approval_needed: "high",
    escalation: "high",
    task_completion: "medium",
    status_update: "medium",
    event_output: "medium",
    event_reminder: "medium",
    action_item: "medium",
    general: "medium",
    agent_activity: "low",
  };

const URGENCY_RANK: Record<NotificationUrgency, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ---------------------------------------------------------------------------
// NotificationManager
// ---------------------------------------------------------------------------

export class NotificationManager {
  private db: Database.Database;

  constructor(projectDir: string) {
    const dbPath = path.join(projectDir, ".aicib", "state.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
  }

  close(): void {
    this.db.close();
  }

  /**
   * Self-contained queue processing — opens its own DB, processes, and closes.
   * Avoids the async/close race when called from synchronous poll loops.
   */
  static async processQueue(
    config: NotificationsConfig,
    projectDir: string
  ): Promise<void> {
    const nm = new NotificationManager(projectDir);
    try {
      await nm.processNotificationQueue(config, projectDir);
    } finally {
      nm.close();
    }
  }

  // --- CRUD ---

  createNotification(input: CreateNotificationInput): Notification {
    const urgency = input.urgency || this.evaluateUrgency(input.category || "general");
    const stmt = this.db.prepare(`
      INSERT INTO notifications (title, body, urgency, category, source_agent,
        target_agent, target_department, event_id, status, scheduled_for, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    const result = stmt.run(
      input.title,
      input.body || "",
      urgency,
      input.category || "general",
      input.source_agent || "system",
      input.target_agent || null,
      input.target_department || null,
      input.event_id || null,
      input.scheduled_for || null,
      JSON.stringify(input.metadata || {})
    );

    return this.getNotification(Number(result.lastInsertRowid))!;
  }

  getNotification(id: number): Notification | undefined {
    return this.db
      .prepare("SELECT * FROM notifications WHERE id = ?")
      .get(id) as Notification | undefined;
  }

  listNotifications(
    filter?: NotificationFilter,
    limit = 50
  ): Notification[] {
    let sql = "SELECT * FROM notifications WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.urgency) {
      sql += " AND urgency = ?";
      params.push(filter.urgency);
    }
    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }
    if (filter?.target_agent) {
      sql += " AND target_agent = ?";
      params.push(filter.target_agent);
    }
    if (filter?.category) {
      sql += " AND category = ?";
      params.push(filter.category);
    }
    if (filter?.since) {
      sql += " AND created_at >= ?";
      params.push(filter.since);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(sql).all(...params) as Notification[];
  }

  updateNotification(
    id: number,
    fields: Partial<
      Pick<
        Notification,
        | "title"
        | "body"
        | "urgency"
        | "status"
        | "delivery_channel"
        | "delivered_at"
      >
    >
  ): void {
    const ALLOWED_COLUMNS = new Set([
      "title",
      "body",
      "urgency",
      "status",
      "delivery_channel",
      "delivered_at",
    ]);

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED_COLUMNS.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE notifications SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  dismissNotification(id: number): void {
    this.updateNotification(id, { status: "dismissed" });
  }

  // --- Urgency evaluation ---

  evaluateUrgency(
    category: NotificationCategory,
    explicitUrgency?: NotificationUrgency
  ): NotificationUrgency {
    if (explicitUrgency) return explicitUrgency;
    return CATEGORY_URGENCY_MAP[category] || "medium";
  }

  // --- Push / Digest ---

  getPendingPushNotifications(config: NotificationsConfig): Notification[] {
    const minRank = URGENCY_RANK[config.min_push_urgency] || 3;

    const all = this.db
      .prepare(
        `SELECT * FROM notifications
         WHERE status = 'pending'
           AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
         ORDER BY created_at ASC`
      )
      .all() as Notification[];

    const now = new Date();
    const inQuiet = isInQuietHours(
      now,
      config.quiet_hours_start,
      config.quiet_hours_end
    );

    return all.filter((n) => {
      const rank = URGENCY_RANK[n.urgency] || 0;
      if (rank < minRank) return false;
      // Critical always pushes, even during quiet hours
      if (inQuiet && n.urgency !== "critical") return false;
      return true;
    });
  }

  buildDigestBatches(config: NotificationsConfig): DigestBatch[] {
    const minRank = URGENCY_RANK[config.min_push_urgency] || 3;

    // Digest collects notifications below the push threshold
    const all = this.db
      .prepare(
        `SELECT * FROM notifications
         WHERE status = 'pending'
           AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
         ORDER BY created_at ASC`
      )
      .all() as Notification[];

    const digestItems = all.filter(
      (n) => (URGENCY_RANK[n.urgency] || 0) < minRank
    );

    // Group by target_agent (or "all" if no target)
    const groups = new Map<string, Notification[]>();
    for (const n of digestItems) {
      const target = n.target_agent || "all";
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target)!.push(n);
    }

    const batches: DigestBatch[] = [];
    for (const [target, notifications] of groups) {
      batches.push({ target, notifications });
      // Mark as batched
      for (const n of notifications) {
        this.updateNotification(n.id, { status: "batched" });
      }
    }

    return batches;
  }

  markDelivered(ids: number[], channel: DeliveryChannel): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `UPDATE notifications
         SET status = 'delivered', delivery_channel = ?, delivered_at = datetime('now'), updated_at = datetime('now')
         WHERE id IN (${placeholders})`
      )
      .run(channel, ...ids);
  }

  async deliverViaSlack(
    notification: Notification,
    projectDir: string
  ): Promise<boolean> {
    try {
      // Read bot_token from slack_state table (reuse this.db — same state.db)
      let botToken: string | null = null;
      try {
        const row = this.db
          .prepare("SELECT value FROM slack_state WHERE key = 'bot_token'")
          .get() as { value: string } | undefined;
        botToken = row?.value ?? null;
      } catch {
        // slack_state table may not exist yet
      }

      if (!botToken) {
        // Fall back to dashboard delivery
        this.markDelivered([notification.id], "dashboard");
        return false;
      }

      const { WebClient } = await import("@slack/web-api");
      const client = new WebClient(botToken);

      const urgencyEmoji =
        notification.urgency === "critical"
          ? "🔴"
          : notification.urgency === "high"
            ? "🟠"
            : notification.urgency === "medium"
              ? "🟡"
              : "⚪";

      const text = `${urgencyEmoji} *${notification.title}*\n${notification.body || ""}`.trim();

      // Find the bot's own DM channel (post to general or bot's channel)
      // For now, post to #general or use conversations.list to find appropriate channel
      await client.chat.postMessage({
        channel: notification.target_agent || "general",
        text,
        mrkdwn: true,
      });

      this.markDelivered([notification.id], "slack_dm");
      return true;
    } catch {
      // Slack delivery failed — fall back to dashboard
      this.markDelivered([notification.id], "dashboard");
      return false;
    }
  }

  async processNotificationQueue(
    config: NotificationsConfig,
    projectDir: string
  ): Promise<{ pushed: number; batched: number }> {
    let pushed = 0;
    let batched = 0;

    // Push high-urgency notifications
    const pushNotifications = this.getPendingPushNotifications(config);
    for (const n of pushNotifications) {
      if (config.default_channel === "slack_dm") {
        await this.deliverViaSlack(n, projectDir);
      } else {
        this.markDelivered([n.id], "dashboard");
      }
      pushed++;
    }

    // Batch medium/low into digests and mark as delivered
    const digestBatches = this.buildDigestBatches(config);
    for (const batch of digestBatches) {
      const ids = batch.notifications.map((n) => n.id);
      this.markDelivered(ids, "digest");
      batched += ids.length;
    }

    return { pushed, batched };
  }

  // --- Cleanup ---

  cleanupOldNotifications(retentionDays: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM notifications
         WHERE created_at < datetime('now', '-' || ? || ' days')
           AND status IN ('delivered', 'read', 'dismissed')`
      )
      .run(retentionDays);
    return result.changes;
  }

  // --- Counts ---

  getUnreadCount(targetAgent?: string): number {
    if (targetAgent) {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM notifications
           WHERE status IN ('pending', 'delivered')
             AND (target_agent = ? OR target_agent IS NULL)`
        )
        .get(targetAgent) as { count: number };
      return row.count;
    }
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM notifications WHERE status IN ('pending', 'delivered')"
      )
      .get() as { count: number };
    return row.count;
  }

  // --- Context formatting ---

  formatForContext(maxNotifications?: number): string {
    const max = maxNotifications || 10;
    const unread = this.getUnreadCount();
    if (unread === 0) return "";

    const lines: string[] = ["## Notifications"];
    lines.push(`\nUnread: ${unread}`);

    // Recent critical/high
    const urgent = this.listNotifications(
      { status: "pending" },
      max
    ).filter((n) => n.urgency === "critical" || n.urgency === "high");

    if (urgent.length > 0) {
      lines.push("\nUrgent:");
      for (const n of urgent.slice(0, 5)) {
        const icon = n.urgency === "critical" ? "🔴" : "🟠";
        lines.push(`- ${icon} [#${n.id}] ${n.title} (${n.category})`);
      }
    }

    // Pending action items
    const actionItems = this.listNotifications(
      { category: "action_item", status: "pending" },
      5
    );
    if (actionItems.length > 0) {
      lines.push("\nPending Action Items:");
      for (const n of actionItems) {
        lines.push(`- [#${n.id}] ${n.title}`);
      }
    }

    lines.push(
      "\nTo manage notifications, use NOTIFY:: markers:",
      'NOTIFY::CREATE urgency=<level> title="<text>" [category=<cat>] [target=<agent>] [body="<text>"]',
      "NOTIFY::DISMISS id=<n>"
    );

    return lines.join("\n");
  }

  // --- Preferences ---

  getPreferences(
    scope?: string,
    scopeValue?: string
  ): NotificationPreference[] {
    let sql = "SELECT * FROM notification_preferences WHERE 1=1";
    const params: unknown[] = [];

    if (scope) {
      sql += " AND scope = ?";
      params.push(scope);
    }
    if (scopeValue) {
      sql += " AND scope_value = ?";
      params.push(scopeValue);
    }

    sql += " ORDER BY scope ASC, scope_value ASC";
    return this.db.prepare(sql).all(...params) as NotificationPreference[];
  }

  setPreference(
    scope: "global" | "department" | "agent",
    scopeValue: string,
    fields: {
      min_push_urgency?: NotificationUrgency;
      digest_frequency?: string;
      quiet_hours_start?: string | null;
      quiet_hours_end?: string | null;
      enabled?: boolean;
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO notification_preferences (scope, scope_value, min_push_urgency, digest_frequency, quiet_hours_start, quiet_hours_end, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope, scope_value)
         DO UPDATE SET
           min_push_urgency = COALESCE(?, min_push_urgency),
           digest_frequency = COALESCE(?, digest_frequency),
           quiet_hours_start = COALESCE(?, quiet_hours_start),
           quiet_hours_end = COALESCE(?, quiet_hours_end),
           enabled = COALESCE(?, enabled)`
      )
      .run(
        scope,
        scopeValue,
        fields.min_push_urgency || "high",
        fields.digest_frequency || "hourly",
        fields.quiet_hours_start ?? null,
        fields.quiet_hours_end ?? null,
        fields.enabled === false ? 0 : 1,
        fields.min_push_urgency || null,
        fields.digest_frequency || null,
        fields.quiet_hours_start ?? null,
        fields.quiet_hours_end ?? null,
        fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : null
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInQuietHours(
  now: Date,
  start: string | null,
  end: string | null
): boolean {
  if (!start || !end) return false;

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function validateNotificationsConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
      errors.push("notifications.enabled must be a boolean");
    }

    if (obj.default_channel !== undefined) {
      const valid = ["slack_dm", "slack_channel", "dashboard", "digest"];
      if (!valid.includes(obj.default_channel as string)) {
        errors.push(
          `notifications.default_channel must be one of: ${valid.join(", ")}`
        );
      }
    }

    if (obj.min_push_urgency !== undefined) {
      const valid = ["critical", "high", "medium", "low"];
      if (!valid.includes(obj.min_push_urgency as string)) {
        errors.push(
          `notifications.min_push_urgency must be one of: ${valid.join(", ")}`
        );
      }
    }

    if (obj.max_context_notifications !== undefined) {
      if (
        typeof obj.max_context_notifications !== "number" ||
        obj.max_context_notifications < 1 ||
        obj.max_context_notifications > 50
      ) {
        errors.push(
          "notifications.max_context_notifications must be a number between 1 and 50"
        );
      }
    }

    if (obj.retention_days !== undefined) {
      if (
        typeof obj.retention_days !== "number" ||
        obj.retention_days < 1
      ) {
        errors.push("notifications.retention_days must be a positive number");
      }
    }

    for (const field of ["quiet_hours_start", "quiet_hours_end"]) {
      if (obj[field] !== undefined && obj[field] !== null) {
        if (
          typeof obj[field] !== "string" ||
          !/^\d{2}:\d{2}$/.test(obj[field] as string)
        ) {
          errors.push(
            `notifications.${field} must be a string in HH:MM format or null`
          );
        }
      }
    }
  }
  return errors;
}
