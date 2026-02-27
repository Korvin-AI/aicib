# Projects (Long Autonomous Task Chains)

## Overview

Projects let you give AICIB a big, multi-step goal instead of a single brief. The CEO breaks it into phases, executes each one sequentially, reviews its own work, and retries failed phases — all autonomously in the background.

## Commands

### `aicib brief -p "your project brief"`

Creates a project and starts autonomous execution in the background.

**What you see:**
```
AI Company-in-a-Box — Briefing CEO

Company: MyStartup
Directive: "Build a complete landing page with analytics and email capture"

  Project created. CEO is planning phases.

  Project #1 | Job #5 | PID 12345
  Check progress:  aicib project status
  View full logs:  aicib logs
  Cancel project:  aicib project cancel
```

**What can go wrong:**
- "No active session found" → Run `aicib start` first
- "Daily cost limit reached" → Increase limit in config or wait until tomorrow

### `aicib project status`

Shows the active project with phase-by-phase progress.

**What you see:**
```
AI Company-in-a-Box — Project Status

  Build Landing Page with Analytics
  ────────────────────────────────────────────────────
  Status:    executing     Phases: 2/4
  Cost:      $3.4521       Turns:  42
  Duration:  8.2m
  Created:   5 minutes ago

  Phases:
    ✓ Phase 1: Setup project structure completed $0.85 2.1m
    ✓ Phase 2: Build landing page UI completed $1.20 3.0m
    ▶ Phase 3: Add analytics tracking executing
    ○ Phase 4: Email capture integration
```

### `aicib project list`

Lists all projects with their status and cost.

### `aicib project cancel`

Cancels the active project and kills the background worker.

**What happens:**
1. Marks the project as "cancelled" in the database
2. Finds the background worker process (using the project's session ID)
3. Sends SIGTERM to kill it
4. Sets CEO status to idle

## How It Works

1. **Planning phase** — CEO receives the brief and decomposes it into 2-8 sequential phases, each with a title, objective, and acceptance criteria
2. **Execution loop** — For each phase:
   - CEO executes the phase using the full agent team
   - A summary is generated (via haiku) for context in later phases
   - CEO reviews its own work against the acceptance criteria
   - If APPROVED: phase marked complete, move to next
   - If REJECTED: retry with feedback (up to `max_phase_retries` times)
3. **Completion** — When all phases are done (or one fails after max retries), the project is marked completed/failed

## Safety Guards

- **Daily cost limit** — Checked before each phase. Project pauses if exceeded.
- **SIGTERM** — `aicib stop` sends SIGTERM; project pauses between phases.
- **External cancellation** — `aicib project cancel` sets status in DB. Worker checks at the top of each phase loop and stops.
- **Retry cap** — Each phase has a max retry count (default 3). After that, project fails.

## Configuration

In `aicib.config.yaml`:
```yaml
projects:
  enabled: true          # Enable/disable project system
  max_phases: 10         # Maximum phases per project
  max_phase_retries: 3   # Retries per phase before failing
  phase_budget_usd: 10   # (Not enforced yet — daily limit is the guard)
  phase_max_turns: 300   # (Not enforced yet)
  planning_model: haiku  # Model for extracting the plan
  review_model: opus     # Model for phase review
  summary_model: haiku   # Model for phase summaries
```

## Technical Notes

- Projects always run in background mode (they can take hours)
- Each phase reuses the same SDK session, so the CEO has full context from prior phases
- Completed phase summaries are injected into subsequent phase prompts
- Phase data stored in `projects` and `project_phases` tables in `.aicib/state.db`
- Review defaults to APPROVED if the output is ambiguous (prevents infinite retry loops)
