/**
 * Hook registration for the Company Events system.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `events:` section in aicib.config.yaml
 * - Database tables: company_events, event_instances
 * - Context provider: company-events (injects upcoming events, recent summaries)
 * - Message handler: event-actions (detects EVENT:: markers)
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
  EventManager,
  EVENTS_CONFIG_DEFAULTS,
  validateEventConfig,
  type EventConfig,
  type EventType,
  type DiscussionFormat,
} from "./events.js";

// --- Config extension ---

registerConfigExtension({
  key: "events",
  defaults: { ...EVENTS_CONFIG_DEFAULTS },
  validate: validateEventConfig,
});

// --- Database tables ---

registerTable({
  name: "company_events",
  createSQL: `CREATE TABLE IF NOT EXISTS company_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'custom'
      CHECK(event_type IN ('standup', 'all_hands', 'sprint_planning', 'quarterly_review', 'one_on_one', 'retrospective', 'custom')),
    description TEXT NOT NULL DEFAULT '',
    schedule_id INTEGER,
    cron_expression TEXT,
    discussion_format TEXT NOT NULL DEFAULT 'structured'
      CHECK(discussion_format IN ('async', 'structured', 'free_form')),
    participants_config TEXT NOT NULL DEFAULT '{"mode":"all"}',
    agenda_template TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_events_type ON company_events(event_type)",
    "CREATE INDEX IF NOT EXISTS idx_events_enabled ON company_events(enabled)",
    "CREATE INDEX IF NOT EXISTS idx_events_schedule ON company_events(schedule_id)",
    "CREATE INDEX IF NOT EXISTS idx_events_next_run ON company_events(next_run_at)",
  ],
});

registerTable({
  name: "event_instances",
  createSQL: `CREATE TABLE IF NOT EXISTS event_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'skipped')),
    participants TEXT NOT NULL DEFAULT '[]',
    agenda TEXT NOT NULL DEFAULT '',
    minutes TEXT NOT NULL DEFAULT '',
    action_items TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES company_events(id) ON DELETE CASCADE
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_event_inst_event ON event_instances(event_id)",
    "CREATE INDEX IF NOT EXISTS idx_event_inst_status ON event_instances(status)",
    "CREATE INDEX IF NOT EXISTS idx_event_inst_created ON event_instances(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_event_inst_completed ON event_instances(completed_at)",
  ],
});

// --- Context provider ---

let lastProjectDir: string | null = null;

registerContextProvider(
  "company-events",
  async (_config, projectDir) => {
    lastProjectDir = projectDir;

    const eventConfig = _config.extensions?.events as
      | EventConfig
      | undefined;
    if (eventConfig && !eventConfig.enabled) return "";

    let em: EventManager | undefined;
    try {
      em = new EventManager(projectDir);
      return em.formatForContext(eventConfig?.max_context_events);
    } catch {
      return "";
    } finally {
      em?.close();
    }
  }
);

// --- Message handler ---

interface PendingEventAction {
  type: "create" | "complete" | "cancel" | "action_item";
  data: Record<string, string>;
}

let pendingActions: PendingEventAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAction(action: PendingEventAction): void {
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
  const deduped: PendingEventAction[] = [];
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i];
    const key =
      action.type === "create"
        ? `${action.data.type}:${action.data.name}`
        : `${action.data.id}:${action.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.unshift(action);
    }
  }

  let em: EventManager | undefined;
  try {
    em = new EventManager(lastProjectDir);

    for (const action of deduped) {
      try {
        switch (action.type) {
          case "create": {
            const { type, name, cron, participants, format } = action.data;
            if (!type?.trim()) break;

            em.createEvent({
              event_type: type as EventType,
              name: name || undefined,
              cron_expression: cron || undefined,
              discussion_format: (format as DiscussionFormat) || undefined,
              participants_config: participants
                ? { mode: participants as "all" | "department" | "hierarchy" | "custom" }
                : undefined,
            });
            break;
          }
          case "complete": {
            const id = parseInt(action.data.id, 10);
            if (Number.isNaN(id)) break;

            const latest = em.getLatestInstance(id);
            if (latest) {
              em.updateInstance(latest.id, {
                status: "completed",
                summary: action.data.summary || "",
                completed_at: new Date().toISOString(),
              });
            }
            break;
          }
          case "cancel": {
            const id = parseInt(action.data.id, 10);
            if (Number.isNaN(id)) break;

            const latest = em.getLatestInstance(id);
            if (latest) {
              em.updateInstance(latest.id, { status: "cancelled" });
            }
            break;
          }
          case "action_item": {
            // Action items are stored via notification system
            // This handler is a pass-through — action items extracted from event output
            break;
          }
        }
      } catch (e) {
        console.warn("Event action failed:", e);
      }
    }
  } catch (e) {
    console.warn("Event flush DB error:", e);
  } finally {
    em?.close();
  }
}

registerMessageHandler("event-actions", (msg, config) => {
  const eventConfig = config.extensions?.events as
    | EventConfig
    | undefined;
  if (eventConfig && !eventConfig.enabled) return;

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

  // --- Parse structured EVENT:: markers ---

  // EVENT::CREATE type=<type> name="<name>" [cron="<expr>"] [participants=<mode>] [format=<fmt>]
  const createMatches = text.matchAll(
    /EVENT::CREATE\s+type=(\S+)(?:\s+name="([^"]*)")?(?:\s+cron="([^"]*)")?(?:\s+participants=(\S+))?(?:\s+format=(\S+))?/g
  );
  for (const match of createMatches) {
    queueAction({
      type: "create",
      data: {
        type: match[1],
        name: match[2] || "",
        cron: match[3] || "",
        participants: match[4] || "",
        format: match[5] || "",
      },
    });
  }

  // EVENT::COMPLETE id=<n> [summary="<text>"]
  const completeMatches = text.matchAll(
    /EVENT::COMPLETE\s+id=(\d+)(?:\s+summary="([^"]*)")?/g
  );
  for (const match of completeMatches) {
    queueAction({
      type: "complete",
      data: { id: match[1], summary: match[2] || "" },
    });
  }

  // EVENT::CANCEL id=<n>
  const cancelMatches = text.matchAll(/EVENT::CANCEL\s+id=(\d+)/g);
  for (const match of cancelMatches) {
    queueAction({ type: "cancel", data: { id: match[1] } });
  }

  // EVENT::ACTION_ITEM assignee=<role> description="<text>" [deadline=<date>]
  const actionItemMatches = text.matchAll(
    /EVENT::ACTION_ITEM\s+assignee=(\S+)\s+description="([^"]+)"(?:\s+deadline=(\S+))?/g
  );
  for (const match of actionItemMatches) {
    queueAction({
      type: "action_item",
      data: {
        assignee: match[1],
        description: match[2],
        deadline: match[3] || "",
      },
    });
  }
});
