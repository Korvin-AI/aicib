# Agent Scheduler

## What It Does

Runs agents on schedules — morning briefings, weekly reports, daily standups — enabling the "runs while you sleep" promise. Schedules can be time-based (cron) or event-triggered (task completion, project completion).

## How It Works

### Architecture

```
aicib schedule start → scheduler-daemon.ts (poll loop)
                         ├── getDueSchedules(now)
                         ├── startBackgroundBrief() per due schedule
                         └── checkCompletedSchedules() → update status + next_run_at

CEO prompt ← scheduler-register.ts context provider
           → SCHEDULE:: markers → message handler → ScheduleManager
```

### Poll Loop

1. Update heartbeat timestamp in `scheduler_state` table
2. **Check completed schedules first** — update status of already-running jobs regardless of guards. If a completed job exceeded `cost_limit_per_run`, schedule is put in error state.
3. Check quiet hours — skip new runs if in quiet period
4. Check daily cost limit — skip new runs if exceeded
5. Check for active SDK session — skip silently if none
6. Query `getDueSchedules(now)` — enabled schedules where `next_run_at <= now` and not running
7. For each due schedule (respecting `max_concurrent`):
   - **missed_run_policy check**: if `"skip"` and overdue by >2x poll interval, recompute `next_run_at` and record a "skipped" execution
   - **cost_limit_per_run check**: if average cost/run exceeds limit, mark schedule as error
   - Otherwise: spawn via `startBackgroundBrief()`, record execution

### Event Triggers

The message handler detects task/project completions in agent output and nudges matching trigger-based schedules by setting their `next_run_at` to "now". The daemon picks them up on its next poll.

### Cost Tracking

Each schedule execution reuses `startBackgroundBrief()`, so all standard cost tracking, journal entries, and Slack log polling work automatically. The schedule's `total_cost_usd` accumulates across all executions.

### Quiet Hours

When `quiet_hours_start` and `quiet_hours_end` are configured, the daemon skips poll iterations during that window. Supports midnight-wrapping (e.g., 22:00-06:00).

## Key Files

- `scheduler.ts` — `ScheduleManager` class: DB access, CRUD, cron computation, context formatting. Uses `ALLOWED_SCHEDULE_COLUMNS` and `ALLOWED_EXECUTION_COLUMNS` whitelists for dynamic updates (matches `task-manager.ts` pattern). Validates cron expressions eagerly in `createSchedule()`.
- `scheduler-register.ts` — Hook registrations: config extension, DB tables, context provider, message handler. Deduplicates trigger actions by `triggerType:triggerValue` (not by schedule id/name).
- `scheduler-daemon.ts` — Long-lived daemon process with poll loop. Runs `checkCompletedSchedules()` before early-return guards. Enforces `cost_limit_per_run` and `missed_run_policy`.
- `scheduler-state.ts` — Key-value state helpers for daemon PID/heartbeat
- `cli/schedule.ts` — CLI commands: dashboard, list, create, show, delete, enable, disable, history, start, stop, status

## Database Schema

### `schedules` table
One row per schedule. Tracks name, cron expression, agent target, directive, status, trigger configuration, run count, total cost, and computed `next_run_at`.

### `schedule_executions` table
One row per execution attempt. Links to `background_jobs` via `job_id`. Tracks trigger source, status, timing, cost, and errors.

### `scheduler_state` table
Key-value store for daemon liveness: `daemon_pid`, `daemon_heartbeat`, `connection_state`.

## Edge Cases

- **Missed runs**: Controlled by `missed_run_policy`. Default "skip" recomputes to next future occurrence if overdue by >2x `poll_interval_seconds` and records a "skipped" execution. "run_once" fires immediately then resumes normal schedule (current default behavior).
- **Cost limit per run**: Checked before execution (average cost/run) and after completion (single execution cost). Schedule put in error state when exceeded.
- **Stale heartbeat**: CLI warns if heartbeat is >2 minutes old (daemon may be hung).
- **No active session**: Daemon skips new runs silently if `aicib start` hasn't been run. Already-running jobs still get their completion status updated.
- **Concurrent limit**: Default `max_concurrent: 1` respects the single-background-job limitation. Configurable up to 10.
- **Daemon crash**: PID stored in DB; CLI detects dead process and reports "CRASHED" status.
- **Invalid cron**: Rejected at `createSchedule()` with a clear error. Affects all callers (CLI, markers, API).
- **Running schedules during quiet hours**: `checkCompletedSchedules()` runs before quiet-hours guard, so running jobs get their status updated even during quiet hours.

## Related

- [Scheduler user guide](../flows/scheduler.md)
- [Background Mode](../flows/start-brief-stop.md)
- [Projects](../flows/projects.md)
- [Cost tracking](../flows/cost-and-budgets.md)
