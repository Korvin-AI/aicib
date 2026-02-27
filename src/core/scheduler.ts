/**
 * Core business logic for the Agent Scheduler system.
 *
 * Provides types, defaults, and the ScheduleManager class that handles
 * all schedule CRUD operations, execution tracking, and cron computation.
 */

import Database from "better-sqlite3";
import path from "node:path";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerConfig {
  enabled: boolean;
  poll_interval_seconds: number;
  max_concurrent: number;
  cost_limit_per_run: number;
  missed_run_policy: "skip" | "run_once";
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export const SCHEDULER_CONFIG_DEFAULTS: SchedulerConfig = {
  enabled: true,
  poll_interval_seconds: 30,
  max_concurrent: 1,
  cost_limit_per_run: 5.0,
  missed_run_policy: "skip",
  quiet_hours_start: null,
  quiet_hours_end: null,
};

export type ScheduleStatus = "idle" | "running" | "paused" | "error";
export type TriggerType = "task_completed" | "project_completed" | "status_change" | "marker";
export type TriggerSource = "cron" | "manual" | "trigger";
export type ExecutionStatus = "running" | "completed" | "failed" | "skipped";

export interface Schedule {
  id: number;
  name: string;
  description: string;
  cron_expression: string | null;
  agent_target: string;
  directive: string;
  enabled: number; // SQLite boolean
  status: ScheduleStatus;
  trigger_type: TriggerType | null;
  trigger_value: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_job_id: number | null;
  last_error: string | null;
  run_count: number;
  total_cost_usd: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleExecution {
  id: number;
  schedule_id: number;
  job_id: number | null;
  trigger_source: TriggerSource;
  status: ExecutionStatus;
  started_at: string;
  completed_at: string | null;
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
  error_message: string | null;
}

export interface CreateScheduleParams {
  name: string;
  description?: string;
  cron_expression?: string | null;
  agent_target?: string;
  directive: string;
  enabled?: boolean;
  trigger_type?: TriggerType | null;
  trigger_value?: string | null;
  max_retries?: number;
}

export interface ScheduleFilter {
  enabled?: boolean;
  agent_target?: string;
  status?: ScheduleStatus;
}

// ---------------------------------------------------------------------------
// ScheduleManager
// ---------------------------------------------------------------------------

export class ScheduleManager {
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

  // --- CRUD ---

  createSchedule(params: CreateScheduleParams): Schedule {
    // Validate cron expression eagerly — reject invalid cron at creation time
    if (params.cron_expression) {
      try {
        parseExpression(params.cron_expression);
      } catch (e) {
        throw new Error(
          `Invalid cron expression "${params.cron_expression}": ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const nextRun = params.cron_expression
      ? this.computeNextRun(params.cron_expression)
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO schedules (name, description, cron_expression, agent_target, directive,
        enabled, trigger_type, trigger_value, max_retries, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      params.name,
      params.description || "",
      params.cron_expression || null,
      params.agent_target || "ceo",
      params.directive,
      params.enabled === false ? 0 : 1,
      params.trigger_type || null,
      params.trigger_value || null,
      params.max_retries ?? 0,
      nextRun
    );

    return this.getSchedule(Number(result.lastInsertRowid))!;
  }

  getSchedule(id: number): Schedule | undefined {
    return this.db
      .prepare("SELECT * FROM schedules WHERE id = ?")
      .get(id) as Schedule | undefined;
  }

  listSchedules(filter?: ScheduleFilter): Schedule[] {
    let sql = "SELECT * FROM schedules WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.enabled !== undefined) {
      sql += " AND enabled = ?";
      params.push(filter.enabled ? 1 : 0);
    }
    if (filter?.agent_target) {
      sql += " AND agent_target = ?";
      params.push(filter.agent_target);
    }
    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }

    sql += " ORDER BY id ASC";
    return this.db.prepare(sql).all(...params) as Schedule[];
  }

  updateSchedule(
    id: number,
    fields: Partial<
      Pick<
        Schedule,
        | "name"
        | "description"
        | "cron_expression"
        | "agent_target"
        | "directive"
        | "status"
        | "trigger_type"
        | "trigger_value"
        | "last_run_at"
        | "next_run_at"
        | "last_job_id"
        | "last_error"
        | "run_count"
        | "total_cost_usd"
        | "max_retries"
      >
    > & { enabled?: number }
  ): void {
    const ALLOWED_SCHEDULE_COLUMNS = new Set([
      "name", "description", "cron_expression", "agent_target", "directive",
      "enabled", "status", "trigger_type", "trigger_value", "last_run_at",
      "next_run_at", "last_job_id", "last_error", "run_count", "total_cost_usd",
      "max_retries",
    ]);

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED_SCHEDULE_COLUMNS.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  deleteSchedule(id: number): boolean {
    const result = this.db
      .prepare("DELETE FROM schedules WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  // --- Enable / Disable ---

  enableSchedule(id: number): void {
    const schedule = this.getSchedule(id);
    if (!schedule) return;

    const nextRun = schedule.cron_expression
      ? this.computeNextRun(schedule.cron_expression)
      : null;

    this.db
      .prepare(
        "UPDATE schedules SET enabled = 1, status = 'idle', next_run_at = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(nextRun, id);
  }

  disableSchedule(id: number): void {
    this.db
      .prepare(
        "UPDATE schedules SET enabled = 0, status = 'paused', updated_at = datetime('now') WHERE id = ?"
      )
      .run(id);
  }

  // --- Due schedules ---

  getDueSchedules(now: Date): Schedule[] {
    const isoNow = now.toISOString().replace("T", " ").slice(0, 19);
    return this.db
      .prepare(
        `SELECT * FROM schedules
         WHERE enabled = 1
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
           AND status != 'running'
         ORDER BY next_run_at ASC`
      )
      .all(isoNow) as Schedule[];
  }

  // --- Status transitions ---

  markScheduleRunning(id: number, jobId: number): void {
    this.db
      .prepare(
        `UPDATE schedules
         SET status = 'running', last_job_id = ?, last_run_at = datetime('now'),
             run_count = run_count + 1, last_error = NULL, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(jobId, id);
  }

  markScheduleCompleted(id: number, nextRunAt: string | null): void {
    this.db
      .prepare(
        `UPDATE schedules
         SET status = 'idle', next_run_at = ?, last_error = NULL, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(nextRunAt, id);
  }

  markScheduleFailed(id: number, error: string, nextRunAt: string | null): void {
    this.db
      .prepare(
        `UPDATE schedules
         SET status = 'error', next_run_at = ?, last_error = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(nextRunAt, error, id);
  }

  // --- Execution tracking ---

  recordExecution(params: {
    schedule_id: number;
    job_id?: number | null;
    trigger_source: TriggerSource;
    status?: ExecutionStatus;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO schedule_executions (schedule_id, job_id, trigger_source, status)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        params.schedule_id,
        params.job_id ?? null,
        params.trigger_source,
        params.status || "running"
      );
    return Number(result.lastInsertRowid);
  }

  updateExecution(
    id: number,
    fields: Partial<Pick<ScheduleExecution, "status" | "completed_at" | "cost_usd" | "num_turns" | "duration_ms" | "error_message">>
  ): void {
    const ALLOWED_EXECUTION_COLUMNS = new Set([
      "status", "completed_at", "cost_usd", "num_turns", "duration_ms", "error_message",
    ]);

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED_EXECUTION_COLUMNS.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return;

    values.push(id);
    this.db
      .prepare(`UPDATE schedule_executions SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  getExecutionHistory(scheduleId: number, limit = 10): ScheduleExecution[] {
    return this.db
      .prepare(
        `SELECT * FROM schedule_executions
         WHERE schedule_id = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(scheduleId, limit) as ScheduleExecution[];
  }

  getAllExecutionHistory(limit = 20): ScheduleExecution[] {
    return this.db
      .prepare(
        "SELECT * FROM schedule_executions ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as ScheduleExecution[];
  }

  // --- Trigger-based lookups ---

  getSchedulesByTrigger(triggerType: TriggerType, triggerValue?: string): Schedule[] {
    if (triggerValue) {
      return this.db
        .prepare(
          `SELECT * FROM schedules
           WHERE enabled = 1 AND trigger_type = ? AND (trigger_value = ? OR trigger_value IS NULL)`
        )
        .all(triggerType, triggerValue) as Schedule[];
    }
    return this.db
      .prepare(
        "SELECT * FROM schedules WHERE enabled = 1 AND trigger_type = ?"
      )
      .all(triggerType) as Schedule[];
  }

  // --- Cron computation ---

  computeNextRun(cronExpression: string, fromDate?: Date): string | null {
    try {
      const interval = parseExpression(cronExpression, {
        currentDate: fromDate || new Date(),
        utc: false,
      });
      const next = interval.next().toDate();
      return next.toISOString().replace("T", " ").slice(0, 19);
    } catch {
      return null;
    }
  }

  // --- Context formatting ---

  formatForContext(): string {
    const active = this.listSchedules({ enabled: true });
    if (active.length === 0) return "";

    const lines: string[] = ["## Active Schedules"];

    const running = active.filter((s) => s.status === "running");
    if (running.length > 0) {
      lines.push("\nCurrently running:");
      for (const s of running) {
        lines.push(`- [Schedule #${s.id}] "${s.name}" (agent: ${s.agent_target})`);
      }
    }

    const upcoming = active
      .filter((s) => s.status !== "running" && s.next_run_at)
      .sort((a, b) => (a.next_run_at || "").localeCompare(b.next_run_at || ""))
      .slice(0, 5);

    if (upcoming.length > 0) {
      lines.push("\nUpcoming:");
      for (const s of upcoming) {
        const cron = s.cron_expression ? ` (${s.cron_expression})` : "";
        lines.push(
          `- [Schedule #${s.id}] "${s.name}" → next: ${s.next_run_at}${cron}`
        );
      }
    }

    const triggerBased = active.filter(
      (s) => s.trigger_type && !s.cron_expression
    );
    if (triggerBased.length > 0) {
      lines.push("\nEvent-triggered:");
      for (const s of triggerBased) {
        lines.push(
          `- [Schedule #${s.id}] "${s.name}" → on ${s.trigger_type}${s.trigger_value ? `: ${s.trigger_value}` : ""}`
        );
      }
    }

    lines.push(
      "\nTo manage schedules, use SCHEDULE:: markers:",
      'SCHEDULE::CREATE name="<name>" cron="<expr>" directive="<text>"',
      'SCHEDULE::CREATE name="<name>" trigger=<type> directive="<text>"',
      "SCHEDULE::ENABLE id=<n>",
      "SCHEDULE::DISABLE id=<n>",
      "SCHEDULE::DELETE id=<n>"
    );

    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Config validation helper
// ---------------------------------------------------------------------------

export function validateSchedulerConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
      errors.push("scheduler.enabled must be a boolean");
    }

    if (obj.poll_interval_seconds !== undefined) {
      if (
        typeof obj.poll_interval_seconds !== "number" ||
        obj.poll_interval_seconds < 5 ||
        obj.poll_interval_seconds > 3600
      ) {
        errors.push(
          "scheduler.poll_interval_seconds must be a number between 5 and 3600"
        );
      }
    }

    if (obj.max_concurrent !== undefined) {
      if (
        typeof obj.max_concurrent !== "number" ||
        obj.max_concurrent < 1 ||
        obj.max_concurrent > 10
      ) {
        errors.push("scheduler.max_concurrent must be a number between 1 and 10");
      }
    }

    if (obj.cost_limit_per_run !== undefined) {
      if (
        typeof obj.cost_limit_per_run !== "number" ||
        obj.cost_limit_per_run < 0
      ) {
        errors.push("scheduler.cost_limit_per_run must be a non-negative number");
      }
    }

    if (obj.missed_run_policy !== undefined) {
      if (obj.missed_run_policy !== "skip" && obj.missed_run_policy !== "run_once") {
        errors.push('scheduler.missed_run_policy must be "skip" or "run_once"');
      }
    }

    for (const field of ["quiet_hours_start", "quiet_hours_end"]) {
      if (obj[field] !== undefined && obj[field] !== null) {
        if (
          typeof obj[field] !== "string" ||
          !/^\d{2}:\d{2}$/.test(obj[field] as string)
        ) {
          errors.push(`scheduler.${field} must be a string in HH:MM format or null`);
        }
      }
    }
  }
  return errors;
}
