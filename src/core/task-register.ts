/**
 * Hook registration for the Task Management system.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `tasks:` section in aicib.config.yaml
 * - Database tables: tasks, task_blockers, task_comments
 * - Context provider: task-board (injects active tasks into agent prompts)
 * - Message handler: task-actions (detects TASK:: markers in agent output)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  TaskManager,
  TASKS_CONFIG_DEFAULTS,
  VALID_REVIEW_LAYERS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  type TasksConfig,
  type TaskStatus,
  type TaskPriority,
  type ReviewLayer,
} from "./task-manager.js";
import { validateReviewChainOverrides } from "./review-chains.js";

// --- Config extension ---

registerConfigExtension({
  key: "tasks",
  defaults: { ...TASKS_CONFIG_DEFAULTS },
  validate: (raw: unknown) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;

      if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
        errors.push("tasks.enabled must be a boolean");
      }

      if (obj.max_context_tasks !== undefined) {
        if (
          typeof obj.max_context_tasks !== "number" ||
          obj.max_context_tasks < 0
        ) {
          errors.push("tasks.max_context_tasks must be a non-negative number");
        }
      }

      if (obj.deadline_urgency_hours !== undefined) {
        if (
          typeof obj.deadline_urgency_hours !== "number" ||
          obj.deadline_urgency_hours < 0
        ) {
          errors.push(
            "tasks.deadline_urgency_hours must be a non-negative number"
          );
        }
      }

      if (
        obj.default_review_chains !== undefined &&
        typeof obj.default_review_chains === "object" &&
        obj.default_review_chains !== null
      ) {
        const chains = obj.default_review_chains as Record<string, unknown>;
        const validLayers = new Set(VALID_REVIEW_LAYERS);
        for (const [type, chain] of Object.entries(chains)) {
          if (!Array.isArray(chain)) {
            errors.push(
              `tasks.default_review_chains.${type} must be an array`
            );
          } else {
            for (const layer of chain) {
              if (!validLayers.has(layer as ReviewLayer)) {
                errors.push(
                  `tasks.default_review_chains.${type} contains invalid layer "${layer}". Valid: ${VALID_REVIEW_LAYERS.join(", ")}`
                );
              }
            }
          }
        }
      }

      // Validate review_chain_overrides (Feature #39)
      if (obj.review_chain_overrides !== undefined) {
        if (typeof obj.review_chain_overrides !== "object" || obj.review_chain_overrides === null) {
          errors.push("tasks.review_chain_overrides must be an object");
        } else {
          errors.push(...validateReviewChainOverrides(obj.review_chain_overrides));
        }
      }
    }
    return errors;
  },
});

// --- Database tables ---

registerTable({
  name: "tasks",
  createSQL: `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog'
      CHECK(status IN ('backlog','todo','in_progress','in_review','done','cancelled')),
    priority TEXT NOT NULL DEFAULT 'medium'
      CHECK(priority IN ('critical','high','medium','low')),
    assignee TEXT,
    reviewer TEXT,
    department TEXT,
    project TEXT,
    parent_id INTEGER,
    deadline TEXT,
    created_by TEXT NOT NULL DEFAULT 'human-founder',
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)",
  ],
});

registerTable({
  name: "task_blockers",
  createSQL: `CREATE TABLE IF NOT EXISTS task_blockers (
    task_id INTEGER NOT NULL,
    blocker_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, blocker_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (blocker_id) REFERENCES tasks(id) ON DELETE CASCADE
  )`,
});

registerTable({
  name: "task_comments",
  createSQL: `CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    comment_type TEXT NOT NULL DEFAULT 'comment'
      CHECK(comment_type IN ('comment','status_change','assignment','review_request','review_result')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id)",
  ],
});

// --- Context provider ---

registerContextProvider("task-board", async (config, projectDir) => {
  // Set module-level projectDir so the message handler can use it.
  // Safe because AICIB runs one session per process; background workers
  // are separate Node processes with their own module scope.
  lastProjectDir = projectDir;

  const tasksConfig = config.extensions?.tasks as TasksConfig | undefined;
  if (tasksConfig && !tasksConfig.enabled) return "";

  const maxTasks = tasksConfig?.max_context_tasks ?? 15;
  if (maxTasks === 0) return "";

  let tm: TaskManager | undefined;
  try {
    tm = new TaskManager(projectDir);
    return tm.formatForContext(undefined, undefined, maxTasks);
  } catch {
    // Task system not initialized yet — skip silently
    return "";
  } finally {
    tm?.close();
  }
});

// --- Message handler ---

// Debounced task update queue to avoid per-message DB churn
interface PendingUpdate {
  type: "create" | "update" | "comment";
  data: Record<string, string>;
}

let pendingUpdates: PendingUpdate[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Module-level projectDir set by the context provider and read by the message handler.
// Safe: AICIB runs one session per CLI process; background workers are separate Node processes.
let lastProjectDir: string | null = null;

function queueUpdate(
  update: PendingUpdate,
  projectDir: string
): void {
  lastProjectDir = projectDir;
  pendingUpdates.push(update);
  if (!flushTimer) {
    flushTimer = setTimeout(() => flushPendingUpdates(), 500);
  }
}

function flushPendingUpdates(): void {
  flushTimer = null;
  if (pendingUpdates.length === 0 || !lastProjectDir) return;

  const updates = pendingUpdates;
  pendingUpdates = [];

  let tm: TaskManager | undefined;
  try {
    tm = new TaskManager(lastProjectDir);

    for (const update of updates) {
      try {
        switch (update.type) {
          case "create": {
            const { title, department, assigned, priority } = update.data;
            if (!title?.trim()) break;
            tm.createTask({
              title,
              department: department || undefined,
              assignee: assigned || undefined,
              priority: (priority as TaskPriority) || "medium",
              created_by: "ceo",
            });
            break;
          }
          case "update": {
            const id = parseInt(update.data.id, 10);
            if (Number.isNaN(id)) break;
            const fields: Record<string, unknown> = {};
            if (update.data.status && VALID_STATUSES.includes(update.data.status as TaskStatus)) {
              fields.status = update.data.status;
            }
            if (update.data.assigned) {
              fields.assignee = update.data.assigned;
            }
            if (update.data.priority && VALID_PRIORITIES.includes(update.data.priority as TaskPriority)) {
              fields.priority = update.data.priority;
            }
            if (Object.keys(fields).length > 0) {
              tm.updateTask(id, fields);
            }
            break;
          }
          case "comment": {
            const id = parseInt(update.data.id, 10);
            if (Number.isNaN(id) || !update.data.content) break;
            tm.addComment(id, update.data.author || "agent", update.data.content);
            break;
          }
        }
      } catch (e) {
        console.warn("Task update failed:", e);
      }
    }
  } catch (e) {
    console.warn("Task flush DB error:", e);
  } finally {
    tm?.close();
  }
}

registerMessageHandler("task-actions", (msg, config) => {
  const tasksConfig = config.extensions?.tasks as TasksConfig | undefined;
  if (tasksConfig && !tasksConfig.enabled) return;

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

  // Determine project dir from config (available in extensions)
  // The config object doesn't directly contain projectDir, so we use a module-level
  // reference set during context provider calls. This is safe because the message
  // handler runs in the same process as the context provider.
  if (!lastProjectDir) return;

  // Parse structured TASK:: markers
  // TASK::CREATE uses order-independent key=value pairs after the required title.
  const createMatches = text.matchAll(
    /TASK::CREATE\s+title="([^"]+)"((?:\s+(?:department|assigned|priority)=\S+)*)/g
  );
  for (const match of createMatches) {
    const rest = match[2] || "";
    const deptMatch = rest.match(/department=(\S+)/);
    const assignMatch = rest.match(/assigned=([\w-]+)/);
    const prioMatch = rest.match(/priority=(critical|high|medium|low)/);
    queueUpdate(
      {
        type: "create",
        data: {
          title: match[1],
          department: deptMatch?.[1] || "",
          assigned: assignMatch?.[1] || "",
          priority: prioMatch?.[1] || "medium",
        },
      },
      lastProjectDir
    );
  }

  const updateMatches = text.matchAll(
    /TASK::UPDATE\s+id=(\d+)\s+status=(\w+)/g
  );
  for (const match of updateMatches) {
    queueUpdate(
      {
        type: "update",
        data: { id: match[1], status: match[2] },
      },
      lastProjectDir
    );
  }

  const commentMatches = text.matchAll(
    /TASK::COMMENT\s+id=(\d+)\s+"([^"]+)"/g
  );
  for (const match of commentMatches) {
    queueUpdate(
      {
        type: "comment",
        data: { id: match[1], content: match[2], author: "agent" },
      },
      lastProjectDir
    );
  }

  // Natural language fallback patterns — require "task" before #N to reduce false positives.
  // Use matchAll with `g` flag so "completed task #5 and task #3" updates both.
  const completionMatches = text.matchAll(
    /(?:completed?|finished|done with|closed)\s+task\s+#(\d+)/gi
  );
  for (const completionMatch of completionMatches) {
    queueUpdate(
      {
        type: "update",
        data: { id: completionMatch[1], status: "done" },
      },
      lastProjectDir
    );
  }

  const startMatches = text.matchAll(
    /(?:starting|working on|picking up|began)\s+task\s+#(\d+)/gi
  );
  for (const startMatch of startMatches) {
    queueUpdate(
      {
        type: "update",
        data: { id: startMatch[1], status: "in_progress" },
      },
      lastProjectDir
    );
  }

  const reviewMatches = text.matchAll(
    /(?:submitting|requesting review|ready for review)\s+task\s+#(\d+)/gi
  );
  for (const reviewMatch of reviewMatches) {
    queueUpdate(
      {
        type: "update",
        data: { id: reviewMatch[1], status: "in_review" },
      },
      lastProjectDir
    );
  }
});
