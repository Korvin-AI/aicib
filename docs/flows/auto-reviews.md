# Automated Performance Reviews

Automated performance reviews evaluate agents when tasks complete, following the org chart to determine the reviewer. No manual score entry needed.

## Quick Start

```bash
# View auto-review dashboard
aicib hr auto-reviews

# Process pending auto-reviews
aicib hr auto-reviews --process

# View only automated reviews for an agent
aicib hr reviews backend-engineer --auto
```

## How It Works

1. **Task Completion Detected**: When an agent completes a task (`TASK::UPDATE id=N status=done`), the system queues an auto-review. Only happens when `trigger` is `task_completed` or `both` (not `periodic`).
2. **Eligibility Check**: The agent must have completed at least `min_tasks_before_review` tasks and be past the `cooldown_hours` since their last review
3. **Metrics Collected**: Task completion rate, cost efficiency, review approval rate, collaboration activity
4. **Scores Computed**: Four scores (0-100) are calculated from the metrics
5. **Reviewer Determined**: Follows the `reports_to` field in agent definitions (CTO reviews engineers, CEO reviews department heads)
6. **Review Created**: An HR review record is created with computed scores and a recommendation

## Scoring Algorithm

| Score | Weight | Weight (no efficiency) | Calculation |
|-------|--------|----------------------|-------------|
| Task Score | 30% | 37.5% | Completion rate (completed/assigned) scaled to 0-100 |
| Quality Score | 30% | 37.5% | Review approval rate from review_result comments * 100 |
| Efficiency Score | 20% | 0% (excluded) | Cost efficiency vs team average (lower cost = higher score) |
| Collaboration Score | 20% | 25% | Comment activity count, capped at 20 interactions = 100 |

When `include_cost_efficiency: false`, efficiency is excluded and its weight is redistributed to the other scores.

## Recommendations

| Overall Score | Recommendation |
|--------------|----------------|
| >= 85 | `promote` |
| >= 60 | `maintain` |
| >= 40 | `improve` |
| < 40 | `demote` |

## Reviewer Determination

- CEO is never auto-reviewed (founder reviews manually)
- Other agents: reviewer is determined by `reports_to` field in their agent definition
- C-suite agents (reporting to founder): reviewed by CEO
- Department members: reviewed by their department head

## Configuration

In `aicib.config.yaml`:

```yaml
auto_reviews:
  enabled: true
  trigger: task_completed      # task_completed | periodic | both
  min_tasks_before_review: 3   # minimum completed tasks before first review
  cooldown_hours: 48           # hours between reviews for same agent
  include_cost_efficiency: true
  periodic_cadence: monthly
```

## Agent Markers

```
AUTOREVIEW::PROCESS           — process the pending review queue
AUTOREVIEW::SKIP id=<N>       — skip a queue entry
```
