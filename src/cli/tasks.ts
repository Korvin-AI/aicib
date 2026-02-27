import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { loadConfig, listAllAgents } from "../core/config.js";
import {
  TaskManager,
  VALID_STATUSES,
  VALID_PRIORITIES,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskFilter,
} from "../core/task-manager.js";
import {
  header,
  createTable,
  agentColor,
  formatTimeAgo,
} from "./ui.js";

// ── Helpers ───────────────────────────────────────────────────────

function getTaskManager(dir: string): TaskManager {
  const projectDir = path.resolve(dir);

  // Validate project exists
  try {
    loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  return new TaskManager(projectDir);
}

function formatStatus(status: TaskStatus): string {
  switch (status) {
    case "in_progress":
      return chalk.cyan("progress");
    case "in_review":
      return chalk.yellow("review");
    case "done":
      return chalk.green("done");
    case "cancelled":
      return chalk.red("cancelled");
    case "todo":
      return chalk.white("todo");
    case "backlog":
      return chalk.dim("backlog");
    default:
      return chalk.dim(status);
  }
}

function formatPriority(priority: TaskPriority): string {
  switch (priority) {
    case "critical":
      return chalk.red.bold("critical");
    case "high":
      return chalk.yellow("high");
    case "medium":
      return chalk.white("medium");
    case "low":
      return chalk.dim("low");
    default:
      return chalk.dim(priority);
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

// ── Commands ──────────────────────────────────────────────────────

interface TasksOptions {
  dir: string;
}

/**
 * Default `aicib tasks` — shows a dashboard summary.
 */
export async function tasksCommand(options: TasksOptions): Promise<void> {
  const tm = getTaskManager(options.dir);

  try {
    console.log(header("Tasks"));

    const summary = tm.getTaskSummary();

    if (summary.total === 0) {
      console.log(chalk.dim("  No tasks yet."));
      console.log(
        chalk.dim(
          "  Create one with: aicib tasks create --title \"My task\"\n"
        )
      );
      return;
    }

    // Summary line
    console.log(chalk.bold("  Summary:"));
    console.log(
      `    Backlog: ${chalk.dim(String(summary.backlog))}` +
        `    To Do: ${chalk.white(String(summary.todo))}` +
        `    In Progress: ${chalk.cyan(String(summary.in_progress))}` +
        `    In Review: ${chalk.yellow(String(summary.in_review))}` +
        `    Done: ${chalk.green(String(summary.done))}`
    );
    console.log();

    // Active tasks table
    const activeTasks = tm.listTasks(
      { status: ["in_review", "in_progress", "todo", "backlog"] as TaskStatus[] },
      20
    );

    if (activeTasks.length > 0) {
      const table = createTable(
        ["ID", "Title", "Status", "Assigned", "Priority", "Dept"],
        [6, 28, 10, 12, 10, 9]
      );

      for (const task of activeTasks) {
        const assigneeStr = task.assignee
          ? agentColor(task.assignee)(truncate(task.assignee, 10))
          : chalk.dim("--");
        const deptStr = task.department
          ? truncate(task.department, 7)
          : chalk.dim("--");

        table.push([
          String(task.id),
          truncate(task.title, 26),
          formatStatus(task.status),
          assigneeStr,
          formatPriority(task.priority),
          deptStr,
        ]);
      }

      console.log(table.toString());
      console.log();
    }

    // Review prompt
    if (summary.in_review > 0) {
      console.log(
        chalk.yellow(
          `  ${summary.in_review} task${summary.in_review > 1 ? "s" : ""} awaiting your review. Run: ${chalk.bold("aicib tasks review")}`
        )
      );
      console.log();
    }
  } finally {
    tm.close();
  }
}

// ── List ──────────────────────────────────────────────────────────

interface ListOptions extends TasksOptions {
  status?: string;
  department?: string;
  assigned?: string;
  priority?: string;
  overdue?: boolean;
  blocked?: boolean;
  limit?: string;
}

export async function tasksListCommand(options: ListOptions): Promise<void> {
  const tm = getTaskManager(options.dir);

  try {
    const filter: TaskFilter = {};
    const filterLabels: string[] = [];

    if (options.status) {
      const statuses = options.status.split(",") as TaskStatus[];
      for (const s of statuses) {
        if (!VALID_STATUSES.includes(s)) {
          console.error(
            chalk.red(
              `  Error: Invalid status "${s}". Valid: ${VALID_STATUSES.join(", ")}`
            )
          );
          tm.close();
          process.exit(1);
        }
      }
      filter.status = statuses.length === 1 ? statuses[0] : statuses;
      filterLabels.push(`status=${options.status}`);
    }

    if (options.department) {
      filter.department = options.department;
      filterLabels.push(`department=${options.department}`);
    }

    if (options.assigned) {
      filter.assignee = options.assigned;
      filterLabels.push(`assigned=${options.assigned}`);
    }

    if (options.priority) {
      if (!VALID_PRIORITIES.includes(options.priority as TaskPriority)) {
        console.error(
          chalk.red(
            `  Error: Invalid priority "${options.priority}". Valid: ${VALID_PRIORITIES.join(", ")}`
          )
        );
        tm.close();
        process.exit(1);
      }
      filter.priority = options.priority as TaskPriority;
      filterLabels.push(`priority=${options.priority}`);
    }

    if (options.overdue) {
      filter.overdue = true;
      filterLabels.push("overdue");
    }

    if (options.blocked) {
      filter.blocked = true;
      filterLabels.push("blocked");
    }

    const limit = options.limit ? parseInt(options.limit, 10) : 50;
    if (Number.isNaN(limit) || limit <= 0) {
      console.error(chalk.red("  Error: --limit must be a positive number."));
      tm.close();
      process.exit(1);
    }

    const filterStr =
      filterLabels.length > 0
        ? ` (filtered: ${filterLabels.join(", ")})`
        : "";
    console.log(header(`Tasks${filterStr}`));

    const tasks = tm.listTasks(filter, limit);

    if (tasks.length === 0) {
      console.log(chalk.dim("  No tasks match the filter.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Title", "Status", "Assigned", "Priority", "Dept", "Created"],
      [6, 26, 10, 12, 10, 9, 10]
    );

    for (const task of tasks) {
      const assigneeStr = task.assignee
        ? agentColor(task.assignee)(truncate(task.assignee, 10))
        : chalk.dim("--");
      const deptStr = task.department
        ? truncate(task.department, 7)
        : chalk.dim("--");
      const createdStr =
        task.status === "done" && task.completed_at
          ? formatTimeAgo(task.completed_at)
          : formatTimeAgo(task.created_at);

      table.push([
        String(task.id),
        truncate(task.title, 24),
        formatStatus(task.status),
        assigneeStr,
        formatPriority(task.priority),
        deptStr,
        chalk.dim(createdStr),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  Showing ${tasks.length} tasks.\n`));
  } finally {
    tm.close();
  }
}

// ── Create ────────────────────────────────────────────────────────

interface CreateOptions extends TasksOptions {
  title?: string;
  description?: string;
  department?: string;
  assign?: string;
  priority?: string;
  parent?: string;
  deadline?: string;
  interactive?: boolean;
}

export async function tasksCreateCommand(
  options: CreateOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
    return;
  }

  const tm = new TaskManager(projectDir);

  try {
    let title = options.title;
    let description = options.description || "";
    let department = options.department;
    let assignee = options.assign;
    let priority = (options.priority || "medium") as TaskPriority;
    let parentId: number | undefined;

    // Interactive mode
    if (options.interactive || !title) {
      const agents = listAllAgents(config);
      const agentChoices = [
        { name: "Unassigned", value: "" },
        ...agents.map((a) => ({
          name: `${a.role} (${a.department})`,
          value: a.role,
        })),
      ];

      const deptChoices = [
        { name: "None", value: "" },
        { name: "Engineering (CTO)", value: "engineering" },
        { name: "Finance (CFO)", value: "finance" },
        { name: "Marketing (CMO)", value: "marketing" },
      ];

      const answers = await inquirer.prompt([
        {
          type: "input",
          name: "title",
          message: "Task title:",
          default: title,
          validate: (v: string) =>
            v.trim().length > 0 || "Title is required",
        },
        {
          type: "input",
          name: "description",
          message: "Description (optional):",
          default: description,
        },
        {
          type: "list",
          name: "department",
          message: "Department:",
          choices: deptChoices,
          default: department || "",
        },
        {
          type: "list",
          name: "assignee",
          message: "Assign to:",
          choices: agentChoices,
          default: assignee || "",
        },
        {
          type: "list",
          name: "priority",
          message: "Priority:",
          choices: VALID_PRIORITIES.map((p) => ({
            name: `${p.charAt(0).toUpperCase() + p.slice(1)}`,
            value: p,
          })),
          default: priority,
        },
        {
          type: "input",
          name: "parentId",
          message: "Parent task ID (leave blank for top-level):",
          default: options.parent || "",
        },
      ]);

      title = answers.title;
      description = answers.description;
      department = answers.department || undefined;
      assignee = answers.assignee || undefined;
      priority = answers.priority;
      parentId = answers.parentId
        ? parseInt(answers.parentId, 10)
        : undefined;
    } else {
      // Flag mode
      if (!VALID_PRIORITIES.includes(priority)) {
        console.error(
          chalk.red(
            `  Error: Invalid priority "${priority}". Valid: ${VALID_PRIORITIES.join(", ")}`
          )
        );
        tm.close();
        process.exit(1);
      }
      parentId = options.parent ? parseInt(options.parent, 10) : undefined;
    }

    if (!title) {
      console.error(chalk.red("  Error: Task title is required."));
      tm.close();
      process.exit(1);
      return;
    }

    const task = tm.createTask({
      title,
      description,
      department,
      assignee,
      priority,
      parent_id: parentId,
      deadline: options.deadline,
      created_by: "human-founder",
    });

    console.log(header("Task Created"));
    console.log(`  ${chalk.green("\u2713")} Task #${task.id}: "${task.title}"`);
    if (task.assignee) {
      console.log(
        `  ${chalk.green("\u2713")} Assigned to: ${agentColor(task.assignee)(task.assignee)}`
      );
    }
    if (task.department) {
      console.log(`  ${chalk.green("\u2713")} Department: ${task.department}`);
    }
    console.log(`  ${chalk.green("\u2713")} Priority: ${formatPriority(task.priority)}`);
    if (task.parent_id) {
      console.log(`  ${chalk.green("\u2713")} Subtask of: #${task.parent_id}`);
    }
    console.log();
  } finally {
    tm.close();
  }
}

// ── Show ──────────────────────────────────────────────────────────

interface ShowOptions extends TasksOptions {}

export async function tasksShowCommand(
  id: string,
  options: ShowOptions
): Promise<void> {
  const tm = getTaskManager(options.dir);

  try {
    const taskId = parseInt(id, 10);
    if (Number.isNaN(taskId)) {
      console.error(chalk.red("  Error: Task ID must be a number.\n"));
      return;
    }

    const task = tm.getTask(taskId);
    if (!task) {
      console.error(chalk.red(`  Error: Task #${taskId} not found.\n`));
      return;
    }

    console.log(header(`Task #${task.id}`));
    console.log(chalk.bold(`  ${task.title}`));
    console.log(chalk.dim("  " + "\u2500".repeat(60)));

    // Two-column details
    const statusStr = formatStatus(task.status);
    const priorityStr = formatPriority(task.priority);
    const assigneeStr = task.assignee
      ? agentColor(task.assignee)(task.assignee)
      : chalk.dim("unassigned");
    const deptStr = task.department || chalk.dim("none");
    const createdByStr = task.created_by;
    const createdStr = formatTimeAgo(task.created_at);
    const updatedStr = formatTimeAgo(task.updated_at);

    console.log(
      `  Status:     ${statusStr.padEnd(25)} Priority:  ${priorityStr}`
    );
    console.log(
      `  Department: ${deptStr.padEnd(25)} Assigned:  ${assigneeStr}`
    );
    console.log(
      `  Created by: ${createdByStr.padEnd(25)} Created:   ${createdStr}`
    );
    console.log(`  Updated:    ${updatedStr}`);

    if (task.deadline) {
      const now = Date.now();
      const deadlineMs = new Date(task.deadline).getTime();
      const overdue = deadlineMs < now && task.status !== "done";
      const deadlineStr = overdue
        ? chalk.red(`${task.deadline} [OVERDUE]`)
        : task.deadline;
      console.log(`  Deadline:   ${deadlineStr}`);
    }

    if (task.reviewer) {
      console.log(`  Reviewer:   ${task.reviewer}`);
    }

    if (task.parent_id) {
      const parent = tm.getTask(task.parent_id);
      const parentStr = parent
        ? `#${parent.id} ${parent.title}`
        : `#${task.parent_id} ${chalk.dim("(not found)")}`;
      console.log(`  Parent:     ${parentStr}`);
    }

    // Description
    if (task.description) {
      console.log();
      console.log(chalk.bold("  Description:"));
      for (const line of task.description.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    // Subtasks
    const subtasks = tm.getSubtasks(task.id);
    if (subtasks.length > 0) {
      console.log();
      console.log(chalk.bold("  Subtasks:"));
      for (const sub of subtasks) {
        const subStatus = formatStatus(sub.status);
        const subAssignee = sub.assignee
          ? `(${sub.assignee})`
          : "";
        console.log(
          `    #${sub.id.toString().padEnd(4)} [${subStatus}] ${truncate(sub.title, 30).padEnd(30)} ${chalk.dim(subAssignee)}`
        );
      }
    }

    // Blockers
    const blockers = tm.getBlockers(task.id);
    if (blockers.length > 0) {
      console.log();
      console.log(chalk.bold("  Blocked by:"));
      for (const blocker of blockers) {
        const blockerDone = blocker.status === "done" || blocker.status === "cancelled";
        const icon = blockerDone ? chalk.green("\u2713") : chalk.red("\u2717");
        console.log(
          `    ${icon} #${blocker.id} ${blocker.title} (${blocker.status})`
        );
      }
    }

    // Comments
    const comments = tm.getComments(task.id);
    // Filter out system-generated status_change comments for cleaner display
    const visibleComments = comments.filter(
      (c) => c.comment_type !== "status_change"
    );

    if (visibleComments.length > 0) {
      console.log();
      console.log(chalk.bold(`  Comments (${visibleComments.length}):`));
      for (const comment of visibleComments) {
        const authorStr =
          comment.author === "human-founder"
            ? chalk.bold("you")
            : agentColor(comment.author)(comment.author);
        console.log(
          `    ${authorStr} ${chalk.dim(`(${formatTimeAgo(comment.created_at)}):`)}`
        );
        for (const line of comment.content.split("\n")) {
          console.log(`      ${line}`);
        }
        console.log();
      }
    }

    console.log(chalk.dim("  " + "\u2500".repeat(60)));
    console.log();
  } finally {
    tm.close();
  }
}

// ── Update ────────────────────────────────────────────────────────

interface UpdateOptions extends TasksOptions {
  status?: string;
  assign?: string;
  priority?: string;
  comment?: string;
}

export async function tasksUpdateCommand(
  id: string,
  options: UpdateOptions
): Promise<void> {
  const tm = getTaskManager(options.dir);

  try {
    const taskId = parseInt(id, 10);
    if (Number.isNaN(taskId)) {
      console.error(chalk.red("  Error: Task ID must be a number.\n"));
      return;
    }

    const existing = tm.getTask(taskId);
    if (!existing) {
      console.error(chalk.red(`  Error: Task #${taskId} not found.\n`));
      return;
    }

    const changes: string[] = [];
    const updateFields: Record<string, unknown> = {};

    if (options.status) {
      if (!VALID_STATUSES.includes(options.status as TaskStatus)) {
        console.error(
          chalk.red(
            `  Error: Invalid status "${options.status}". Valid: ${VALID_STATUSES.join(", ")}`
          )
        );
        return;
      }
      updateFields.status = options.status as TaskStatus;
      changes.push(
        `Status: ${existing.status} \u2192 ${options.status}`
      );
    }

    if (options.assign !== undefined) {
      updateFields.assignee = options.assign || null;
      changes.push(
        `Assigned to: ${options.assign || "unassigned"}`
      );
    }

    if (options.priority) {
      if (!VALID_PRIORITIES.includes(options.priority as TaskPriority)) {
        console.error(
          chalk.red(
            `  Error: Invalid priority "${options.priority}". Valid: ${VALID_PRIORITIES.join(", ")}`
          )
        );
        return;
      }
      updateFields.priority = options.priority as TaskPriority;
      changes.push(
        `Priority: ${existing.priority} \u2192 ${options.priority}`
      );
    }

    // Apply all field changes in a single DB call
    if (Object.keys(updateFields).length > 0) {
      tm.updateTask(taskId, updateFields);
    }

    if (options.comment) {
      tm.addComment(taskId, "human-founder", options.comment);
      changes.push("Comment added");
    }

    if (changes.length === 0) {
      console.log(
        chalk.yellow(
          "  No changes specified. Use --status, --assign, --priority, or --comment.\n"
        )
      );
      return;
    }

    console.log(header("Task Updated"));
    console.log(`  Task #${taskId} "${existing.title}":`);
    for (const change of changes) {
      console.log(`    ${chalk.green("\u2713")} ${change}`);
    }
    console.log();
  } finally {
    tm.close();
  }
}

// ── Review ────────────────────────────────────────────────────────

export async function tasksReviewCommand(
  options: TasksOptions
): Promise<void> {
  const tm = getTaskManager(options.dir);

  try {
    console.log(header("Task Review"));

    const reviewTasks = tm.listTasks({ status: "in_review" });

    if (reviewTasks.length === 0) {
      console.log(chalk.dim("  No tasks awaiting review."));
      console.log(
        chalk.dim(
          '  Tasks enter review when agents mark them "in_review".\n'
        )
      );
      return;
    }

    console.log(
      `  ${reviewTasks.length} task${reviewTasks.length > 1 ? "s" : ""} awaiting review:\n`
    );

    const table = createTable(
      ["ID", "Title", "Assigned", "Priority", "Dept"],
      [6, 28, 12, 10, 9]
    );

    for (const task of reviewTasks) {
      const assigneeStr = task.assignee
        ? agentColor(task.assignee)(truncate(task.assignee, 10))
        : chalk.dim("--");
      const deptStr = task.department
        ? truncate(task.department, 7)
        : chalk.dim("--");

      table.push([
        String(task.id),
        truncate(task.title, 26),
        assigneeStr,
        formatPriority(task.priority),
        deptStr,
      ]);
    }

    console.log(table.toString());
    console.log();

    // Interactive selection
    const { selectedId } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedId",
        message: "Select a task to review:",
        choices: [
          ...reviewTasks.map((t) => ({
            name: `#${t.id} ${t.title}`,
            value: t.id,
          })),
          { name: "Cancel", value: -1 },
        ],
      },
    ]);

    if (selectedId === -1) return;

    const task = tm.getTask(selectedId);
    if (!task) {
      console.error(chalk.red(`  Error: Task #${selectedId} not found.\n`));
      return;
    }

    // Show task detail
    console.log();
    console.log(chalk.bold(`  ${task.title}`));
    console.log(chalk.dim("  " + "\u2500".repeat(60)));
    if (task.description) {
      console.log(`  ${task.description}`);
      console.log(chalk.dim("  " + "\u2500".repeat(60)));
    }

    // Show comments
    const comments = tm.getComments(task.id);
    const visibleComments = comments.filter(
      (c) => c.comment_type !== "status_change"
    );
    if (visibleComments.length > 0) {
      console.log();
      for (const comment of visibleComments.slice(-3)) {
        const authorStr =
          comment.author === "human-founder"
            ? chalk.bold("you")
            : agentColor(comment.author)(comment.author);
        console.log(
          `  ${authorStr} ${chalk.dim(`(${formatTimeAgo(comment.created_at)}):`)} ${comment.content}`
        );
      }
    }
    console.log();

    // Review action
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Action:",
        choices: [
          { name: "Approve (mark as Done)", value: "approve" },
          {
            name: "Reject (send back to In Progress with feedback)",
            value: "reject",
          },
          { name: "Skip (review later)", value: "skip" },
        ],
      },
    ]);

    if (action === "skip") return;

    if (action === "approve") {
      tm.submitReview(selectedId, true);
      console.log(
        chalk.green(`\n  ${chalk.bold("\u2713")} Task #${selectedId} approved and marked as Done.\n`)
      );
    } else {
      const { feedback } = await inquirer.prompt([
        {
          type: "input",
          name: "feedback",
          message: "Feedback for the agent:",
        },
      ]);

      tm.submitReview(selectedId, false, feedback || "Rejected by founder");
      console.log(
        chalk.yellow(
          `\n  Task #${selectedId} rejected. Moved back to "In Progress".`
        )
      );
      if (feedback) {
        console.log(chalk.dim(`  Feedback: "${feedback}"\n`));
      }
    }
  } finally {
    tm.close();
  }
}
