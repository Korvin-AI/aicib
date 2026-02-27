/**
 * Hook registration for the Notification System.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `notifications:` section in aicib.config.yaml
 * - Database tables: notifications, notification_preferences
 * - Context provider: notification-status (injects unread counts, urgent alerts)
 * - Message handler: notification-actions (detects NOTIFY:: markers + NL patterns)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import {
  registerContextProvider,
  registerMessageHandler,
} from "./agent-runner.js";
import {
  NotificationManager,
  NOTIFICATIONS_CONFIG_DEFAULTS,
  validateNotificationsConfig,
  type NotificationsConfig,
  type NotificationCategory,
  type NotificationUrgency,
} from "./notifications.js";

// --- Config extension ---

registerConfigExtension({
  key: "notifications",
  defaults: { ...NOTIFICATIONS_CONFIG_DEFAULTS },
  validate: validateNotificationsConfig,
});

// --- Database tables ---

registerTable({
  name: "notifications",
  createSQL: `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    urgency TEXT NOT NULL DEFAULT 'medium'
      CHECK(urgency IN ('critical', 'high', 'medium', 'low')),
    category TEXT NOT NULL DEFAULT 'general'
      CHECK(category IN ('system_error', 'budget', 'blocked_deal', 'approval_needed', 'escalation', 'task_completion', 'status_update', 'agent_activity', 'event_reminder', 'event_output', 'action_item', 'general')),
    source_agent TEXT NOT NULL DEFAULT 'system',
    target_agent TEXT,
    target_department TEXT,
    event_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'delivered', 'read', 'dismissed', 'batched')),
    delivery_channel TEXT
      CHECK(delivery_channel IS NULL OR delivery_channel IN ('slack_dm', 'slack_channel', 'dashboard', 'digest')),
    delivered_at TEXT,
    scheduled_for TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_notifications_urgency ON notifications(urgency)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_agent)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(category)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_for)",
  ],
});

registerTable({
  name: "notification_preferences",
  createSQL: `CREATE TABLE IF NOT EXISTS notification_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global'
      CHECK(scope IN ('global', 'department', 'agent')),
    scope_value TEXT NOT NULL DEFAULT '',
    min_push_urgency TEXT NOT NULL DEFAULT 'high'
      CHECK(min_push_urgency IN ('critical', 'high', 'medium', 'low')),
    digest_frequency TEXT NOT NULL DEFAULT 'hourly',
    quiet_hours_start TEXT,
    quiet_hours_end TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(scope, scope_value)
  )`,
  indexes: [],
});

// --- Context provider ---

let lastProjectDir: string | null = null;

registerContextProvider(
  "notification-status",
  async (_config, projectDir) => {
    lastProjectDir = projectDir;

    const notifConfig = _config.extensions?.notifications as
      | NotificationsConfig
      | undefined;
    if (notifConfig && !notifConfig.enabled) return "";

    let nm: NotificationManager | undefined;
    try {
      nm = new NotificationManager(projectDir);
      return nm.formatForContext(notifConfig?.max_context_notifications);
    } catch {
      return "";
    } finally {
      nm?.close();
    }
  }
);

// --- Message handler ---

interface PendingNotifyAction {
  type: "create" | "dismiss";
  data: Record<string, string>;
}

let pendingActions: PendingNotifyAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAction(action: PendingNotifyAction): void {
  pendingActions.push(action);
  if (!flushTimer) {
    flushTimer = setTimeout(() => flushPendingActions(), 500);
  }
}

function flushPendingActions(): void {
  flushTimer = null;
  if (pendingActions.length === 0 || !lastProjectDir) return;

  const actions = pendingActions;
  pendingActions = [];

  // Deduplicate
  const seen = new Set<string>();
  const deduped: PendingNotifyAction[] = [];
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i];
    const key =
      action.type === "create"
        ? `${action.data.title}:${action.data.category}:${action.data.target}`
        : `dismiss:${action.data.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.unshift(action);
    }
  }

  let nm: NotificationManager | undefined;
  try {
    nm = new NotificationManager(lastProjectDir);

    for (const action of deduped) {
      try {
        switch (action.type) {
          case "create": {
            const { title, urgency, category, target, body } = action.data;
            if (!title?.trim()) break;

            nm.createNotification({
              title,
              body: body || "",
              urgency: (urgency as NotificationUrgency) || undefined,
              category: (category as NotificationCategory) || "general",
              target_agent: target || undefined,
              source_agent: "agent",
            });
            break;
          }
          case "dismiss": {
            const id = parseInt(action.data.id, 10);
            if (!Number.isNaN(id)) nm.dismissNotification(id);
            break;
          }
        }
      } catch (e) {
        console.warn("Notification action failed:", e);
      }
    }
  } catch (e) {
    console.warn("Notification flush DB error:", e);
  } finally {
    nm?.close();
  }
}

registerMessageHandler("notification-actions", (msg, config) => {
  const notifConfig = config.extensions?.notifications as
    | NotificationsConfig
    | undefined;
  if (notifConfig && !notifConfig.enabled) return;

  if (msg.type !== "assistant") return;

  const content = msg.message?.content;
  if (!content) return;

  let text = "";
  for (const block of content) {
    if ("text" in block && block.text) {
      text += block.text + "\n";
    }
  }
  if (!text) return;
  if (!lastProjectDir) return;

  // --- Parse structured NOTIFY:: markers ---

  // NOTIFY::CREATE urgency=<level> title="<text>" [category=<cat>] [target=<agent>] [body="<text>"]
  const createMatches = text.matchAll(
    /NOTIFY::CREATE\s+urgency=(\S+)\s+title="([^"]+)"(?:\s+category=(\S+))?(?:\s+target=(\S+))?(?:\s+body="([^"]*)")?/g
  );
  for (const match of createMatches) {
    queueAction({
      type: "create",
      data: {
        urgency: match[1],
        title: match[2],
        category: match[3] || "",
        target: match[4] || "",
        body: match[5] || "",
      },
    });
  }

  // NOTIFY::DISMISS id=<n>
  const dismissMatches = text.matchAll(/NOTIFY::DISMISS\s+id=(\d+)/g);
  for (const match of dismissMatches) {
    queueAction({ type: "dismiss", data: { id: match[1] } });
  }

  // --- Natural language fallbacks ---

  // CRITICAL: / ALERT: / system error → critical
  if (/\bCRITICAL:/i.test(text) || /\bALERT:/i.test(text) || /\bsystem error\b/i.test(text)) {
    const titleMatch = text.match(
      /(?:CRITICAL|ALERT):\s*(.+?)(?:\n|$)/i
    );
    if (titleMatch) {
      queueAction({
        type: "create",
        data: {
          urgency: "critical",
          title: titleMatch[1].trim().slice(0, 200),
          category: "system_error",
          target: "",
          body: "",
        },
      });
    }
  }

  // needs approval / escalating to → high
  if (/\bneeds approval\b/i.test(text) || /\bescalating to\b/i.test(text)) {
    const approvalMatch = text.match(
      /(?:needs approval|escalating to)\s*[:\-]?\s*(.+?)(?:\n|$)/i
    );
    if (approvalMatch) {
      queueAction({
        type: "create",
        data: {
          urgency: "high",
          title: approvalMatch[1].trim().slice(0, 200),
          category: /escalating/i.test(approvalMatch[0])
            ? "escalation"
            : "approval_needed",
          target: "",
          body: "",
        },
      });
    }
  }

  // completed task / finished → medium task_completion
  if (/\b(?:completed?|finished)\s+(?:task|work on)\b/i.test(text)) {
    const taskMatch = text.match(
      /(?:completed?|finished)\s+(?:task|work on)\s+(.+?)(?:\n|$)/i
    );
    if (taskMatch) {
      queueAction({
        type: "create",
        data: {
          urgency: "medium",
          title: taskMatch[1].trim().slice(0, 200),
          category: "task_completion",
          target: "",
          body: "",
        },
      });
    }
  }
});
