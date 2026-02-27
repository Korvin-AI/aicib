# Project System (Long Autonomous Task Chains)

## What It Does

Orchestrates multi-phase autonomous execution. A single brief is decomposed into sequential phases, each executed, reviewed, and retried if needed — all without human intervention.

## How It Works

### Architecture

```
brief.ts -p → startBackgroundProject() → background-worker.ts → runProjectLoop()
                                                                   ├── Planning phase
                                                                   └── Execution loop
                                                                        ├── sendBrief()
                                                                        ├── Summary (haiku)
                                                                        ├── Review (opus)
                                                                        └── Verdict → retry / next / fail
```

### Execution Loop

1. Worker reads next pending phase from DB
2. Safety checks at top of loop: SIGTERM, external cancel/pause, daily cost limit
3. Marks phase as "executing"
4. Builds phase prompt (includes prior phase summaries + retry feedback if applicable)
5. Calls `sendBrief()` — same code path as a normal brief
6. Generates summary via haiku (best-effort)
7. Reviews against acceptance criteria
8. Parses verdict (APPROVED / REJECTED)
9. On approve: marks complete, accumulates costs, gets next phase
10. On reject + retries left: resets to pending, increments attempt, stores feedback
11. On reject + no retries: marks phase and project as failed

### Cost Accumulation

Costs accumulate across retries. Each retry adds to the phase's running totals (`cost_usd`, `num_turns`, `duration_ms`). When a phase completes (or fails after max retries), the accumulated phase totals are added to the project totals. This ensures no costs are lost when phases are retried.

### Error Handling

The phase execution block is wrapped in a try/catch. If `sendBrief()` or any other operation throws mid-phase:
1. Phase is marked `"failed"` with the error message and `completed_at`
2. Prior accumulated costs from the phase row are added to project totals
3. Project is marked `"failed"`
4. Loop breaks — normal completion logic runs (updates background job)

This prevents phases from staying orphaned in `"executing"` status.

### External Cancellation

The worker re-reads project status from DB at the top of each loop iteration. If `aicib project cancel` sets the status to `"cancelled"`, the worker detects it and breaks out. This works even if SIGTERM delivery fails.

### Background Job Status Mapping

When the loop ends, project status maps to job status:
- `"completed"` → job `"completed"`
- `"paused"` → job `"completed"` (the job finished normally; project can resume later)
- `"failed"` → job `"failed"`

## Key Files

- `background-worker.ts` — `runProjectLoop()`: the core orchestration loop
- `project-planner.ts` — `ProjectPlanner` class: DB access, prompt builders, plan parser
- `project-register.ts` — Hook registrations: config extension, DB tables, context provider, message handler
- `cli/project.ts` — CLI commands: `status`, `list`, `cancel`
- `cli/brief.ts` — `-p` flag triggers `startBackgroundProject()`

## Database Schema

### `projects` table
Stores project metadata: title, brief, status, phase counts, accumulated cost/turns/duration.

### `project_phases` table
One row per phase. Tracks status, attempt count, cost/turns/duration (accumulated across retries), summary, error message.

`UNIQUE(project_id, phase_number)` constraint prevents duplicate phases.

## Edge Cases

See `docs/edge-cases.md` under "Projects" section.

## Related

- [Projects user guide](../flows/projects.md)
- [Start/Brief/Stop flow](../flows/start-brief-stop.md)
- [Cost tracking](../flows/cost-and-budgets.md)
