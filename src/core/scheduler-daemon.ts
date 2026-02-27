#!/usr/bin/env node

/**
 * Scheduler daemon process — runs as a detached long-lived process.
 * Invoked as: node scheduler-daemon.js <projectDir>
 *
 * Polls for due schedules at a configurable interval and spawns background
 * briefs for each. Tracks liveness via PID + heartbeat in the scheduler_state
 * table.
 *
 * Requires an active SDK session (`aicib start` must have been run).
 * Pattern follows integrations/slack/daemon.ts.
 */

// Side-effect imports: register hooks before config/DB
import "./task-register.js";
import "./intelligence-register.js";
import "./knowledge-register.js";
import "./project-register.js";
import "./routing-register.js";
import "./review-chains-register.js";
import "./scheduler-register.js";
import "./reporting-register.js";
import "./perf-review-register.js";
import "./notifications-register.js";
import "./events-register.js";

import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import type { AicibConfig } from "./config.js";
import { CostTracker } from "./cost-tracker.js";
import { startBackgroundBrief } from "./background-manager.js";
import {
  ScheduleManager,
  type SchedulerConfig,
  type Schedule,
} from "./scheduler.js";
import {
  NotificationManager,
  type NotificationsConfig,
} from "./notifications.js";
import {
  getSchedulerDb,
  getStateValue,
  setStateValue,
  SCHEDULER_STATE_KEYS,
} from "./scheduler-state.js";

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
    // Non-wrapping range (e.g., 09:00–17:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Wraps midnight
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [, , projectDir] = process.argv;

  if (!projectDir) {
    process.stderr.write("Usage: scheduler-daemon.js <projectDir>\n");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(projectDir, ".aicib", "state.db"))) {
    process.stderr.write("Error: No AICIB state database found. Run 'aicib init' first.\n");
    process.exit(1);
  }

  // Load config
  let config: AicibConfig;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    process.stderr.write(
      `Error loading config: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }

  const schedulerConfig = (config.extensions?.scheduler || {}) as SchedulerConfig;
  const pollMs = (schedulerConfig.poll_interval_seconds || 30) * 1000;

  // Open DB connections
  const costTracker = new CostTracker(projectDir);
  const db = getSchedulerDb(projectDir);

  // Write PID + start heartbeat
  setStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID, String(process.pid));
  setStateValue(db, SCHEDULER_STATE_KEYS.CONNECTION_STATE, "running");
  setStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_HEARTBEAT, new Date().toISOString());

  const heartbeatTimer = setInterval(() => {
    try {
      setStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_HEARTBEAT, new Date().toISOString());
    } catch {
      // DB may be locked — non-fatal
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Poll loop
  // ---------------------------------------------------------------------------

  const pollTimer = setInterval(() => {
    try {
      pollOnce(projectDir, config, schedulerConfig, costTracker);
    } catch (e) {
      process.stderr.write(`Scheduler poll error: ${e}\n`);
    }
  }, pollMs);

  // Run once immediately
  try {
    pollOnce(projectDir, config, schedulerConfig, costTracker);
  } catch (e) {
    process.stderr.write(`Scheduler initial poll error: ${e}\n`);
  }

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  const shutdown = () => {
    clearInterval(heartbeatTimer);
    clearInterval(pollTimer);

    try {
      setStateValue(db, SCHEDULER_STATE_KEYS.CONNECTION_STATE, "stopped");
      setStateValue(db, SCHEDULER_STATE_KEYS.DAEMON_PID, "");
    } catch { /* best-effort */ }

    try { costTracker.close(); } catch { /* best-effort */ }
    try { db.close(); } catch { /* best-effort */ }

    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---------------------------------------------------------------------------
// Single poll iteration
// ---------------------------------------------------------------------------

function pollOnce(
  projectDir: string,
  config: AicibConfig,
  schedulerConfig: SchedulerConfig,
  costTracker: CostTracker
): void {
  const now = new Date();

  // Always check completed schedules first — running jobs may have finished
  // regardless of quiet hours, cost limits, or session state.
  let sm: ScheduleManager | undefined;
  try {
    sm = new ScheduleManager(projectDir);
    checkCompletedSchedules(sm, costTracker, schedulerConfig);

    // Check quiet hours
    if (
      isInQuietHours(
        now,
        schedulerConfig.quiet_hours_start,
        schedulerConfig.quiet_hours_end
      )
    ) {
      return;
    }

    // Check daily cost limit
    const todayCost = costTracker.getTotalCostToday();
    const dailyLimit = config.settings?.cost_limit_daily ?? 50;
    if (todayCost >= dailyLimit) {
      return;
    }

    // Require an active SDK session
    const activeSession = costTracker.getActiveSDKSessionId();
    if (!activeSession) {
      return; // No session — skip silently
    }

    // Get due schedules
    const dueSchedules = sm.getDueSchedules(now);
    if (dueSchedules.length === 0) return;

    // Check concurrent limit
    const running = sm.listSchedules({ status: "running" });
    const maxConcurrent = schedulerConfig.max_concurrent || 1;
    let slotsAvailable = maxConcurrent - running.length;

    const pollIntervalMs = (schedulerConfig.poll_interval_seconds || 30) * 1000;

    for (const schedule of dueSchedules) {
      if (slotsAvailable <= 0) break;

      // missed_run_policy="skip": if next_run_at is significantly overdue,
      // recompute to next future occurrence instead of running.
      if (
        schedulerConfig.missed_run_policy === "skip" &&
        schedule.next_run_at &&
        schedule.cron_expression
      ) {
        const dueTime = new Date(schedule.next_run_at.replace(" ", "T") + "Z");
        const overdueMs = now.getTime() - dueTime.getTime();
        if (overdueMs > pollIntervalMs * 2) {
          const nextRun = sm.computeNextRun(schedule.cron_expression);
          sm.updateSchedule(schedule.id, { next_run_at: nextRun });
          sm.recordExecution({
            schedule_id: schedule.id,
            trigger_source: "cron",
            status: "skipped",
          });
          continue;
        }
      }

      // cost_limit_per_run: skip if average cost per run exceeds limit
      const costLimit = schedulerConfig.cost_limit_per_run;
      if (
        costLimit > 0 &&
        schedule.run_count > 0 &&
        schedule.total_cost_usd / schedule.run_count > costLimit
      ) {
        process.stderr.write(
          `Schedule #${schedule.id} skipped: average cost per run ($${(schedule.total_cost_usd / schedule.run_count).toFixed(2)}) exceeds limit ($${costLimit.toFixed(2)})\n`
        );
        const nextRun = schedule.cron_expression
          ? sm.computeNextRun(schedule.cron_expression)
          : null;
        sm.markScheduleFailed(
          schedule.id,
          `Average cost per run ($${(schedule.total_cost_usd / schedule.run_count).toFixed(2)}) exceeds cost_limit_per_run ($${costLimit.toFixed(2)})`,
          nextRun
        );
        continue;
      }

      try {
        executeSchedule(
          schedule,
          sm,
          projectDir,
          config,
          activeSession,
          costTracker
        );
        slotsAvailable--;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`Schedule #${schedule.id} execution error: ${errorMsg}\n`);
        const nextRun = schedule.cron_expression
          ? sm.computeNextRun(schedule.cron_expression)
          : null;
        sm.markScheduleFailed(schedule.id, errorMsg, nextRun);
      }
    }

    // Process notification queue (push + digest delivery)
    processNotifications(projectDir, config);
  } finally {
    sm?.close();
  }
}

// ---------------------------------------------------------------------------
// Process notification queue
// ---------------------------------------------------------------------------

function processNotifications(
  projectDir: string,
  config: AicibConfig
): void {
  const notifConfig = (config.extensions?.notifications || {}) as NotificationsConfig;
  if (notifConfig.enabled === false) return;

  // Fire-and-forget with self-contained DB lifecycle (avoids async/close race)
  NotificationManager.processQueue(notifConfig, projectDir).catch(() => {
    // Notification delivery is best-effort
  });
}

// ---------------------------------------------------------------------------
// Execute a single schedule
// ---------------------------------------------------------------------------

function executeSchedule(
  schedule: Schedule,
  sm: ScheduleManager,
  projectDir: string,
  config: AicibConfig,
  activeSession: { sessionId: string; sdkSessionId: string },
  costTracker: CostTracker
): void {
  // Build directive with schedule prefix (like [PROJECT::<id>])
  const directive = `[SCHEDULED::${schedule.id}] ${schedule.directive}`;

  // Spawn background brief
  const { jobId } = startBackgroundBrief(
    directive,
    projectDir,
    config,
    activeSession.sdkSessionId,
    activeSession.sessionId,
    costTracker
  );

  // Mark running
  sm.markScheduleRunning(schedule.id, jobId);

  // Record execution
  sm.recordExecution({
    schedule_id: schedule.id,
    job_id: jobId,
    trigger_source: schedule.trigger_type ? "trigger" : "cron",
  });
}

// ---------------------------------------------------------------------------
// Check "running" schedules for completed background jobs
// ---------------------------------------------------------------------------

function checkCompletedSchedules(
  sm: ScheduleManager,
  costTracker: CostTracker,
  schedulerConfig: SchedulerConfig
): void {
  const running = sm.listSchedules({ status: "running" });

  for (const schedule of running) {
    if (!schedule.last_job_id) {
      // No job ID — mark idle
      const nextRun = schedule.cron_expression
        ? sm.computeNextRun(schedule.cron_expression)
        : null;
      sm.markScheduleCompleted(schedule.id, nextRun);
      continue;
    }

    const job = costTracker.getBackgroundJob(schedule.last_job_id);
    if (!job) {
      const nextRun = schedule.cron_expression
        ? sm.computeNextRun(schedule.cron_expression)
        : null;
      sm.markScheduleCompleted(schedule.id, nextRun);
      continue;
    }

    if (job.status === "running") continue; // still in progress

    const nextRun = schedule.cron_expression
      ? sm.computeNextRun(schedule.cron_expression)
      : null;

    // Update execution record
    updateExecutionFromJob(sm, schedule.id, job);

    if (job.status === "completed") {
      // Update cost tracking
      const newTotalCost = schedule.total_cost_usd + (job.total_cost_usd || 0);
      sm.updateSchedule(schedule.id, { total_cost_usd: newTotalCost });

      // cost_limit_per_run: if this execution exceeded the limit, mark error
      const costLimit = schedulerConfig.cost_limit_per_run;
      if (costLimit > 0 && (job.total_cost_usd || 0) > costLimit) {
        sm.markScheduleFailed(
          schedule.id,
          `Last execution cost ($${(job.total_cost_usd || 0).toFixed(2)}) exceeded cost_limit_per_run ($${costLimit.toFixed(2)})`,
          nextRun
        );
      } else {
        sm.markScheduleCompleted(schedule.id, nextRun);
      }
    } else {
      // failed
      sm.markScheduleFailed(
        schedule.id,
        job.error_message || "Background job failed",
        nextRun
      );
    }
  }
}

function updateExecutionFromJob(
  sm: ScheduleManager,
  scheduleId: number,
  job: { id: number; status: string; total_cost_usd: number; num_turns: number; duration_ms: number; error_message: string | null }
): void {
  // Find the most recent execution for this schedule
  const history = sm.getExecutionHistory(scheduleId, 1);
  if (history.length === 0) return;

  const latest = history[0];
  if (latest.job_id !== job.id) return;

  sm.updateExecution(latest.id, {
    status: job.status === "completed" ? "completed" : "failed",
    completed_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    cost_usd: job.total_cost_usd || 0,
    num_turns: job.num_turns || 0,
    duration_ms: job.duration_ms || 0,
    error_message: job.error_message,
  });
}

// ---------------------------------------------------------------------------

main().catch((err) => {
  process.stderr.write(`Scheduler daemon fatal error: ${err}\n`);
  process.exit(1);
});
