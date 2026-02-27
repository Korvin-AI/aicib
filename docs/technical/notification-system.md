# Notification System

## What It Does

Provides urgency-based notification routing for the AI company. Notifications are created by agent markers, event completions, or CLI commands and delivered via Slack DM, dashboard, or digest batches based on urgency thresholds and user preferences.

## Key Files

| File | Purpose |
|------|---------|
| `src/core/notifications.ts` | NotificationManager class, types, config defaults, urgency evaluation, digest batching, Slack delivery |
| `src/core/notifications-register.ts` | Side-effect registration: config extension, DB tables, context provider, message handler |
| `src/cli/notifications.ts` | CLI commands: dashboard, list, show, dismiss, preferences, send |

## Architecture

### Urgency Model

Notifications have four urgency levels with automatic category-based mapping:

- **Critical**: system_error, budget, blocked_deal
- **High**: approval_needed, escalation
- **Medium**: task_completion, status_update, event_output, event_reminder, action_item, general
- **Low**: agent_activity

### Delivery Flow

1. Notifications created via NOTIFY:: markers, event completions, or CLI
2. Scheduler daemon's `pollOnce()` calls `processNotificationQueue()`:
   - Critical: deliver immediately via Slack DM (even during quiet hours)
   - High: deliver via Slack DM (skip during quiet hours)
   - Medium/Low: batch into digests per target
3. Slack delivery reads `bot_token` from `slack_state` table, falls back to dashboard

### Context Provider

The `notification-status` context provider injects into agent prompts:
- Unread notification count
- Recent critical/high notifications
- Pending action items

### Message Handler

Detects two pattern types in agent output:

**Structured markers:**
- `NOTIFY::CREATE urgency=<level> title="<text>" [category=<cat>] [target=<agent>] [body="<text>"]`
- `NOTIFY::DISMISS id=<n>`

**Natural language fallbacks:**
- `CRITICAL:` / `ALERT:` / `system error` -> critical notification
- `needs approval` / `escalating to` -> high notification
- `completed task` / `finished` -> medium task_completion

Uses 500ms debounced queue with dedup by `title:category:target`.

## Database Schema

### notifications
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| title | TEXT | Notification title |
| body | TEXT | Detailed body text |
| urgency | TEXT | critical, high, medium, low |
| category | TEXT | system_error, budget, etc. |
| source_agent | TEXT | Who created it |
| target_agent | TEXT | Who should receive it |
| target_department | TEXT | Department scope |
| event_id | INTEGER | Associated event |
| status | TEXT | pending, delivered, read, dismissed, batched |
| delivery_channel | TEXT | slack_dm, slack_channel, dashboard, digest |
| delivered_at | TEXT | Delivery timestamp |
| scheduled_for | TEXT | Future delivery time |
| metadata | TEXT | JSON extra data |

### notification_preferences
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| scope | TEXT | global, department, agent |
| scope_value | TEXT | Scope identifier |
| min_push_urgency | TEXT | Threshold for push delivery |
| digest_frequency | TEXT | hourly, daily, etc. |
| quiet_hours_start | TEXT | HH:MM |
| quiet_hours_end | TEXT | HH:MM |
| enabled | INTEGER | Boolean |

## Edge Cases

- Slack not configured: falls back to dashboard delivery
- Quiet hours: critical notifications still push through
- Duplicate detection: debounced queue deduplicates by title+category+target
- Old notifications: `cleanupOldNotifications()` removes delivered/dismissed after retention period
- Async/close race: `processQueue()` static method ensures DB stays open until async Slack delivery completes
- Digest delivery: batched items now progress to "delivered" status instead of being stuck

## Related

- `src/core/events.ts` - Events create notifications on completion
- `src/core/scheduler-daemon.ts` - Processes notification queue each poll cycle
- `src/integrations/slack/state.ts` - Slack bot_token for DM delivery
