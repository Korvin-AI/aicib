/**
 * Hook registration for the Automated Performance Review system.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `auto_reviews:` section in aicib.config.yaml
 * - Database table: auto_review_queue
 * - Context provider: auto-review-status (injects queue status + markers into agent prompts)
 * - Message handler: auto-review-trigger (detects task completions + AUTOREVIEW:: markers)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  AUTO_REVIEW_CONFIG_DEFAULTS,
  VALID_TRIGGERS,
  processAutoReviewQueue,
  isEligibleForAutoReview,
  type AutoReviewConfig,
  type AutoReviewQueueEntry,
} from "./perf-review.js";

import Database from "better-sqlite3";
import path from "node:path";

// --- Config extension ---

registerConfigExtension({
  key: "auto_reviews",
  defaults: { ...AUTO_REVIEW_CONFIG_DEFAULTS },
  validate: (raw: unknown) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;

      if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
        errors.push("auto_reviews.enabled must be a boolean");
      }

      if (obj.trigger !== undefined) {
        if (!VALID_TRIGGERS.includes(obj.trigger as typeof VALID_TRIGGERS[number])) {
          errors.push(`auto_reviews.trigger must be one of: ${VALID_TRIGGERS.join(", ")}`);
        }
      }

      if (obj.min_tasks_before_review !== undefined) {
        if (typeof obj.min_tasks_before_review !== "number" || obj.min_tasks_before_review < 0) {
          errors.push("auto_reviews.min_tasks_before_review must be a non-negative number");
        }
      }

      if (obj.cooldown_hours !== undefined) {
        if (typeof obj.cooldown_hours !== "number" || obj.cooldown_hours < 0) {
          errors.push("auto_reviews.cooldown_hours must be a non-negative number");
        }
      }

      if (obj.include_cost_efficiency !== undefined && typeof obj.include_cost_efficiency !== "boolean") {
        errors.push("auto_reviews.include_cost_efficiency must be a boolean");
      }

      if (obj.periodic_cadence !== undefined) {
        const valid = ["weekly", "biweekly", "monthly", "quarterly"];
        if (!valid.includes(obj.periodic_cadence as string)) {
          errors.push(`auto_reviews.periodic_cadence must be one of: ${valid.join(", ")}`);
        }
      }
    }
    return errors;
  },
});

// --- Database table ---

registerTable({
  name: "auto_review_queue",
  createSQL: `CREATE TABLE IF NOT EXISTS auto_review_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_role TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    trigger_data TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','processing','completed','skipped')),
    review_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_arq_agent ON auto_review_queue(agent_role)",
    "CREATE INDEX IF NOT EXISTS idx_arq_status ON auto_review_queue(status)",
  ],
});

// --- Context provider ---

let lastProjectDir: string | null = null;
let lastAutoConfig: AutoReviewConfig = { ...AUTO_REVIEW_CONFIG_DEFAULTS };

registerContextProvider("auto-review-status", async (_config, projectDir) => {
  lastProjectDir = projectDir;
  // Capture config for use by the message handler flush
  lastAutoConfig = (_config.extensions?.auto_reviews as AutoReviewConfig) || AUTO_REVIEW_CONFIG_DEFAULTS;

  const autoConfig = _config.extensions?.auto_reviews as AutoReviewConfig | undefined;
  if (autoConfig && !autoConfig.enabled) return "";

  const lines: string[] = [];

  let db: Database.Database | undefined;
  try {
    db = new Database(path.join(projectDir, ".aicib", "state.db"), { readonly: true });
    db.pragma("busy_timeout = 3000");

    // Pending queue count
    const pending = db
      .prepare("SELECT COUNT(*) as count FROM auto_review_queue WHERE status = 'pending'")
      .get() as { count: number };

    // Recent completed auto-reviews
    const recent = db
      .prepare("SELECT agent_role, status, processed_at FROM auto_review_queue WHERE status IN ('completed', 'skipped') ORDER BY processed_at DESC LIMIT 5")
      .all() as Array<{ agent_role: string; status: string; processed_at: string }>;

    if (pending.count > 0 || recent.length > 0) {
      lines.push("## Auto Performance Reviews");

      if (pending.count > 0) {
        lines.push(`- ${pending.count} review(s) pending in queue`);
      }

      if (recent.length > 0) {
        lines.push("- Recent auto-reviews:");
        for (const r of recent) {
          lines.push(`  - ${r.agent_role}: ${r.status} (${r.processed_at || "N/A"})`);
        }
      }
    }

    // Config summary
    const config = autoConfig || AUTO_REVIEW_CONFIG_DEFAULTS;
    lines.push("");
    lines.push(`Auto-review trigger: ${config.trigger}, min tasks: ${config.min_tasks_before_review}, cooldown: ${config.cooldown_hours}h`);

    lines.push("");
    lines.push("## Auto-Review Actions");
    lines.push("AUTOREVIEW::PROCESS — process pending queue");
    lines.push("AUTOREVIEW::SKIP id=<N> — skip a queue entry");
  } catch {
    // DB may not exist yet
    lines.push("## Auto Performance Reviews");
    lines.push("Auto-review system initialized. No queue entries yet.");
    lines.push("");
    lines.push("## Auto-Review Actions");
    lines.push("AUTOREVIEW::PROCESS — process pending queue");
    lines.push("AUTOREVIEW::SKIP id=<N> — skip a queue entry");
  } finally {
    db?.close();
  }

  return lines.join("\n");
});

// --- Message handler ---

interface PendingAutoReviewAction {
  type: "queue_review" | "process" | "skip";
  data: Record<string, string>;
}

let pendingActions: PendingAutoReviewAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAction(action: PendingAutoReviewAction): void {
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

  let db: Database.Database | undefined;
  try {
    db = new Database(path.join(lastProjectDir, ".aicib", "state.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");

    const autoConfig = lastAutoConfig;

    for (const action of actions) {
      try {
        switch (action.type) {
          case "queue_review": {
            const { agentRole, taskId } = action.data;
            if (!agentRole?.trim()) break;

            // Check if there's already a pending entry for this agent
            const existing = db
              .prepare("SELECT id FROM auto_review_queue WHERE agent_role = ? AND status = 'pending'")
              .get(agentRole) as { id: number } | undefined;
            if (existing) break; // don't duplicate

            db.prepare(
              "INSERT INTO auto_review_queue (agent_role, trigger_event, trigger_data) VALUES (?, ?, ?)"
            ).run(agentRole, "task_completed", JSON.stringify({ task_id: taskId }));
            break;
          }
          case "process": {
            processAutoReviewQueue(lastProjectDir!, autoConfig);
            break;
          }
          case "skip": {
            const id = parseInt(action.data.id, 10);
            if (Number.isNaN(id)) break;
            db.prepare("UPDATE auto_review_queue SET status = 'skipped', processed_at = datetime('now') WHERE id = ?").run(id);
            break;
          }
        }
      } catch (e) {
        console.warn("Auto-review action failed:", e);
      }
    }
  } catch (e) {
    console.warn("Auto-review flush DB error:", e);
  } finally {
    db?.close();
  }
}

registerMessageHandler("auto-review-trigger", (msg, config) => {
  const autoConfig = config.extensions?.auto_reviews as AutoReviewConfig | undefined;
  if (autoConfig && !autoConfig.enabled) return;

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

  const triggerMode = autoConfig?.trigger ?? "task_completed";

  // --- Detect task completions ---
  // Only process task completions when trigger mode allows it
  if (triggerMode === "task_completed" || triggerMode === "both") {
  // Same regex pattern as scheduler-register.ts line 292
  const taskDoneMatches = text.matchAll(
    /(?:TASK::UPDATE\s+id=(\d+)\s+status=done|(?:completed?|finished|done with)\s+task\s+#(\d+))/gi
  );
  for (const match of taskDoneMatches) {
    const taskId = match[1] || match[2];

    // Look up task's assignee
    let assignee: string | null = null;
    let db: Database.Database | undefined;
    try {
      db = new Database(path.join(lastProjectDir, ".aicib", "state.db"), { readonly: true });
      db.pragma("busy_timeout = 3000");
      const task = db
        .prepare("SELECT assigned_to FROM tasks WHERE id = ?")
        .get(parseInt(taskId, 10)) as { assigned_to: string } | undefined;
      assignee = task?.assigned_to ?? null;
    } catch { /* table may not exist */ } finally {
      db?.close();
    }

    if (assignee) {
      queueAction({
        type: "queue_review",
        data: { agentRole: assignee, taskId },
      });
    }
  }
  } // end trigger mode check

  // --- Parse AUTOREVIEW:: markers ---

  // AUTOREVIEW::PROCESS
  if (/AUTOREVIEW::PROCESS/g.test(text)) {
    queueAction({ type: "process", data: {} });
  }

  // AUTOREVIEW::SKIP id=<N>
  const skipMatches = text.matchAll(/AUTOREVIEW::SKIP\s+id=(\d+)/g);
  for (const match of skipMatches) {
    queueAction({ type: "skip", data: { id: match[1] } });
  }
});
