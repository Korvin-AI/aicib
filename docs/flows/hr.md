# HR System

## Overview

Manage agent lifecycle: hiring, onboarding, reviews, promotions/demotions, improvement plans, and firing. Every action is recorded as an immutable HR event for audit.

## Dashboard

```bash
aicib hr
```

Shows: onboarding in progress, agents due for review, recent events, summary stats.

## Hiring & Onboarding

```bash
# Start onboarding (auto-created on hire via HR::HIRE marker)
aicib hr onboard cto --speed standard --mentor cfo

# Advance one phase (1→2→3→4)
aicib hr advance cto

# View onboarding status
aicib hr onboard cto
```

Phases: Research (restricted) → Mentored Introduction (guided) → Supervised Work (standard) → Full Autonomy (autonomous).

Ramp speeds: `instant` (skip to phase 4), `standard` (default), `extended`.

## Performance Reviews

```bash
# Create a review with scores (0-100)
aicib hr review cto --task 85 --quality 90 --efficiency 75 --collaboration 80

# With recommendation and summary
aicib hr review cto --task 85 --quality 90 --rec promote --summary "Excellent architecture decisions"

# List reviews
aicib hr reviews cto --limit 5
```

Score validation: non-numeric values (e.g., `--task abc`) are rejected with an error.

Recommendations: `maintain`, `promote`, `demote`, `improve`, `terminate`.

## Promotions & Demotions

```bash
# With explicit --from level
aicib hr promote cto --to autonomous --from standard

# Auto-resolve --from (checks latest promotion/demotion event, then onboarding phase)
aicib hr promote cto --to autonomous

# Demotion
aicib hr demote cto --to restricted --reason "Quality concerns"
```

If `--from` is omitted, the system resolves the current level from:
1. Latest promoted/demoted HR event's `to_level`
2. Onboarding completion phase autonomy level
3. `"unknown"` as last resort

## Improvement Plans

```bash
# Create plan with goals
aicib hr improve cto --goals "Improve code quality;Reduce review cycles" --deadline 2025-04-01

# View active plan
aicib hr improve cto

# Resolve a plan (validates plan belongs to the specified agent)
aicib hr improve cto --resolve 1 --outcome return_to_normal
```

Outcomes: `return_to_normal`, `reassign`, `reconfigure`, `terminate`.

## Agent State & Lifecycle

```bash
# Set state
aicib hr state cto --set paused --reason "Pending reconfig"

# View state
aicib hr state cto

# Fire an agent
# (Only via HR::FIRE marker in agent output)
```

States: `active`, `idle`, `paused`, `hibernated`, `stopped`, `archived`.

## Event History

```bash
# Full history for an agent
aicib hr history cto --limit 25

# All events (filtered)
aicib hr list --type promoted --agent cto --limit 10
```

## HR:: Markers (Agent-Driven)

Agents (typically the CEO) can trigger HR actions by including markers in their output:

```
HR::HIRE role=designer department=product mentor=cto
HR::ONBOARD_ADVANCE role=designer
HR::REVIEW role=cto task=85 quality=90 efficiency=80 collab=75 summary="Great work" rec=promote
HR::PROMOTE role=cto from=standard to=autonomous reason="Consistent excellence"
HR::DEMOTE role=cto from=autonomous to=standard reason="Quality regression"
HR::IMPROVE role=cto goals="goal1;goal2" deadline=2025-04-01
HR::STATE role=cto state=paused reason="Pending reconfig"
HR::FIRE role=cto reason="Persistent underperformance"
```

Natural language fallbacks (high-confidence only):
- `"hired agent <role>"` → auto-hire with department=general
- `"completed onboarding for <role>"` → completes all remaining phases

## What Can Go Wrong

- **Invalid score**: `--task abc` → "Error: Invalid score for --task: 'abc'. Must be a number."
- **Resolve wrong agent**: `hr improve cfo --resolve 1` when plan #1 belongs to cto → "Error: Plan #1 belongs to 'cto', not 'cfo'."
- **No active onboarding**: `hr advance unknown` → "Error: No active onboarding found for 'unknown'."
- **Duplicate improvement plan**: Creating a second active plan → "Agent 'cto' already has an active improvement plan (ID: 1)"
