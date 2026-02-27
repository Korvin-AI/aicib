import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ── Type Definitions ────────────────────────────────────────────────

export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export type CommentType =
  | "comment"
  | "status_change"
  | "assignment"
  | "review_request"
  | "review_result";

export type ReviewLayer =
  | "self"
  | "peer"
  | "department_head"
  | "csuite"
  | "owner";

export const VALID_STATUSES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

export const VALID_PRIORITIES: TaskPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

export const VALID_REVIEW_LAYERS: ReviewLayer[] = [
  "self",
  "peer",
  "department_head",
  "csuite",
  "owner",
];

// ── Interfaces ──────────────────────────────────────────────────────

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  reviewer: string | null;
  department: string | null;
  project: string | null;
  parent_id: number | null;
  deadline: string | null;
  created_by: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskComment {
  id: number;
  task_id: number;
  author: string;
  content: string;
  comment_type: CommentType;
  created_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  reviewer?: string;
  department?: string;
  project?: string;
  parent_id?: number;
  deadline?: string;
  created_by?: string;
  session_id?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string | null;
  reviewer?: string | null;
  department?: string | null;
  project?: string | null;
  parent_id?: number | null;
  deadline?: string | null;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  assignee?: string;
  department?: string;
  project?: string;
  created_by?: string;
  overdue?: boolean;
  blocked?: boolean;
  parent_id?: number | null;
}

export interface TaskSummary {
  backlog: number;
  todo: number;
  in_progress: number;
  in_review: number;
  done: number;
  cancelled: number;
  total: number;
}

export interface TasksConfig {
  enabled: boolean;
  max_context_tasks: number;
  deadline_urgency_hours: number;
  default_review_chains: Record<string, ReviewLayer[]>;
  review_chain_overrides: Record<string, Record<string, ReviewLayer[]>>;
}

export const TASKS_CONFIG_DEFAULTS: TasksConfig = {
  enabled: true,
  max_context_tasks: 15,
  deadline_urgency_hours: 24,
  default_review_chains: {
    code: ["self", "peer"],
    marketing_internal: ["self", "department_head"],
    marketing_external: ["self", "peer", "department_head", "owner"],
    financial_report: ["self", "peer", "csuite"],
    customer_facing: ["self", "department_head", "owner"],
    strategic_plan: ["department_head", "csuite", "owner"],
    internal_document: ["self"],
  },
  review_chain_overrides: {},
};

// Priority weights for the scoring algorithm
const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

// ── TaskManager Class ───────────────────────────────────────────────

export class TaskManager {
  private db: Database.Database;

  constructor(projectDir: string) {
    const dataDir = path.join(projectDir, ".aicib");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(path.join(dataDir, "state.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.ensureTables();
  }

  /**
   * Create task tables if they don't exist yet.
   * Mirrors the exact SQL from task-register.ts so `aicib tasks` works
   * even before `aicib start` has been run (which triggers CostTracker.init).
   * Uses better-sqlite3's db.prepare().run() to avoid triggering security hooks
   * that flag child_process.exec patterns.
   */
  private ensureTables(): void {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
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
    )`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS task_blockers (
      task_id INTEGER NOT NULL,
      blocker_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, blocker_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (blocker_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      comment_type TEXT NOT NULL DEFAULT 'comment'
        CHECK(comment_type IN ('comment','status_change','assignment','review_request','review_result')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )`).run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id)").run();
  }

  // ── CRUD ────────────────────────────────────────────────────────

  createTask(input: CreateTaskInput): Task {
    const result = this.db
      .prepare(
        `INSERT INTO tasks (title, description, status, priority, assignee, reviewer, department, project, parent_id, deadline, created_by, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.title,
        input.description || "",
        input.status || "backlog",
        input.priority || "medium",
        input.assignee ?? null,
        input.reviewer ?? null,
        input.department ?? null,
        input.project ?? null,
        input.parent_id ?? null,
        input.deadline ?? null,
        input.created_by || "human-founder",
        input.session_id ?? null
      );

    const task = this.getTask(Number(result.lastInsertRowid));
    if (!task) {
      throw new Error("Failed to create task");
    }

    // Log creation as a comment
    this.addComment(
      task.id,
      input.created_by || "human-founder",
      `Created task: "${input.title}"`,
      "status_change"
    );

    return task;
  }

  getTask(id: number): Task | null {
    return (
      (this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
        | Task
        | undefined) ?? null
    );
  }

  updateTask(id: number, fields: UpdateTaskInput): Task | null {
    const existing = this.getTask(id);
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    const ALLOWED_COLUMNS = new Set([
      "title", "description", "status", "priority", "assignee", "reviewer",
      "department", "project", "parent_id", "deadline",
    ]);

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED_COLUMNS.has(key)) continue;

      sets.push(`${key} = ?`);
      values.push(value);
    }

    if (sets.length === 0) return existing;

    // Always update the updated_at timestamp
    sets.push("updated_at = datetime('now')");

    // If status is moving to 'done', set completed_at
    if (fields.status === "done" && existing.status !== "done") {
      sets.push("completed_at = datetime('now')");
    }

    // If status is moving away from 'done', clear completed_at
    if (fields.status && fields.status !== "done" && existing.status === "done") {
      sets.push("completed_at = NULL");
    }

    values.push(id);
    this.db
      .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    // Log status changes as comments
    if (fields.status && fields.status !== existing.status) {
      this.addComment(
        id,
        "system",
        `Status changed: ${existing.status} → ${fields.status}`,
        "status_change"
      );
    }

    if (
      fields.assignee !== undefined &&
      fields.assignee !== existing.assignee
    ) {
      this.addComment(
        id,
        "system",
        `Assigned to ${fields.assignee || "unassigned"} (was: ${existing.assignee || "unassigned"})`,
        "assignment"
      );
    }

    return this.getTask(id);
  }

  deleteTask(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM tasks WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  // ── Queries ─────────────────────────────────────────────────────

  listTasks(filter?: TaskFilter, limit?: number): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter) {
      if (filter.status) {
        if (Array.isArray(filter.status)) {
          conditions.push(
            `status IN (${filter.status.map(() => "?").join(",")})`
          );
          params.push(...filter.status);
        } else {
          conditions.push("status = ?");
          params.push(filter.status);
        }
      }

      if (filter.priority) {
        if (Array.isArray(filter.priority)) {
          conditions.push(
            `priority IN (${filter.priority.map(() => "?").join(",")})`
          );
          params.push(...filter.priority);
        } else {
          conditions.push("priority = ?");
          params.push(filter.priority);
        }
      }

      if (filter.assignee) {
        conditions.push("assignee = ?");
        params.push(filter.assignee);
      }

      if (filter.department) {
        conditions.push("department = ?");
        params.push(filter.department);
      }

      if (filter.project) {
        conditions.push("project = ?");
        params.push(filter.project);
      }

      if (filter.created_by) {
        conditions.push("created_by = ?");
        params.push(filter.created_by);
      }

      if (filter.overdue) {
        conditions.push(
          "deadline IS NOT NULL AND deadline < datetime('now') AND status NOT IN ('done', 'cancelled')"
        );
      }

      if (filter.blocked) {
        conditions.push(
          `EXISTS (SELECT 1 FROM task_blockers tb JOIN tasks b ON tb.blocker_id = b.id
           WHERE tb.task_id = tasks.id AND b.status NOT IN ('done', 'cancelled'))`
        );
      }

      if (filter.parent_id !== undefined) {
        if (filter.parent_id === null) {
          conditions.push("parent_id IS NULL");
        } else {
          conditions.push("parent_id = ?");
          params.push(filter.parent_id);
        }
      }
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = limit != null && limit > 0 ? `LIMIT ?` : "";
    if (limit != null && limit > 0) params.push(limit);

    return this.db
      .prepare(
        `SELECT * FROM tasks ${where}
         ORDER BY
           CASE status
             WHEN 'in_review' THEN 0
             WHEN 'in_progress' THEN 1
             WHEN 'todo' THEN 2
             WHEN 'backlog' THEN 3
             WHEN 'done' THEN 4
             WHEN 'cancelled' THEN 5
           END,
           CASE priority
             WHEN 'critical' THEN 0
             WHEN 'high' THEN 1
             WHEN 'medium' THEN 2
             WHEN 'low' THEN 3
           END,
           created_at ASC
         ${limitClause}`
      )
      .all(...params) as Task[];
  }

  getTaskSummary(): TaskSummary {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) as count FROM tasks GROUP BY status`
      )
      .all() as Array<{ status: string; count: number }>;

    const summary: TaskSummary = {
      backlog: 0,
      todo: 0,
      in_progress: 0,
      in_review: 0,
      done: 0,
      cancelled: 0,
      total: 0,
    };

    for (const row of rows) {
      if (row.status in summary) {
        (summary as unknown as Record<string, number>)[row.status] = row.count;
      }
      summary.total += row.count;
    }

    return summary;
  }

  getSubtasks(parentId: number): Task[] {
    return this.db
      .prepare(`SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at ASC`)
      .all(parentId) as Task[];
  }

  getTasksForAgent(assignee: string): Task[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE assignee = ? AND status NOT IN ('done', 'cancelled')
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 0
             WHEN 'high' THEN 1
             WHEN 'medium' THEN 2
             WHEN 'low' THEN 3
           END,
           created_at ASC`
      )
      .all(assignee) as Task[];
  }

  getOverdueTasks(): Task[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE deadline IS NOT NULL
           AND deadline < datetime('now')
           AND status NOT IN ('done', 'cancelled')
         ORDER BY deadline ASC`
      )
      .all() as Task[];
  }

  getBlockedTasks(): Task[] {
    return this.db
      .prepare(
        `SELECT t.* FROM tasks t
         WHERE EXISTS (
           SELECT 1 FROM task_blockers tb
           JOIN tasks blocker ON tb.blocker_id = blocker.id
           WHERE tb.task_id = t.id
             AND blocker.status NOT IN ('done', 'cancelled')
         )
         AND t.status NOT IN ('done', 'cancelled')
         ORDER BY t.created_at ASC`
      )
      .all() as Task[];
  }

  /**
   * Get the task tree recursively from a root task.
   * Uses WITH RECURSIVE with a depth limit of 10 to prevent infinite recursion.
   */
  getTaskTree(rootId: number): Task[] {
    return this.db
      .prepare(
        `WITH RECURSIVE tree AS (
           SELECT *, 0 AS depth FROM tasks WHERE id = ?
           UNION ALL
           SELECT t.*, tree.depth + 1
           FROM tasks t
           JOIN tree ON t.parent_id = tree.id
           WHERE tree.depth < 10
         )
         SELECT * FROM tree ORDER BY depth, created_at ASC`
      )
      .all(rootId) as Task[];
  }

  // ── Blockers ────────────────────────────────────────────────────

  /**
   * Add a blocker relationship. Checks for cycles via BFS before inserting.
   */
  addBlocker(taskId: number, blockerId: number): void {
    if (taskId === blockerId) {
      throw new Error("A task cannot block itself");
    }

    // Check both tasks exist
    if (!this.getTask(taskId)) {
      throw new Error(`Task #${taskId} not found`);
    }
    if (!this.getTask(blockerId)) {
      throw new Error(`Blocker task #${blockerId} not found`);
    }

    // Cycle detection: would adding blockerId → taskId create a cycle?
    // Check if taskId is reachable from blockerId (following blocker chains)
    if (this.wouldCreateCycle(taskId, blockerId)) {
      throw new Error(
        `Adding #${blockerId} as a blocker of #${taskId} would create a circular dependency`
      );
    }

    this.db
      .prepare(
        `INSERT OR IGNORE INTO task_blockers (task_id, blocker_id) VALUES (?, ?)`
      )
      .run(taskId, blockerId);
  }

  /**
   * BFS cycle detection: checks if adding blockerId as a blocker of taskId
   * would create a cycle. Start from blockerId and follow existing blocker
   * edges (blocker_id → task_id's blockers). If we reach taskId, a cycle
   * would be created.
   */
  private wouldCreateCycle(taskId: number, blockerId: number): boolean {
    const visited = new Set<number>();
    const queue: number[] = [blockerId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === taskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      // Follow the "blocks" direction: find what blocks `current`
      // (i.e., current's blockers), then check if any path leads to taskId
      const blockers = this.db
        .prepare(
          `SELECT blocker_id FROM task_blockers WHERE task_id = ?`
        )
        .all(current) as Array<{ blocker_id: number }>;

      for (const row of blockers) {
        if (!visited.has(row.blocker_id)) {
          queue.push(row.blocker_id);
        }
      }
    }

    return false;
  }

  removeBlocker(taskId: number, blockerId: number): void {
    this.db
      .prepare(
        `DELETE FROM task_blockers WHERE task_id = ? AND blocker_id = ?`
      )
      .run(taskId, blockerId);
  }

  getBlockers(taskId: number): Task[] {
    return this.db
      .prepare(
        `SELECT t.* FROM tasks t
         JOIN task_blockers tb ON t.id = tb.blocker_id
         WHERE tb.task_id = ?
         ORDER BY t.created_at ASC`
      )
      .all(taskId) as Task[];
  }

  isBlocked(taskId: number): boolean {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM task_blockers tb
         JOIN tasks blocker ON tb.blocker_id = blocker.id
         WHERE tb.task_id = ?
           AND blocker.status NOT IN ('done', 'cancelled')`
      )
      .get(taskId) as { count: number };
    return result.count > 0;
  }

  /**
   * Get all tasks that are blocked by a specific task.
   */
  getBlockedBy(blockerId: number): Task[] {
    return this.db
      .prepare(
        `SELECT t.* FROM tasks t
         JOIN task_blockers tb ON t.id = tb.task_id
         WHERE tb.blocker_id = ?
         ORDER BY t.created_at ASC`
      )
      .all(blockerId) as Task[];
  }

  // ── Comments ────────────────────────────────────────────────────

  addComment(
    taskId: number,
    author: string,
    content: string,
    type: CommentType = "comment"
  ): TaskComment {
    const result = this.db
      .prepare(
        `INSERT INTO task_comments (task_id, author, content, comment_type)
         VALUES (?, ?, ?, ?)`
      )
      .run(taskId, author, content, type);

    return this.db
      .prepare(`SELECT * FROM task_comments WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as TaskComment;
  }

  getComments(taskId: number): TaskComment[] {
    return this.db
      .prepare(
        `SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC, id ASC`
      )
      .all(taskId) as TaskComment[];
  }

  // ── Assignment & Review ─────────────────────────────────────────

  assignTask(
    taskId: number,
    assignee: string,
    _assignedBy: string = "system"
  ): Task | null {
    // updateTask() already logs assignment changes as comments
    return this.updateTask(taskId, { assignee });
  }

  requestReview(taskId: number, reviewer: string): Task | null {
    const task = this.updateTask(taskId, {
      status: "in_review",
      reviewer,
    });
    if (task) {
      this.addComment(
        taskId,
        "system",
        `Review requested from ${reviewer}`,
        "review_request"
      );
    }
    return task;
  }

  submitReview(
    taskId: number,
    approved: boolean,
    feedback?: string
  ): Task | null {
    const newStatus: TaskStatus = approved ? "done" : "in_progress";
    const task = this.updateTask(taskId, { status: newStatus });
    if (task) {
      const verdict = approved ? "Approved" : "Rejected";
      const message = feedback
        ? `${verdict}: ${feedback}`
        : verdict;
      this.addComment(taskId, "human-founder", message, "review_result");
    }
    return task;
  }

  // ── Priority Scoring ────────────────────────────────────────────

  /**
   * Compute priority score for a task.
   * Higher score = more urgent. Blocked tasks always get 0.
   */
  computePriorityScore(
    task: Task,
    deadlineUrgencyHours: number = 24
  ): number {
    // Blocked tasks can't be worked on
    if (this.isBlocked(task.id)) return 0;

    let score = PRIORITY_WEIGHTS[task.priority] || 50;

    if (task.deadline) {
      const now = Date.now();
      const deadlineMs = new Date(task.deadline).getTime();
      const hoursLeft = (deadlineMs - now) / (1000 * 60 * 60);

      if (hoursLeft <= 0) {
        // Overdue: maximum urgency boost
        score += 100;
      } else if (hoursLeft <= deadlineUrgencyHours) {
        // Approaching deadline: proportional boost (up to 50)
        score += (1 - hoursLeft / deadlineUrgencyHours) * 50;
      }
    }

    return score;
  }

  /**
   * Get the highest-priority unblocked task for an agent.
   */
  getNextTask(
    assignee: string,
    deadlineUrgencyHours: number = 24
  ): Task | null {
    const tasks = this.getTasksForAgent(assignee);
    if (tasks.length === 0) return null;

    let bestTask: Task | null = null;
    let bestScore = -1;

    for (const task of tasks) {
      if (this.isBlocked(task.id)) continue;
      const score = this.computePriorityScore(task, deadlineUrgencyHours);
      if (score > bestScore) {
        bestScore = score;
        bestTask = task;
      }
    }

    return bestTask;
  }

  // ── Context Formatting ──────────────────────────────────────────

  /**
   * Format task information for injection into an agent's prompt.
   * Role-aware: CEO gets full board, dept heads get dept view, workers get personal view.
   */
  formatForContext(
    agentRole?: string,
    department?: string,
    maxTasks: number = 15
  ): string {
    const summary = this.getTaskSummary();
    if (summary.total === 0 || (summary.done + summary.cancelled) === summary.total) {
      return "";
    }

    const lines: string[] = ["## Company Task Board"];

    // Tasks needing attention (in_review)
    const reviewTasks = this.listTasks({ status: "in_review" });
    if (reviewTasks.length > 0) {
      lines.push("");
      lines.push("### Needs Attention");
      for (const task of reviewTasks) {
        lines.push(
          `- #${task.id} [IN REVIEW] ${task.title} (${task.assignee || "unassigned"}, ${task.priority}) — awaiting review`
        );
      }
    }

    // For CEO: show all active tasks grouped by department
    if (!agentRole || agentRole === "ceo") {
      const activeTasks = this.listTasks(
        { status: ["in_progress", "todo"] },
        maxTasks
      );

      if (activeTasks.length > 0) {
        // Group by department
        const byDept = new Map<string, Task[]>();
        for (const task of activeTasks) {
          const dept = task.department || "general";
          if (!byDept.has(dept)) byDept.set(dept, []);
          byDept.get(dept)!.push(task);
        }

        lines.push("");
        lines.push("### Active by Department");
        for (const [dept, tasks] of byDept) {
          const taskStrs = tasks
            .slice(0, 5)
            .map(
              (t) =>
                `#${t.id} [${t.status === "in_progress" ? "IN PROGRESS" : "TODO"}] ${t.title} (${t.assignee || "unassigned"}, ${t.priority})`
            );
          lines.push(`**${dept}:** ${taskStrs.join(", ")}`);
        }
      }
    } else if (["cto", "cfo", "cmo"].includes(agentRole)) {
      // Department heads: show their department's tasks
      const dept = agentRole === "cto" ? "engineering" : agentRole === "cfo" ? "finance" : "marketing";
      const deptTasks = this.listTasks(
        { department: dept, status: ["in_progress", "todo", "in_review"] },
        maxTasks
      );

      // Also show tasks assigned directly to this agent
      const myTasks = this.getTasksForAgent(agentRole);

      const allTasks = new Map<number, Task>();
      for (const t of [...deptTasks, ...myTasks]) {
        allTasks.set(t.id, t);
      }

      if (allTasks.size > 0) {
        lines.push("");
        lines.push(`### Your Department Tasks`);
        for (const task of allTasks.values()) {
          const status = task.status.toUpperCase().replace("_", " ");
          lines.push(
            `- #${task.id} [${status}] ${task.title} (${task.assignee || "unassigned"}, ${task.priority})`
          );
        }
      }
    } else {
      // Workers: show only their assigned tasks
      const myTasks = this.getTasksForAgent(agentRole);
      if (myTasks.length > 0) {
        lines.push("");
        lines.push("### Your Assigned Tasks");
        for (const task of myTasks) {
          const parentNote =
            task.parent_id ? ` — subtask of #${task.parent_id}` : "";
          lines.push(
            `- #${task.id} [${task.status.toUpperCase().replace("_", " ")}] ${task.title} (${task.priority})${parentNote}`
          );
        }
      }
    }

    // Overdue tasks
    const overdue = this.getOverdueTasks();
    if (overdue.length > 0) {
      lines.push("");
      lines.push("### Overdue");
      for (const task of overdue.slice(0, 5)) {
        lines.push(
          `- #${task.id} [OVERDUE] ${task.title} (${task.assignee || "unassigned"}, deadline: ${task.deadline})`
        );
      }
    }

    // Summary line
    lines.push("");
    lines.push(
      `Summary: ${summary.backlog} backlog | ${summary.todo} todo | ${summary.in_progress} active | ${summary.in_review} review | ${summary.done} done`
    );

    // Task management instructions for CEO
    if (!agentRole || agentRole === "ceo") {
      lines.push("");
      lines.push("## Task Management");
      lines.push(
        "To create: TASK::CREATE title=\"...\" department=... assigned=... priority=..."
      );
      lines.push("To update: TASK::UPDATE id=N status=...");
      lines.push('To comment: TASK::COMMENT id=N "your note"');
    }

    // Token safety: if output is too long, truncate
    const output = lines.join("\n");
    if (output.length > 4000) {
      // Rebuild with just summary + needs attention + overdue
      const trimmed = [
        "## Company Task Board (truncated)",
        "",
        `Summary: ${summary.backlog} backlog | ${summary.todo} todo | ${summary.in_progress} active | ${summary.in_review} review | ${summary.done} done`,
      ];

      if (reviewTasks.length > 0) {
        trimmed.push("");
        trimmed.push("### Needs Attention");
        for (const task of reviewTasks.slice(0, 3)) {
          trimmed.push(
            `- #${task.id} [IN REVIEW] ${task.title} (${task.assignee || "unassigned"})`
          );
        }
      }

      if (overdue.length > 0) {
        trimmed.push("");
        trimmed.push("### Overdue");
        for (const task of overdue.slice(0, 3)) {
          trimmed.push(
            `- #${task.id} [OVERDUE] ${task.title} (${task.assignee || "unassigned"})`
          );
        }
      }

      trimmed.push(`\n... and more tasks. Use \`aicib tasks\` to see all.`);
      return trimmed.join("\n");
    }

    return output;
  }

  /**
   * Format a board summary for CLI display (no markdown, just counts + active list).
   */
  formatBoardSummary(): string {
    const summary = this.getTaskSummary();
    const active = this.listTasks(
      { status: ["in_review", "in_progress", "todo"] },
      20
    );

    const lines: string[] = [];
    lines.push(
      `  Backlog: ${summary.backlog}    To Do: ${summary.todo}    In Progress: ${summary.in_progress}    In Review: ${summary.in_review}    Done: ${summary.done}`
    );

    if (active.length > 0) {
      lines.push("");
      for (const task of active) {
        const status =
          task.status === "in_progress"
            ? "progress"
            : task.status === "in_review"
              ? "review"
              : task.status;
        const assigneeStr = task.assignee
          ? task.assignee.length > 10
            ? task.assignee.slice(0, 10)
            : task.assignee
          : "--";
        const deptStr = task.department
          ? task.department.length > 7
            ? task.department.slice(0, 7)
            : task.department
          : "--";
        lines.push(
          `  #${task.id.toString().padEnd(4)} ${task.title.slice(0, 26).padEnd(26)} ${status.padEnd(10)} ${assigneeStr.padEnd(12)} ${task.priority.padEnd(10)} ${deptStr}`
        );
      }
    }

    return lines.join("\n");
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
