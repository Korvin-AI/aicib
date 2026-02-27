# Reporting Suite

The Reporting Suite generates automated reports (CEO daily briefings, weekly department performance, monthly financial, sprint reviews, marketing reports) that run on schedules and collect cross-system metrics.

## Quick Start

```bash
# View available report templates
aicib report templates

# Generate a report immediately
aicib report generate daily_briefing

# List all reports
aicib report list

# Show a specific report
aicib report show 1

# Schedule a recurring report
aicib report schedule daily_briefing --cron "0 9 * * 1-5"

# Dashboard overview
aicib report
```

## Report Types

| Type | Agent | Default Schedule | Description |
|------|-------|-----------------|-------------|
| `daily_briefing` | CEO | Weekdays 9AM | Morning summary of activity, costs, tasks |
| `weekly_department` | CEO | Monday 10AM | Cross-department performance review |
| `monthly_financial` | CFO | 1st of month 9AM | Cost analysis and spending trends |
| `sprint_review` | CTO | Friday 2PM | Engineering sprint summary |
| `marketing_report` | CMO | Monday 10AM | Marketing activity and campaign progress |
| `custom` | any | manual | User-defined report |

## Agent Markers

Agents can generate reports using structured markers:

```
REPORT::GENERATE type=daily_briefing [title="Custom Title"]
REPORT::COMPLETE id=42
REPORT::SCHEDULE type=weekly_department cron="0 10 * * 1"
```

When `REPORT::COMPLETE id=N` is emitted, the system captures the full agent message as report content (stripping the marker itself). The report ID in the directive is injected automatically during generation, so agents emit the correct ID.

## Metrics Collected

Reports automatically collect:
- **Costs**: Today's spend, monthly total, per-agent breakdown, 7-day history
- **Tasks**: Total count, by-status breakdown, recently completed tasks
- **Reviews**: Latest HR performance reviews with scores
- **Journal**: Recent CEO journal entries

## Configuration

In `aicib.config.yaml`:

```yaml
reporting:
  enabled: true
  max_context_reports: 5
  default_delivery: file
  reports_dir: .aicib/reports
  auto_schedule: true
```

## Workflow

1. **Manual**: Run `aicib report generate <type>` to collect metrics and create a report
2. **Scheduled**: Create a schedule with `aicib report schedule <type> --cron "..."` for recurring reports
3. **Agent-driven**: Agents emit `REPORT::GENERATE` markers during conversations to trigger report creation
