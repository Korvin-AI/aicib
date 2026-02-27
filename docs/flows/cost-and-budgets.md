# Cost Tracking & Budget Alerts

## Overview

AICIB tracks every dollar your AI team spends and warns you before you hit your limits. Think of it like a company expense tracker — you can see who's spending what, and you get alerts when you're approaching your budget.

## Commands

### `aicib cost`

Shows a breakdown of how much each agent has cost.

**What you see:**
```
AI Company-in-a-Box — Cost Report

  Agent          | Input Tokens | Output Tokens | Cost (USD) | Calls
  ceo-opus       |       12,450 |         3,200 |    $1.4934 |     3
  ceo-haiku      |        2,100 |           450 |    $0.0089 |     1
  ─────────────────────────────────────────────────────────
  Total          |       14,550 |         3,650 |    $1.5023 |     4

  Spending Limits
  Today:  $1.50 / $50.00 (3.0%)    ████░░░░░░░░░░░░ [green]
  Month:  $8.23 / $500.00 (1.6%)   ██░░░░░░░░░░░░░░ [green]
```

**Options:**
- `aicib cost --history` — shows daily spending for the last 7 days
- `aicib cost --session <id>` — filter costs by a specific session

### Budget Alerts (automatic)

When you run `aicib brief`, the system checks your spending before sending the directive:

| Situation | What happens |
|-----------|-------------|
| Under 50% of daily/monthly limit | Proceeds normally |
| 50-80% of daily limit | Yellow warning: "Approaching daily limit ($25/$50, 50%)" |
| Over 80% of daily limit | Red warning: "Near daily limit ($42/$50, 84%)" |
| Daily limit reached | **Blocks the brief.** "Daily cost limit reached. Increase in config or wait until tomorrow." |
| Monthly limit reached | **Blocks the brief.** "Monthly cost limit reached." |

Budget limits are set in `aicib.config.yaml`:
```yaml
settings:
  cost_limit_daily: 50
  cost_limit_monthly: 500
```

### `aicib status` (cost section)

The status command also shows agent costs in its dashboard alongside the org chart and background job status.

## Assigning Different Models to Control Cost

You can assign cheaper models to less important agents to save money. See [Choosing AI Models for Your Team](model-assignment.md) for a full guide on which model to give each agent.

## How Costs Are Tracked

- Every SDK call records input tokens, output tokens, and cost per model
- When the SDK provides per-model usage (e.g., CEO used Opus + Haiku for journal), each model gets its own cost entry
- Costs are stored in SQLite per agent, per session, per model
- Daily and monthly totals are computed from these records

## Color Coding

Costs use traffic-light colors throughout the interface:
- **Green** — under 50% of limit (safe)
- **Yellow** — 50-80% of limit (watch it)
- **Red** — over 80% of limit (close to cutoff)

Agent names in cost tables use the same colors as their terminal output (CEO = magenta, CTO = blue, etc.).

## What Can Go Wrong

- **"N/A" in percentage column** → The spending limit is set to 0 or the cost data is corrupted. Check your config file.
- **Unknown model warning in console** → A new Claude model was used that the system doesn't recognize. Costs are still recorded but may use the wrong pricing tier. Update AICIB to fix.

## Technical Notes

- Cost data lives in the `costs` table in SQLite (`.aicib/state.db`)
- `getCostHistory(days)` aggregates daily totals for the history view
- `formatPercent()` guards against NaN/Infinity/negative values — returns "N/A" instead of garbage
- Per-model cost breakdown uses the SDK's `modelUsage` field when available
