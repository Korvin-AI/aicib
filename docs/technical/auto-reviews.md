# Automated Performance Reviews — Technical Reference

## Architecture

The auto-review system follows the standard AICIB hook registration pattern:

- **`src/core/perf-review.ts`** — Core logic: metric collection, score computation, reviewer determination, queue processing, eligibility checks
- **`src/core/perf-review-register.ts`** — Side-effect registration: config extension, DB table, context provider, message handler
- **`src/cli/hr.ts`** — Extended with `hrAutoReviewsCommand` and `--auto` flag on `hrReviewsCommand`

## Database Schema

### `auto_review_queue` table

```sql
CREATE TABLE IF NOT EXISTS auto_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_role TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  trigger_data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','completed','skipped')),
  review_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
```

Indexes: `agent_role`, `status`.

## Integration Points

| Dependency | Usage |
|-----------|-------|
| `HRManager.createReview()` | Creates the actual review record in `hr_reviews` |
| `loadAgentDefinitions()` | Loads agent definitions for `reports_to` traversal |
| `tasks` table | Queries completion counts, assignment data |
| `cost_entries` table | Queries agent costs for efficiency scoring |
| `task_comments` table | Queries review approvals and collaboration activity |

## Queue Processing Flow

```
Task Completed → Message Handler detects TASK::UPDATE
  → Look up task assignee
  → Check for existing pending entry (deduplicate)
  → Insert into auto_review_queue

processAutoReviewQueue() called (via --process flag or AUTOREVIEW::PROCESS):
  → For each pending entry:
    1. Check eligibility (min_tasks, cooldown)
    2. Determine reviewer (org chart traversal)
    3. Collect 30-day metrics
    4. Compute 4 scores
    5. Calculate weighted overall score
    6. Derive recommendation
    7. Create HR review via HRManager.createReview()
    8. Update queue entry
```

## Scoring Details

### Task Score (0-100)
`completionRate = completed / assigned`; scaled to 0-100.

### Quality Score (0-100)
Review approval rate from `task_comments` WHERE `comment_type = 'review_result'` and content starts with "approved" (using `LIKE 'approved%'` to avoid matching "not approved"). Only `review_result` rows count in both numerator and denominator. Defaults to 100% if no review data.

### Efficiency Score (0-100)
Ratio of team average cost-per-task to agent cost-per-task, scaled: `min(100, max(0, round(ratio * 50)))`. An agent at team average scores 50; cheaper agents score higher. When `include_cost_efficiency: false` in config, this score is set to 0 and excluded from the weighted average.

### Collaboration Score (0-100)
Comment activity count from `task_comments`, capped at 20 interactions = 100.

### Weighted Average
Default weights: task 30%, quality 30%, efficiency 20%, collaboration 20%.
When `include_cost_efficiency: false`: task 37.5%, quality 37.5%, collaboration 25% (efficiency excluded).

## Org Chart Traversal

`getReviewerForAgent()` reads `reports_to` from agent frontmatter:
- CEO → `null` (no auto-review)
- C-suite (reports_to: founder) → `"ceo"`
- Department members → their `reports_to` value
- Unknown agents → `"ceo"` fallback

## Message Handler

The `auto-review-trigger` handler detects:
1. Task completions: same regex as `scheduler-register.ts` — `TASK::UPDATE id=N status=done` and NL patterns. Only processed when `trigger` config is `"task_completed"` or `"both"` (skipped for `"periodic"`).
2. `AUTOREVIEW::PROCESS` — triggers `processAutoReviewQueue()` (always honored regardless of trigger mode)
3. `AUTOREVIEW::SKIP id=<N>` — marks queue entry as skipped (always honored regardless of trigger mode)

Both this handler and the scheduler handler detect task completions independently. They operate on different tables (`auto_review_queue` vs `schedules`) so there is no conflict.

## Context Provider

The `auto-review-status` provider injects:
- Pending queue count
- Recent auto-review results
- Config summary (trigger, min tasks, cooldown)
- AUTOREVIEW:: marker documentation
