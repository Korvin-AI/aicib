# Task Management System

## Overview

A full task tracking system that lets both the human founder and AI agents create, assign, and track tasks. Tasks live in SQLite alongside cost and session data, are injected into the CEO's prompt for delegation awareness, and are auto-updated when agents mention task actions in their output.

## File Structure

```
src/core/
  task-manager.ts       # TaskManager class — CRUD, queries, blockers, subtasks, context formatting
  task-register.ts      # Side-effect registration (config + DB tables + context provider + message handler)

src/cli/
  tasks.ts              # CLI commands: list, create, show, update, review, dashboard
```

## Integration Pattern

Same hook pattern as Slack and Intelligence features:

1. **Side-effect import** in `index.ts` loads `task-register.ts`
2. Register.ts calls `registerConfigExtension()` for the `tasks:` config section
3. Register.ts calls `registerTable()` for 3 tables: `tasks`, `task_blockers`, `task_comments`
4. Register.ts calls `registerContextProvider()` for `task-board` — injects active tasks into CEO's prompt
5. Register.ts calls `registerMessageHandler()` for `task-actions` — parses TASK:: markers from agent output

**Core files NOT modified:** `agent-runner.ts`, `config.ts`, `cost-tracker.ts`

## Database Schema

### tasks

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| title | TEXT | Task title |
| description | TEXT | Detailed description |
| status | TEXT | `backlog`, `todo`, `in_progress`, `in_review`, `done`, `cancelled` |
| priority | TEXT | `critical`, `high`, `medium`, `low` |
| assignee | TEXT | Agent role name (e.g., "cto") |
| reviewer | TEXT | Agent role name for reviews |
| department | TEXT | `engineering`, `finance`, `marketing` |
| project | TEXT | Optional project grouping |
| parent_id | INTEGER | For subtask hierarchy (FK to tasks.id) |
| deadline | TEXT | ISO 8601 datetime |
| created_by | TEXT | `human-founder` or agent role |
| session_id | TEXT | Session that created the task |
| created_at | TEXT | Auto-set on creation |
| updated_at | TEXT | Auto-updated on changes |
| completed_at | TEXT | Set when status moves to `done` |

Indexed on: status, assignee, priority, department, parent_id, deadline, session_id

### task_blockers

| Column | Type | Description |
|--------|------|-------------|
| task_id | INTEGER | The blocked task |
| blocker_id | INTEGER | The task that blocks it |

Composite primary key. Both FK to tasks.id with CASCADE delete.

### task_comments

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| task_id | INTEGER | FK to tasks.id |
| author | TEXT | Who wrote it |
| content | TEXT | Comment text |
| comment_type | TEXT | `comment`, `status_change`, `assignment`, `review_request`, `review_result` |

## Key Functions

### TaskManager class

| Method | Purpose |
|--------|---------|
| `createTask(input)` | Create with auto-comment. Uses `??` for nullable fields |
| `updateTask(id, fields)` | Dynamic UPDATE with column whitelist. Auto-logs status/assignment changes |
| `listTasks(filter?, limit?)` | Filtered queries with support for `--blocked`, `--overdue`, multi-status |
| `getTaskSummary()` | Count by status for dashboard display |
| `addBlocker(taskId, blockerId)` | Adds dependency edge with BFS cycle detection |
| `wouldCreateCycle(taskId, blockerId)` | BFS from taskId following blocker edges — returns true if blockerId is reachable |
| `assignTask(taskId, assignee)` | Delegates to `updateTask()` which logs the assignment comment |
| `requestReview(taskId, reviewer)` | Sets status to `in_review` + assigns reviewer |
| `formatForContext(agentRole?, dept?, maxTasks?)` | Markdown task board for prompt injection (4000-char limit) |
| `getTaskTree(parentId?)` | Recursive subtask tree |

### Column Whitelist

`updateTask()` uses a hardcoded allowlist to prevent SQL injection from dynamic keys:

```typescript
const ALLOWED_COLUMNS = new Set([
  "title", "description", "status", "priority", "assignee", "reviewer",
  "department", "project", "parent_id", "deadline",
]);
```

Keys not in this set are silently skipped.

### Context Scoring

`formatForContext()` selects the most relevant tasks using a scoring algorithm:
- Priority weight: critical=100, high=75, medium=50, low=25
- Status boost: in_progress=40, in_review=30, todo=10
- Deadline urgency: +50 if within `deadline_urgency_hours` (default 24h)
- Blocked penalty: -20 if blocked by unfinished tasks

## Agent Message Handler

The `task-actions` message handler parses agent output for two types of task markers:

### Structured TASK:: Markers (Primary)

```
TASK::CREATE title="Build login page" department=engineering assigned=cto priority=high
TASK::UPDATE id=5 status=done
TASK::COMMENT id=5 "Implementation complete, all tests passing"
```

- `TASK::CREATE` supports order-independent key=value pairs after the required `title="..."`.
- Fields: `department`, `assigned`, `priority` can appear in any order.

### Natural Language Fallback

Patterns require the word "task" before `#N` to reduce false positives:

- `completed task #5` → marks task #5 as done
- `working on task #3` → marks task #3 as in_progress
- `requesting review task #7` → marks task #7 as in_review

### Debounced Processing

Updates are queued and flushed every 500ms to avoid per-message DB churn. Module-level `lastProjectDir` bridges the context provider (which receives `projectDir`) and the message handler (which doesn't).

**Single-session assumption:** One `lastProjectDir` per process. Safe because AICIB runs one session per CLI process; background workers are separate Node processes with their own module scope.

## Cycle Detection

BFS traversal prevents circular blocker dependencies:

1. `addBlocker(taskId, blockerId)` calls `wouldCreateCycle(taskId, blockerId)`
2. BFS starts from `taskId`, follows `blocker_id` edges (what blocks each task)
3. If `blockerId` is reachable from `taskId`, adding the edge would create a cycle → throws error

Example: B blocks A (edge A→B). Adding A as blocker of B (`addBlocker(B, A)`) — BFS from B finds A via the existing B→A? No, follows blocker_id edges: from B, finds A (A is B's blocker). But we need to check if B is already reachable from... Actually: BFS from taskId=B follows "what blocks B" = A. Then "what blocks A" = nothing. blockerId=A was found at step 1. Returns true → cycle prevented.

## Config

```yaml
tasks:
  enabled: true                    # Set false to disable task system
  max_context_tasks: 15            # Max tasks injected into CEO prompt
  deadline_urgency_hours: 24       # Hours before deadline to boost priority score
  default_review_chains:           # Review workflows by task type (future phase)
    code: [self, peer]
    financial_report: [self, peer, csuite]
```

## Related Docs

- `docs/flows/tasks.md` — User guide for task CLI commands
- `docs/technical/agent-runner.md` — Hook system and context providers
- `docs/technical/agent-intelligence.md` — Autonomy, escalation, skills
- `docs/edge-cases.md` — Task management edge cases
