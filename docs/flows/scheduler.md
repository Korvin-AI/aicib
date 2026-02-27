# Agent Scheduler

## Overview

The Agent Scheduler lets you set up recurring agent runs — morning briefings, weekly reports, daily standups — so your AI company runs while you sleep. Schedules can be time-based (cron expressions) or event-triggered (fire when a task or project completes).

## Commands

### `aicib schedule`

Shows the scheduler dashboard: daemon status, upcoming schedules, and recent executions.

**What you see:**
```
AI Company-in-a-Box — Agent Scheduler

  Daemon:    RUNNING (PID 12345)
  Heartbeat: 15s ago
  Schedules: 3 enabled, 0 running, 3 total

  Upcoming:
    #1  Morning Briefing  ceo   2025-01-15 09:00:00  idle
    #2  Weekly Report      cfo   2025-01-17 17:00:00  idle

  Recent Executions:
    #5  Morning Briefing  cron  completed  2h ago  $1.2340
    #4  Morning Briefing  cron  completed  1d ago  $0.9821
```

### `aicib schedule create --name "Morning Briefing" --cron "0 9 * * 1-5" --directive "Prepare morning status briefing"`

Creates a cron-based schedule. Use `-i` for interactive mode with prompts.

**What can go wrong:**
- Invalid cron expression — rejected at creation time with a clear error message (applies to CLI, agent markers, and programmatic callers)

### `aicib schedule create --name "On Task Done" --trigger task_completed --directive "Review completed tasks"`

Creates an event-triggered schedule that fires when a task is completed.

### `aicib schedule list [--enabled] [--agent <role>]`

Lists all schedules with status, next run, and run count.

### `aicib schedule show <id>`

Shows full schedule details plus the last 10 executions.

### `aicib schedule enable <id>` / `aicib schedule disable <id>`

Toggles a schedule. Enabling recomputes `next_run_at` from the cron expression.

### `aicib schedule delete <id>`

Permanently removes a schedule and its execution history.

### `aicib schedule history [--schedule <id>] [--limit <n>]`

Shows execution history across all schedules or filtered to one.

### `aicib schedule start`

Starts the scheduler daemon as a detached background process.

**What can go wrong:**
- "Already running" — daemon is already active
- No `aicib init` — state database doesn't exist

### `aicib schedule stop`

Sends SIGTERM to the daemon. Falls back to SIGKILL after 5 seconds.

### `aicib schedule status`

Shows daemon PID, heartbeat freshness, config, and running/stopped state.

## How It Works

1. **Create schedules** via CLI or agent SCHEDULE:: markers
2. **Start the daemon** with `aicib schedule start`
3. **Daemon polls** every `poll_interval_seconds` (default 30s) for due schedules
4. **Spawns background briefs** for each due schedule via `startBackgroundBrief()`
5. **Tracks completion** — when background job finishes, updates schedule status and computes next run
6. **Event triggers** — message handler detects task/project completions and nudges matching schedules

## Safety Guards

- **Daily cost limit** — Daemon skips new runs if daily spending exceeds the configured limit
- **Quiet hours** — No new runs during configured quiet period (e.g., 22:00-06:00). Already-running jobs still get their status updated when they finish.
- **Concurrent limit** — Default 1, prevents overwhelming the system
- **Requires active session** — `aicib start` must have been run
- **Cost limit per run** — Before launching, checks if the schedule's average cost per run exceeds the limit (skips with error if so). After a job finishes, if that single execution exceeded the limit, the schedule is put in error state.
- **Missed run policy** — When set to `"skip"` (default), overdue schedules that missed their window (>2x poll interval late) are skipped and rescheduled to the next future occurrence. When set to `"run_once"`, overdue schedules fire once immediately then resume normal schedule.
- **Cron validation** — Invalid cron expressions are rejected at creation time (CLI, markers, and API), not silently ignored.

## Configuration

In `aicib.config.yaml`:
```yaml
scheduler:
  enabled: true                  # Enable/disable the scheduler system
  poll_interval_seconds: 30      # How often the daemon checks for due schedules
  max_concurrent: 1              # Max simultaneous scheduled executions
  cost_limit_per_run: 5.0        # Cost cap per execution (USD)
  missed_run_policy: skip        # "skip" or "run_once" for missed runs
  quiet_hours_start: "22:00"     # No runs after this time (null to disable)
  quiet_hours_end: "06:00"       # No runs before this time (null to disable)
```

## Common Schedule Patterns

```bash
# Weekday morning briefing at 9am
aicib schedule create --name "Morning Briefing" --cron "0 9 * * 1-5" \
  --directive "Review overnight activity and prepare morning status update"

# Weekly financial report on Fridays at 5pm
aicib schedule create --name "Weekly Report" --cron "0 17 * * 5" \
  --agent cfo --directive "Generate weekly financial summary"

# Every-minute test (for verification)
aicib schedule create --name "Test" --cron "* * * * *" --directive "Say hello"

# Fire when any task completes
aicib schedule create --name "Task Review" --trigger task_completed \
  --directive "Review the most recently completed task"
```

## Agent Markers

Agents can manage schedules via output markers:
```
SCHEDULE::CREATE name="Morning Briefing" cron="0 9 * * 1-5" directive="Prepare morning status"
SCHEDULE::CREATE name="On Task Done" trigger=task_completed directive="Review completed tasks"
SCHEDULE::ENABLE id=3
SCHEDULE::DISABLE id=3
SCHEDULE::DELETE id=3
```

## Technical Notes

- The daemon runs as a detached Node.js process, independent of the Slack daemon
- All executions use `startBackgroundBrief()` — the same pipeline as `aicib brief -b`
- PID and heartbeat stored in `scheduler_state` table for liveness detection
- Cron parsing uses `cron-parser` library (no internal timers, just `.next()` computation)
- Schedule data stored in `schedules` and `schedule_executions` tables in `.aicib/state.db`
