# Tasks — Managing Your AI Company's Work

## Overview

The task system lets you track what your AI company is working on — like a project board for your AI employees. You create tasks, assign them to agents, and track progress. Agents can also create and update tasks during their work.

## Quick Start

```bash
aicib tasks                                    # Dashboard — see what's happening
aicib tasks create --title "Build pricing page"  # Create a task
aicib tasks list                                # List all tasks
aicib tasks show 1                              # See full details of task #1
aicib tasks update 1 --status done              # Mark task #1 as done
```

## Commands

### Dashboard: `aicib tasks`

Shows a summary of all tasks — how many are in each status, plus a table of active work.

Good for a quick check-in: "What's my AI team working on right now?"

### Create: `aicib tasks create`

```bash
# Quick creation
aicib tasks create --title "Design landing page" --department marketing --assign cmo --priority high

# Interactive (walks you through each field)
aicib tasks create -i

# Subtask (belongs to a parent task)
aicib tasks create --title "Write hero copy" --parent 1

# With deadline
aicib tasks create --title "Q1 report" --deadline "2026-03-31T17:00:00"
```

**Fields:**
| Flag | What it does |
|------|-------------|
| `--title` | Task name (required) |
| `--description` | Longer explanation |
| `--department` | engineering, finance, or marketing |
| `--assign` | Which agent gets this (cto, cfo, cmo, etc.) |
| `--priority` | critical, high, medium, or low (default: medium) |
| `--parent` | Parent task ID — makes this a subtask |
| `--deadline` | Due date in ISO format |
| `-i` | Interactive mode — prompts for each field |

### List: `aicib tasks list`

```bash
# All active tasks
aicib tasks list

# Filter by status
aicib tasks list --status in_progress
aicib tasks list --status "in_progress,in_review"   # Multiple statuses

# Filter by department or agent
aicib tasks list --department engineering
aicib tasks list --assigned cto

# Special filters
aicib tasks list --overdue           # Past deadline
aicib tasks list --blocked           # Waiting on other tasks
aicib tasks list --priority critical # Only critical priority

# Combine filters
aicib tasks list --department engineering --status in_progress --limit 10
```

### Show: `aicib tasks show <id>`

Shows everything about one task: description, who's assigned, blockers, subtasks, and the full comment history.

```bash
aicib tasks show 5
```

### Update: `aicib tasks update <id>`

```bash
# Change status
aicib tasks update 5 --status done

# Reassign
aicib tasks update 5 --assign cto

# Change priority
aicib tasks update 5 --priority critical

# Add a comment
aicib tasks update 5 --comment "Needs revision — copy is too technical"

# Multiple changes at once (single database call)
aicib tasks update 5 --status in_review --assign cmo --priority high
```

### Review: `aicib tasks review`

Shows tasks that are in the "in review" status — waiting for your approval.

```bash
aicib tasks review
```

## Task Statuses

Think of these like a Kanban board, left to right:

| Status | Meaning |
|--------|---------|
| **backlog** | Idea captured, not yet planned |
| **todo** | Ready to work on |
| **in_progress** | Someone's actively working on it |
| **in_review** | Done, waiting for your review |
| **done** | Complete and approved |
| **cancelled** | No longer needed |

## How Agents Use Tasks

When you send a brief to the CEO, agents can see the task board in their instructions and can create/update tasks automatically.

**Structured markers** (reliable, machine-readable):
```
TASK::CREATE title="Implement auth module" department=engineering assigned=cto priority=high
TASK::UPDATE id=5 status=done
TASK::COMMENT id=5 "Auth module complete with JWT tokens"
```

**Natural language** (agents can also say things like):
- "completed task #5" → marks #5 as done
- "working on task #3" → marks #3 as in progress
- "requesting review task #7" → marks #7 as in review

## Blockers (Dependencies)

Tasks can block other tasks. If Task A must be done before Task B can start, Task A is a "blocker" of Task B.

The system prevents circular dependencies — you can't have A blocking B and B blocking A.

Blocked tasks get a lower priority score in the CEO's view, so agents focus on unblocked work first.

## Config

In your `aicib.config.yaml`:

```yaml
tasks:
  enabled: true                # Turn the whole task system on/off
  max_context_tasks: 15        # How many tasks agents see in their instructions
  deadline_urgency_hours: 24   # Tasks within this many hours of deadline get priority boost
```

## What Can Go Wrong

- **"No tasks match the filter"** — Your filters are too narrow. Try without filters first.
- **"Task ID must be a number"** — Use the numeric ID (e.g., `5`), not a name.
- **"Cycle detected"** — You're trying to create a circular dependency. Task A can't block B if B already blocks A (directly or indirectly).

## Review Chains

Tasks go through multi-layer review chains before being marked as done. Different task types have different chains:

- **Internal documents:** self-review only
- **Code:** self + peer review
- **Marketing for publishing:** self + peer + department head + owner
- **Strategic plans:** department head + C-suite + owner

The system infers the chain type from the task title. You can customize chains in config:

```yaml
tasks:
  default_review_chains:
    code: [self, peer]
    marketing_external: [self, peer, department_head, owner]
```

```bash
aicib reviews              # See chain config and in-review tasks with progress
```

Each layer assigns a specific reviewer. If no reviewer is available for a layer (e.g., no peer in a solo department), that layer is automatically skipped. If no reviewer is available for any layer, the chain auto-completes.

## Related

- `docs/technical/task-management.md` — Technical architecture details
- `docs/technical/review-chains.md` — Review chain architecture
- `docs/flows/routing.md` — Communication routing rules
- `docs/edge-cases.md` — Full list of edge cases
