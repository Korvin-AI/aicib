/**
 * CLI commands for the Agent Scheduler: dashboard, CRUD, daemon control.
 *
 * Pattern follows src/cli/tasks.ts (CRUD) and src/cli/slack.ts (daemon spawn/stop).
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import inquirer from "inquirer";

import cronParser from "cron-parser";
const { parseExpression: parseExpressionSync } = cronParser;
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { isProcessRunning } from "../core/background-manager.js";
import { header, createTable, formatTimeAgo } from "./ui.js";
import { ScheduleManager, type SchedulerConfig } from "../core/scheduler.js";
import {
  getSchedulerDb,
  getStateValue,
  setStateValue,
  SCHEDULER_STATE_KEYS,
} from "../core/scheduler-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Helpers ---

interface ScheduleOptions {
  dir: string;
}

function getScheduleManager(dir: string): ScheduleManager {
  const projectDir = path.resolve(dir);
  loadConfig(projectDir); // ensure config is loaded (validates)
  return new ScheduleManager(projectDir);
}

function statusIcon(status: string): string {
  switch (status) {
    case "idle":
      return chalk.green("idle");
    case "running":
      return chalk.cyan("running");
    case "paused":
      return chalk.yellow("paused");
    case "error":
      return chalk.red("error");
    default:
      return status;
  }
}

// --- Dashboard (bare `aicib schedule`) ---

export async function scheduleDashboardCommand(options: ScheduleOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);
  console.log(header("Agent Scheduler"));

  // Daemon status
  const db = getSchedulerDb(projectDir);
  try {
    const pidStr = getStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;
    const alive = pid ? isProcessRunning(pid) : false;
    const heartbeat = getStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_HEARTBEAT);
    const connState = getStateValue(db, SCHEDULER_STATE_KEYS.CONNECTION_STATE) || "stopped";

    const daemonStatus = alive
      ? chalk.green(`RUNNING (PID ${pid})`)
      : chalk.dim("STOPPED");
    console.log(`  Daemon:    ${daemonStatus}`);
    if (heartbeat && alive) {
      console.log(`  Heartbeat: ${formatTimeAgo(heartbeat)}`);
    }
    if (!alive && connState === "running") {
      console.log(chalk.yellow("  Warning: Daemon state says running but process is dead. Restart with: aicib schedule start"));
    }
  } finally {
    db.close();
  }

  // Schedule overview
  const sm = getScheduleManager(options.dir);
  try {
    const schedules = sm.listSchedules();
    const enabled = schedules.filter((s) => s.enabled);
    const running = schedules.filter((s) => s.status === "running");

    console.log(`  Schedules: ${enabled.length} enabled, ${running.length} running, ${schedules.length} total\n`);

    // Next 5 upcoming
    const upcoming = schedules
      .filter((s) => s.enabled && s.next_run_at && s.status !== "running")
      .sort((a, b) => (a.next_run_at || "").localeCompare(b.next_run_at || ""))
      .slice(0, 5);

    if (upcoming.length > 0) {
      console.log(chalk.bold("  Upcoming:"));
      const table = createTable(["ID", "Name", "Agent", "Next Run", "Status"]);
      for (const s of upcoming) {
        table.push([
          `#${s.id}`,
          s.name,
          s.agent_target,
          s.next_run_at || "-",
          statusIcon(s.status),
        ]);
      }
      console.log(table.toString());
    }

    // Last 5 executions
    const history = sm.getAllExecutionHistory(5);
    if (history.length > 0) {
      console.log(chalk.bold("\n  Recent Executions:"));
      const table = createTable(["ID", "Schedule", "Source", "Status", "Started", "Cost"]);
      for (const ex of history) {
        const sched = sm.getSchedule(ex.schedule_id);
        table.push([
          `#${ex.id}`,
          sched ? sched.name : `Schedule #${ex.schedule_id}`,
          ex.trigger_source,
          ex.status === "completed"
            ? chalk.green(ex.status)
            : ex.status === "failed"
              ? chalk.red(ex.status)
              : ex.status,
          formatTimeAgo(ex.started_at),
          `$${ex.cost_usd.toFixed(4)}`,
        ]);
      }
      console.log(table.toString());
    }

    if (schedules.length === 0) {
      console.log(chalk.dim("  No schedules yet. Create one with: aicib schedule create\n"));
    }
  } finally {
    sm.close();
  }
}

// --- List ---

interface ScheduleListOptions extends ScheduleOptions {
  enabled?: boolean;
  agent?: string;
}

export async function scheduleListCommand(options: ScheduleListOptions): Promise<void> {
  console.log(header("Schedules"));

  const sm = getScheduleManager(options.dir);
  try {
    const schedules = sm.listSchedules({
      enabled: options.enabled,
      agent_target: options.agent,
    });

    if (schedules.length === 0) {
      console.log(chalk.dim("  No schedules found.\n"));
      return;
    }

    const table = createTable([
      "ID", "Name", "Cron/Trigger", "Agent", "Status", "Next Run", "Last Run", "Runs",
    ]);

    for (const s of schedules) {
      const cronOrTrigger = s.cron_expression
        ? s.cron_expression
        : s.trigger_type
          ? `on:${s.trigger_type}`
          : "-";
      table.push([
        `#${s.id}`,
        s.name,
        cronOrTrigger,
        s.agent_target,
        statusIcon(s.status) + (s.enabled ? "" : chalk.dim(" [disabled]")),
        s.next_run_at || "-",
        s.last_run_at ? formatTimeAgo(s.last_run_at) : "-",
        String(s.run_count),
      ]);
    }

    console.log(table.toString());
    console.log();
  } finally {
    sm.close();
  }
}

// --- Create ---

interface ScheduleCreateOptions extends ScheduleOptions {
  name?: string;
  cron?: string;
  directive?: string;
  agent?: string;
  trigger?: string;
  interactive?: boolean;
}

export async function scheduleCreateCommand(options: ScheduleCreateOptions): Promise<void> {
  let name = options.name;
  let cron = options.cron;
  let directive = options.directive;
  let agent = options.agent || "ceo";
  let triggerType: string | null = null;
  let triggerValue: string | null = null;

  if (options.trigger) {
    const parts = options.trigger.split(":");
    triggerType = parts[0];
    triggerValue = parts.slice(1).join(":") || null;
  }

  if (options.interactive || !name || !directive) {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Schedule name:",
        default: name,
        validate: (input: string) => input.trim() ? true : "Name is required",
      },
      {
        type: "list",
        name: "type",
        message: "Schedule type:",
        choices: [
          { name: "Cron (time-based)", value: "cron" },
          { name: "Trigger (event-based)", value: "trigger" },
        ],
      },
      {
        type: "input",
        name: "cron",
        message: "Cron expression (e.g., 0 9 * * 1-5 for weekday 9am):",
        default: cron,
        when: (a: Record<string, string>) => a.type === "cron",
        validate: (input: string) => {
          if (!input.trim()) return "Cron expression is required";
          try {
            parseExpressionSync(input.trim());
            return true;
          } catch {
            return "Invalid cron expression";
          }
        },
      },
      {
        type: "list",
        name: "triggerType",
        message: "Trigger event:",
        when: (a: Record<string, string>) => a.type === "trigger",
        choices: [
          { name: "Task completed", value: "task_completed" },
          { name: "Project completed", value: "project_completed" },
          { name: "Status change", value: "status_change" },
        ],
      },
      {
        type: "input",
        name: "triggerValue",
        message: "Trigger value (optional — blank for any):",
        when: (a: Record<string, string>) => a.type === "trigger",
      },
      {
        type: "input",
        name: "agent",
        message: "Target agent:",
        default: agent,
      },
      {
        type: "input",
        name: "directive",
        message: "Directive (what should the agent do?):",
        default: directive,
        validate: (input: string) => input.trim() ? true : "Directive is required",
      },
    ]);

    name = answers.name;
    cron = answers.cron || cron;
    directive = answers.directive;
    agent = answers.agent || "ceo";
    if (answers.triggerType) {
      triggerType = answers.triggerType;
      triggerValue = answers.triggerValue || null;
    }
  }

  if (!name || !directive) {
    console.error(chalk.red("  Error: --name and --directive are required.\n"));
    process.exit(1);
  }

  const sm = getScheduleManager(options.dir);
  try {
    const schedule = sm.createSchedule({
      name,
      cron_expression: cron || null,
      directive,
      agent_target: agent,
      trigger_type: (triggerType as "task_completed" | "project_completed" | "status_change" | "marker") || null,
      trigger_value: triggerValue,
    });

    console.log(header("Schedule Created"));
    console.log(`  ID:        #${schedule.id}`);
    console.log(`  Name:      ${schedule.name}`);
    if (schedule.cron_expression) {
      console.log(`  Cron:      ${schedule.cron_expression}`);
    }
    if (schedule.trigger_type) {
      console.log(`  Trigger:   ${schedule.trigger_type}${schedule.trigger_value ? `: ${schedule.trigger_value}` : ""}`);
    }
    console.log(`  Agent:     ${schedule.agent_target}`);
    console.log(`  Directive: ${schedule.directive}`);
    if (schedule.next_run_at) {
      console.log(`  Next run:  ${schedule.next_run_at}`);
    }
    console.log();
  } finally {
    sm.close();
  }
}

// --- Show ---

interface ScheduleShowOptions extends ScheduleOptions {}

export async function scheduleShowCommand(id: string, options: ScheduleShowOptions): Promise<void> {
  const sm = getScheduleManager(options.dir);
  try {
    const schedule = sm.getSchedule(parseInt(id, 10));
    if (!schedule) {
      console.error(chalk.red(`  Schedule #${id} not found.\n`));
      process.exit(1);
    }

    console.log(header(`Schedule #${schedule.id}`));
    console.log(`  Name:        ${schedule.name}`);
    if (schedule.description) {
      console.log(`  Description: ${schedule.description}`);
    }
    console.log(`  Status:      ${statusIcon(schedule.status)}${schedule.enabled ? "" : chalk.dim(" [disabled]")}`);
    console.log(`  Agent:       ${schedule.agent_target}`);
    console.log(`  Directive:   ${schedule.directive}`);
    if (schedule.cron_expression) {
      console.log(`  Cron:        ${schedule.cron_expression}`);
    }
    if (schedule.trigger_type) {
      console.log(`  Trigger:     ${schedule.trigger_type}${schedule.trigger_value ? `: ${schedule.trigger_value}` : ""}`);
    }
    console.log(`  Next run:    ${schedule.next_run_at || "-"}`);
    console.log(`  Last run:    ${schedule.last_run_at ? formatTimeAgo(schedule.last_run_at) : "-"}`);
    console.log(`  Runs:        ${schedule.run_count}`);
    console.log(`  Total cost:  $${schedule.total_cost_usd.toFixed(4)}`);
    if (schedule.last_error) {
      console.log(`  Last error:  ${chalk.red(schedule.last_error)}`);
    }
    console.log(`  Created:     ${formatTimeAgo(schedule.created_at)}`);

    // Last 10 executions
    const history = sm.getExecutionHistory(schedule.id, 10);
    if (history.length > 0) {
      console.log(chalk.bold("\n  Execution History:"));
      const table = createTable(["ID", "Job", "Source", "Status", "Started", "Duration", "Cost"]);
      for (const ex of history) {
        const durationStr = ex.duration_ms > 0
          ? `${(ex.duration_ms / 1000 / 60).toFixed(1)}m`
          : "-";
        table.push([
          `#${ex.id}`,
          ex.job_id ? `#${ex.job_id}` : "-",
          ex.trigger_source,
          ex.status === "completed"
            ? chalk.green(ex.status)
            : ex.status === "failed"
              ? chalk.red(ex.status)
              : ex.status,
          formatTimeAgo(ex.started_at),
          durationStr,
          `$${ex.cost_usd.toFixed(4)}`,
        ]);
      }
      console.log(table.toString());
    }

    console.log();
  } finally {
    sm.close();
  }
}

// --- Delete ---

export async function scheduleDeleteCommand(id: string, options: ScheduleOptions): Promise<void> {
  const sm = getScheduleManager(options.dir);
  try {
    const schedule = sm.getSchedule(parseInt(id, 10));
    if (!schedule) {
      console.error(chalk.red(`  Schedule #${id} not found.\n`));
      process.exit(1);
    }

    sm.deleteSchedule(schedule.id);
    console.log(chalk.green(`  Deleted schedule #${id}: ${schedule.name}\n`));
  } finally {
    sm.close();
  }
}

// --- Enable / Disable ---

export async function scheduleEnableCommand(id: string, options: ScheduleOptions): Promise<void> {
  const sm = getScheduleManager(options.dir);
  try {
    const schedule = sm.getSchedule(parseInt(id, 10));
    if (!schedule) {
      console.error(chalk.red(`  Schedule #${id} not found.\n`));
      process.exit(1);
    }

    sm.enableSchedule(schedule.id);
    const updated = sm.getSchedule(schedule.id);
    console.log(chalk.green(`  Enabled schedule #${id}: ${schedule.name}`));
    if (updated?.next_run_at) {
      console.log(`  Next run: ${updated.next_run_at}`);
    }
    console.log();
  } finally {
    sm.close();
  }
}

export async function scheduleDisableCommand(id: string, options: ScheduleOptions): Promise<void> {
  const sm = getScheduleManager(options.dir);
  try {
    const schedule = sm.getSchedule(parseInt(id, 10));
    if (!schedule) {
      console.error(chalk.red(`  Schedule #${id} not found.\n`));
      process.exit(1);
    }

    sm.disableSchedule(schedule.id);
    console.log(chalk.green(`  Disabled schedule #${id}: ${schedule.name}\n`));
  } finally {
    sm.close();
  }
}

// --- History ---

interface ScheduleHistoryOptions extends ScheduleOptions {
  schedule?: string;
  limit?: string;
}

export async function scheduleHistoryCommand(options: ScheduleHistoryOptions): Promise<void> {
  console.log(header("Execution History"));

  const sm = getScheduleManager(options.dir);
  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 20;

    let history;
    if (options.schedule) {
      const scheduleId = parseInt(options.schedule, 10);
      history = sm.getExecutionHistory(scheduleId, limit);
    } else {
      history = sm.getAllExecutionHistory(limit);
    }

    if (history.length === 0) {
      console.log(chalk.dim("  No executions recorded yet.\n"));
      return;
    }

    const table = createTable(["ID", "Schedule", "Job", "Source", "Status", "Started", "Duration", "Cost"]);
    for (const ex of history) {
      const sched = sm.getSchedule(ex.schedule_id);
      const durationStr = ex.duration_ms > 0
        ? `${(ex.duration_ms / 1000 / 60).toFixed(1)}m`
        : "-";
      table.push([
        `#${ex.id}`,
        sched ? sched.name : `#${ex.schedule_id}`,
        ex.job_id ? `#${ex.job_id}` : "-",
        ex.trigger_source,
        ex.status === "completed"
          ? chalk.green(ex.status)
          : ex.status === "failed"
            ? chalk.red(ex.status)
            : ex.status,
        formatTimeAgo(ex.started_at),
        durationStr,
        `$${ex.cost_usd.toFixed(4)}`,
      ]);
    }
    console.log(table.toString());
    console.log();
  } finally {
    sm.close();
  }
}

// --- Daemon: start ---

export async function scheduleStartCommand(options: ScheduleOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Starting Scheduler Daemon"));

  // Check if already running
  const db = getSchedulerDb(projectDir);
  try {
    const pidStr = getStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;

    if (pid && isProcessRunning(pid)) {
      console.log(chalk.yellow(`  Scheduler daemon already running (PID ${pid}).\n`));
      return;
    }
  } finally {
    db.close();
  }

  // Ensure DB tables exist by constructing CostTracker (triggers registerTable hooks)
  const costTracker = new CostTracker(projectDir);
  costTracker.close();

  // Spawn daemon
  const daemonScript = path.resolve(__dirname, "..", "core", "scheduler-daemon.js");

  const child = spawn(
    process.execPath,
    [daemonScript, projectDir],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    }
  );

  if (child.pid === undefined) {
    console.error(chalk.red("  Error: Failed to start scheduler daemon.\n"));
    process.exit(1);
  }

  child.unref();

  // Wait for daemon to confirm running (up to 5s)
  const checkDb = getSchedulerDb(projectDir);
  const deadline = Date.now() + 5_000;
  let started = false;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const state = getStateValue(checkDb, SCHEDULER_STATE_KEYS.CONNECTION_STATE);
      if (state === "running") { started = true; break; }
      if (state === "error") { break; }
    }
  } finally {
    checkDb.close();
  }

  if (started) {
    console.log(chalk.green(`  Scheduler daemon started (PID ${child.pid}).\n`));
  } else {
    console.log(chalk.yellow("  Scheduler daemon started but hasn't confirmed yet."));
    console.log(chalk.yellow("  Check: aicib schedule status\n"));
  }
}

// --- Daemon: stop ---

export async function scheduleStopCommand(options: ScheduleOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Stopping Scheduler Daemon"));

  const db = getSchedulerDb(projectDir);
  try {
    const pidStr = getStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;

    if (!pid || !isProcessRunning(pid)) {
      console.log(chalk.dim("  Scheduler daemon is not running.\n"));
      setStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID, "");
      setStateValue(db, SCHEDULER_STATE_KEYS.CONNECTION_STATE, "stopped");
      return;
    }

    console.log(chalk.dim(`  Stopping daemon (PID ${pid})...`));

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }

    // Wait up to 5 seconds for graceful shutdown
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!isProcessRunning(pid)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (isProcessRunning(pid)) {
      console.log(chalk.yellow("  Warning: Daemon didn't stop gracefully. Force killing..."));
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }

    // Update state
    setStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID, "");
    setStateValue(db, SCHEDULER_STATE_KEYS.CONNECTION_STATE, "stopped");

    console.log(chalk.green("  Scheduler daemon stopped.\n"));
  } finally {
    db.close();
  }
}

// --- Daemon: status ---

export async function scheduleStatusCommand(options: ScheduleOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Scheduler Status"));

  const db = getSchedulerDb(projectDir);
  try {
    const connState = getStateValue(db, SCHEDULER_STATE_KEYS.CONNECTION_STATE) || "stopped";
    const pidStr = getStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;
    const heartbeat = getStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_HEARTBEAT);

    const daemonAlive = pid ? isProcessRunning(pid) : false;
    const effectiveState = daemonAlive ? connState : (pid ? "daemon crashed" : connState);

    const statusText = effectiveState === "running"
      ? chalk.green("RUNNING")
      : effectiveState === "daemon crashed"
        ? chalk.red("CRASHED")
        : chalk.dim("STOPPED");

    console.log(`  Daemon:    ${statusText}`);
    if (pid && daemonAlive) {
      console.log(`  PID:       ${pid}`);
    }
    if (heartbeat) {
      console.log(`  Heartbeat: ${formatTimeAgo(heartbeat)}`);
    }

    // Check if stale heartbeat (> 2 minutes old)
    if (heartbeat && daemonAlive) {
      const age = Date.now() - new Date(heartbeat).getTime();
      if (age > 120_000) {
        console.log(chalk.yellow("  Warning: Heartbeat is stale (>2 min). Daemon may be hung."));
      }
    }

    // Show config
    try {
      const config = loadConfig(projectDir);
      const schedulerConfig = config.extensions?.scheduler as SchedulerConfig | undefined;
      if (schedulerConfig) {
        console.log(`\n  Config:`);
        console.log(`    Poll interval: ${schedulerConfig.poll_interval_seconds}s`);
        console.log(`    Max concurrent: ${schedulerConfig.max_concurrent}`);
        console.log(`    Cost limit/run: $${schedulerConfig.cost_limit_per_run.toFixed(2)}`);
        if (schedulerConfig.quiet_hours_start && schedulerConfig.quiet_hours_end) {
          console.log(`    Quiet hours: ${schedulerConfig.quiet_hours_start} - ${schedulerConfig.quiet_hours_end}`);
        }
      }
    } catch {
      // Config not loaded — skip
    }

    // Hints
    if (effectiveState === "daemon crashed") {
      console.log(chalk.yellow("\n  The scheduler daemon has crashed. Restart with: aicib schedule start"));
    } else if (effectiveState === "stopped" || effectiveState === "not configured") {
      console.log(chalk.dim("\n  Start with: aicib schedule start"));
    }

    console.log();
  } finally {
    db.close();
  }
}
