# HR System — Technical

## What It Does

Full agent lifecycle management: hire, onboard (4-phase ramp), review, promote/demote, improvement plans, state changes, and firing. All actions are immutable HR events stored in SQLite.

## Key Files

- `src/core/hr.ts` — `HRManager` class: all DB operations, scoring logic, event logging
- `src/core/hr-register.ts` — Hook registration: config extension, DB tables, context provider, message handler
- `src/cli/hr.ts` — CLI commands: dashboard, onboard, review, promote, demote, improve, state, history, list
- `src/index.ts` — Commander command definitions for `aicib hr *`

## Architecture

### Hook Registration Pattern

Follows the same pattern as `task-register.ts`:

1. **Config extension** (`hr:` section) — validates `enabled`, `review_cadence`, `onboarding_ramp`, `max_context_events`, `auto_onboard`
2. **DB tables** — `hr_events`, `hr_onboarding`, `hr_reviews`, `hr_improvement_plans` (registered via `registerTable`)
3. **Context provider** (`hr-context`) — injects onboarding status, active plans, recent events, and HR:: action markers into agent prompts
4. **Message handler** (`hr-actions`) — parses HR:: markers and NL patterns from agent output, queues actions with 500ms debounce, flushes to DB

### Database Schema

**hr_events** — Immutable audit log. Every HR action creates an event with `agent_role`, `event_type`, JSON `details`, `performed_by`.

**hr_onboarding** — One row per agent (PK: `agent_role`). Tracks `current_phase` (1-4), `mentor`, `ramp_speed`, `completed_at`.

**hr_reviews** — Performance reviews with 4 sub-scores (task, quality, efficiency, collaboration), weighted average `overall_score`, and `recommendation`.

**hr_improvement_plans** — Active/resolved plans with goals (JSON array), deadline, status, outcome.

### Score Calculation

Weighted average: task (0.3), quality (0.3), efficiency (0.2), collaboration (0.2). Nulls excluded from both numerator and denominator. Result rounded to 1 decimal.

### Message Handler Flow

1. Extracts text from assistant message content blocks
2. Runs regex for each HR:: marker type (HIRE, REVIEW, PROMOTE, etc.)
3. Runs NL fallback patterns (high-confidence only: "hired agent X", "completed onboarding for X")
4. Queued actions flush after 500ms debounce via `setTimeout`
5. Flush opens one `HRManager` instance, processes all queued actions, closes

### Mentor Propagation

`HR::HIRE role=X department=Y mentor=Z` → `recordHire()` passes `mentor` → `startOnboarding()` stores mentor in `hr_onboarding` table.

### NL "completed onboarding" Handling

The NL pattern `"completed onboarding for X"` dispatches an `onboard_complete` action (not `onboard_advance`). The flush handler calls `hr.completeOnboarding()` which jumps directly to phase 4 and marks `completed_at`.

### Promote/Demote `--from` Resolution

When `--from` is not provided on the CLI, `resolveFromLevel()`:
1. Scans HR events for latest `promoted`/`demoted` event → uses `to_level` from details
2. Falls back to onboarding completion phase's autonomy level
3. Last resort: returns `"unknown"`

### Review-Due Filtering

`getAgentsDueForReview()` excludes agents with:
- State `"archived"` or `"stopped"` (via `getAgentState()`)
- Any `"fired"` event (via `getEvents()`)

### Improvement Plan Role Validation

`hr improve <role> --resolve <id>` validates that `plan.agent_role === role` after update, preventing accidental cross-agent plan resolution.

## Design Decisions

- **Module-level mutable state** (`pendingActions`, `lastProjectDir`): Matches `task-register.ts` pattern. One project per process.
- **Separate `HRManager` constructor per operation**: Each CLI command and the flush handler create their own DB connection. SQLite WAL mode handles concurrent access.
- **Schema duplication** (ensureTables + registerTable): Established pattern. `HRManager` is self-contained for CLI use; `registerTable` is for CostTracker integration.
- **HR_CONFIG_DEFAULTS in recordHire**: `HRManager` doesn't receive config. Callers pass `rampSpeed` explicitly when known.
