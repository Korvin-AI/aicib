/**
 * Hook registration for the Agent Scheduler system.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `scheduler:` section in aicib.config.yaml
 * - Database tables: schedules, schedule_executions, scheduler_state
 * - Context provider: scheduler-status (injects active/upcoming schedules into agent prompts)
 * - Message handler: schedule-actions (detects SCHEDULE:: markers + trigger events)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  ScheduleManager,
  SCHEDULER_CONFIG_DEFAULTS,
  validateSchedulerConfig,
  type SchedulerConfig,
  type TriggerType,
} from "./scheduler.js";

// --- Config extension ---

registerConfigExtension({
  key: "scheduler",
  defaults: { ...SCHEDULER_CONFIG_DEFAULTS },
  validate: validateSchedulerConfig,
});

// --- Database tables ---

registerTable({
  name: "schedules",
  createSQL: `CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cron_expression TEXT,
    agent_target TEXT NOT NULL DEFAULT 'ceo',
    directive TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'idle'
      CHECK(status IN ('idle', 'running', 'paused', 'error')),
    trigger_type TEXT
      CHECK(trigger_type IS NULL OR trigger_type IN ('task_completed', 'project_completed', 'status_change', 'marker')),
    trigger_value TEXT,
    last_run_at TEXT,
    next_run_at TEXT,
    last_job_id INTEGER,
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled)",
    "CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status)",
    "CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at)",
    "CREATE INDEX IF NOT EXISTS idx_schedules_trigger ON schedules(trigger_type)",
  ],
});

registerTable({
  name: "schedule_executions",
  createSQL: `CREATE TABLE IF NOT EXISTS schedule_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    job_id INTEGER,
    trigger_source TEXT NOT NULL DEFAULT 'cron'
      CHECK(trigger_source IN ('cron', 'manual', 'trigger')),
    status TEXT NOT NULL DEFAULT 'running'
      CHECK(status IN ('running', 'completed', 'failed', 'skipped')),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    num_turns INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES background_jobs(id) ON DELETE SET NULL
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_sched_exec_schedule ON schedule_executions(schedule_id)",
    "CREATE INDEX IF NOT EXISTS idx_sched_exec_status ON schedule_executions(status)",
  ],
});

registerTable({
  name: "scheduler_state",
  createSQL: `CREATE TABLE IF NOT EXISTS scheduler_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
});

// --- Context provider ---

// Module-level projectDir set by the context provider, read by the message handler.
// Safe: AICIB runs one session per CLI process; background workers are separate processes.
let lastProjectDir: string | null = null;

registerContextProvider("scheduler-status", async (_config, projectDir) => {
  lastProjectDir = projectDir;

  const schedulerConfig = _config.extensions?.scheduler as SchedulerConfig | undefined;
  if (schedulerConfig && !schedulerConfig.enabled) return "";

  let sm: ScheduleManager | undefined;
  try {
    sm = new ScheduleManager(projectDir);
    return sm.formatForContext();
  } catch {
    return "";
  } finally {
    sm?.close();
  }
});

// --- Message handler ---

// Debounced schedule action queue (same pattern as task-register.ts)
interface PendingScheduleAction {
  type: "create" | "enable" | "disable" | "delete" | "trigger";
  data: Record<string, string>;
}

let pendingActions: PendingScheduleAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAction(action: PendingScheduleAction): void {
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

  // Deduplicate: only process last action per schedule id + type
  const seen = new Set<string>();
  const deduped: PendingScheduleAction[] = [];
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i];
    const key = action.type === "trigger"
      ? `trigger:${action.data.triggerType}:${action.data.triggerValue}`
      : `${action.data.id || action.data.name}:${action.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.unshift(action);
    }
  }

  let sm: ScheduleManager | undefined;
  try {
    sm = new ScheduleManager(lastProjectDir);

    for (const action of deduped) {
      try {
        switch (action.type) {
          case "create": {
            const { name, cron, directive, agent, trigger } = action.data;
            if (!name?.trim() || !directive?.trim()) break;

            let triggerType: TriggerType | null = null;
            let triggerValue: string | null = null;
            if (trigger) {
              const parts = trigger.split(":");
              triggerType = parts[0] as TriggerType;
              triggerValue = parts.slice(1).join(":") || null;
            }

            sm.createSchedule({
              name,
              cron_expression: cron || null,
              directive,
              agent_target: agent || "ceo",
              trigger_type: triggerType,
              trigger_value: triggerValue,
            });
            break;
          }
          case "enable": {
            const id = parseInt(action.data.id, 10);
            if (!Number.isNaN(id)) sm.enableSchedule(id);
            break;
          }
          case "disable": {
            const id = parseInt(action.data.id, 10);
            if (!Number.isNaN(id)) sm.disableSchedule(id);
            break;
          }
          case "delete": {
            const id = parseInt(action.data.id, 10);
            if (!Number.isNaN(id)) sm.deleteSchedule(id);
            break;
          }
          case "trigger": {
            // Nudge matching trigger-based schedules to fire now
            const { triggerType: tt, triggerValue: tv } = action.data;
            if (!tt) break;
            const matches = sm.getSchedulesByTrigger(tt as TriggerType, tv || undefined);
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            for (const schedule of matches) {
              if (schedule.status !== "running") {
                sm.updateSchedule(schedule.id, { next_run_at: now });
              }
            }
            break;
          }
        }
      } catch (e) {
        console.warn("Schedule action failed:", e);
      }
    }
  } catch (e) {
    console.warn("Schedule flush DB error:", e);
  } finally {
    sm?.close();
  }
}

registerMessageHandler("schedule-actions", (msg, config) => {
  const schedulerConfig = config.extensions?.scheduler as SchedulerConfig | undefined;
  if (schedulerConfig && !schedulerConfig.enabled) return;

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

  // --- Parse structured SCHEDULE:: markers ---

  // SCHEDULE::CREATE name="..." cron="..." [agent=...] directive="..."
  const createMatches = text.matchAll(
    /SCHEDULE::CREATE\s+name="([^"]+)"(?:\s+cron="([^"]*)")?(?:\s+trigger=(\S+))?(?:\s+agent=(\S+))?\s+directive="([^"]+)"/g
  );
  for (const match of createMatches) {
    queueAction({
      type: "create",
      data: {
        name: match[1],
        cron: match[2] || "",
        trigger: match[3] || "",
        agent: match[4] || "",
        directive: match[5],
      },
    });
  }

  // SCHEDULE::ENABLE id=<n>
  const enableMatches = text.matchAll(/SCHEDULE::ENABLE\s+id=(\d+)/g);
  for (const match of enableMatches) {
    queueAction({ type: "enable", data: { id: match[1] } });
  }

  // SCHEDULE::DISABLE id=<n>
  const disableMatches = text.matchAll(/SCHEDULE::DISABLE\s+id=(\d+)/g);
  for (const match of disableMatches) {
    queueAction({ type: "disable", data: { id: match[1] } });
  }

  // SCHEDULE::DELETE id=<n>
  const deleteMatches = text.matchAll(/SCHEDULE::DELETE\s+id=(\d+)/g);
  for (const match of deleteMatches) {
    queueAction({ type: "delete", data: { id: match[1] } });
  }

  // --- Detect trigger events from task/project completions ---

  // Task completion: "completed task #N" or TASK::UPDATE id=N status=done
  const taskDoneMatches = text.matchAll(
    /(?:TASK::UPDATE\s+id=(\d+)\s+status=done|(?:completed?|finished|done with)\s+task\s+#(\d+))/gi
  );
  for (const match of taskDoneMatches) {
    const taskId = match[1] || match[2];
    queueAction({
      type: "trigger",
      data: { triggerType: "task_completed", triggerValue: taskId },
    });
  }

  // Project completion detection
  if (/project.*(?:completed|finished|done)/i.test(text)) {
    queueAction({
      type: "trigger",
      data: { triggerType: "project_completed", triggerValue: "" },
    });
  }
});
