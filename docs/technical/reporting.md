# Reporting Suite — Technical Reference

## Architecture

The Reporting Suite follows the standard AICIB hook registration pattern:

- **`src/core/reporting.ts`** — `ReportManager` class with CRUD, template management, metrics collection, and context formatting
- **`src/core/reporting-register.ts`** — Side-effect registration: config extension, DB table, context provider, message handler
- **`src/cli/report.ts`** — CLI commands: dashboard, generate, list, show, templates, schedule

## Database Schema

### `reports` table

```sql
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type TEXT NOT NULL CHECK(report_type IN ('daily_briefing','weekly_department','monthly_financial','sprint_review','marketing_report','custom')),
  title TEXT NOT NULL,
  author_agent TEXT NOT NULL DEFAULT 'ceo',
  content TEXT NOT NULL DEFAULT '',
  metrics_snapshot TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','generating','completed','failed')),
  delivery_method TEXT NOT NULL DEFAULT 'file' CHECK(delivery_method IN ('slack','file','both')),
  schedule_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
```

Indexes: `report_type`, `status`, `created_at`.

## Integration Points

| Dependency | Usage |
|-----------|-------|
| `CostTracker` | Queries `cost_entries` for spending metrics |
| `TaskManager` | Queries `tasks` for task status/completion metrics |
| `HRManager` | Queries `hr_reviews` for review data |
| `ScheduleManager` | Creates scheduler entries for recurring reports |
| `startBackgroundBrief()` | Spawns background jobs for report generation |

## Metrics Collection

`ReportManager.collectMetrics(projectDir)` opens a read-only DB connection and queries:
- `cost_entries` — today/month costs, per-agent breakdown, 7-day history
- `tasks` — status counts, recently completed
- `hr_reviews` — latest reviews with scores
- `ceo_journal` — recent journal entries

All queries use `try/catch` to gracefully handle missing tables.

## Message Handler

The `report-actions` handler parses three marker types:
1. `REPORT::GENERATE type=<type> [title="..."]` — Creates a pending report with collected metrics
2. `REPORT::COMPLETE id=<N>` — Marks a report as completed and captures the full assistant message text as report content (stripping the marker itself)
3. `REPORT::SCHEDULE type=<type> cron="<expr>"` — Creates a scheduler entry

The `buildReportDirective()` method injects the actual report ID into the completion marker (e.g., `REPORT::COMPLETE id=42`), so the agent emits a parseable marker that references the correct report record.

Uses the standard debounced queue pattern (500ms flush timer).

## Context Provider

The `reporting-status` provider injects into agent prompts:
- Recent reports (up to `max_context_reports`)
- Available REPORT:: markers documentation
- Truncated output if context exceeds 3000 characters
