# Company Events

## What It Does

Manages scheduled corporate meetings (standups, all-hands, sprint planning, etc.) for the AI company. Events are defined with templates, scheduled via cron, and executed by the background worker. Output is parsed into structured minutes and action items.

## Key Files

| File | Purpose |
|------|---------|
| `src/core/events.ts` | EventManager class, types, event templates, participant resolution, agenda generation, minutes formatting, action item extraction |
| `src/core/events-register.ts` | Side-effect registration: config extension, DB tables, context provider, message handler |
| `src/cli/events.ts` | CLI commands: dashboard, list, create, show, delete, enable/disable, minutes, setup, history |

## Architecture

### Event Templates

Pre-defined templates for common meeting types:

| Type | Name | Format | Participants | Agenda Items |
|------|------|--------|-------------|--------------|
| standup | Daily Standup | structured | department | progress, today, blockers |
| all_hands | Monthly All-Hands | structured | all | metrics, updates, initiatives, Q&A |
| sprint_planning | Sprint Planning | structured | engineering | retro, backlog, goals, assignments |
| quarterly_review | Quarterly Business Review | structured | C-suite | revenue, product, customers, team, OKRs |
| one_on_one | One-on-One | free_form | hierarchy | wins, challenges, growth, feedback |
| retrospective | Retrospective | structured | department | good, improve, actions |

### Execution Flow

1. `events-register.ts` creates schedules via `ScheduleManager.createSchedule()` with `[EVENT::<id>::<instance_id>]` directive
2. Scheduler daemon fires the schedule, spawns background worker
3. Background worker detects `[EVENT::]` prefix:
   - Creates EventInstance
   - Resolves participants via org chart
   - Generates agenda
   - Runs CEO brief with event directive
   - Parses output for minutes + action items
   - Updates instance with results
   - Creates notifications for participants
   - Creates tasks for action items (if `auto_create_action_items` enabled)

### Participant Resolution

Uses `buildOrgTree()` from `org-chart.ts` with four modes:

- **all**: Flatten entire org tree
- **department**: Filter by department head roles + their workers
- **hierarchy**: Manager + direct reports
- **custom**: Explicit list of roles

### Action Item Extraction

Parses two patterns from event output:

- **Structured**: `ACTION_ITEM:: assignee=<role> description="<text>" [deadline=<date>]`
- **Natural language**: `<role> will <action>.`

### Context Provider

The `company-events` context provider injects:
- Upcoming scheduled events
- Recent meeting summaries
- Pending action items from meetings

### Message Handler

Detects EVENT:: markers in agent output:

- `EVENT::CREATE type=<type> name="<name>" [cron="<expr>"]`
- `EVENT::COMPLETE id=<n> [summary="<text>"]`
- `EVENT::CANCEL id=<n>`
- `EVENT::ACTION_ITEM assignee=<role> description="<text>" [deadline=<date>]`

## Database Schema

### company_events
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Event name |
| event_type | TEXT | standup, all_hands, etc. |
| description | TEXT | Event description |
| schedule_id | INTEGER FK | Associated schedule |
| cron_expression | TEXT | Recurring schedule |
| discussion_format | TEXT | async, structured, free_form |
| participants_config | TEXT | JSON participants config |
| agenda_template | TEXT | Meeting agenda template |
| enabled | INTEGER | Boolean |
| next_run_at | TEXT | Next scheduled occurrence |
| run_count | INTEGER | Total executions |

### event_instances
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| event_id | INTEGER FK | Parent event (CASCADE) |
| status | TEXT | scheduled, in_progress, completed, cancelled, skipped |
| participants | TEXT | JSON array of roles |
| agenda | TEXT | Generated agenda |
| minutes | TEXT | Formatted meeting minutes |
| action_items | TEXT | JSON array of action items |
| summary | TEXT | Executive summary |
| duration_ms | INTEGER | Execution time |
| cost_usd | REAL | API cost |

## Edge Cases

- No cron expression: event exists but must be triggered manually
- Participant resolution failure: falls back to all agents
- Action item extraction: deduplicates by assignee+description
- Schedule creation failure: event still created, schedule is best-effort
- Event deletion: cascades to all instances via FK
- SCHEDULED prefix: stripped before EVENT/PROJECT detection in background worker
- Malformed JSON: participants_config defaults to `{ mode: "all" }`, participants defaults to `[]`
- Task writeback: action items enriched with task_id after task creation

## Related

- `src/core/notifications.ts` - Event completions create notifications
- `src/core/scheduler.ts` - Events create schedules for recurring execution
- `src/core/org-chart.ts` - `buildOrgTree()` for participant resolution
- `src/core/task-manager.ts` - Action items converted to tasks
- `src/core/background-worker.ts` - `[EVENT::]` prefix detection and execution
