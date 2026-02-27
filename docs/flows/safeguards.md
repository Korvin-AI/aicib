# External Safeguards

## Overview

External safeguards require agents to get approval before taking actions outside the system (posting to social media, deploying code, sending emails, making financial commitments). Each action category has its own approval chain. Trust levels can shorten chains for reliable agents.

## CLI Commands

### Dashboard

```bash
aicib safeguards
```

Shows all 7 category rules, their approval chains, auto-execute status, and pending action counts.

### Pending Actions

```bash
aicib safeguards pending
```

Lists all actions awaiting approval with ID, agent, category, description, current step, and who needs to approve next.

### Approve

```bash
aicib safeguards approve <id>
```

Advances the approval chain by one step. If this was the final step, the action is fully approved.

### Reject

```bash
aicib safeguards reject <id> --reason "Too risky"
```

Rejects the action. Reason is optional but recommended.

### History

```bash
aicib safeguards history
```

Shows the last 50 resolved actions (approved/rejected) with outcomes and dates.

## Trust Evolution CLI

### Dashboard

```bash
aicib trust
```

Shows trust level thresholds, current agent trust levels per category, and any manual overrides.

### Agent History

```bash
aicib trust history <agent>
aicib trust history cto --category code_deployment
```

Shows detailed action history for a specific agent, optionally filtered by category.

### Upgrade Recommendations

```bash
aicib trust recommendations
```

Shows agents that meet 2 of 3 criteria for the next trust level — candidates for manual upgrade.

### Manual Override

```bash
aicib trust set cto --category code_deployment --level trusted
```

Manually sets a trust level override for an agent+category pair. Saved to config.

## How It Works

1. Agent outputs `SAFEGUARD::REQUEST category=code_deployment agent=cto description="Deploy v2.1 to staging"`
2. System creates a pending action with the category's approval chain
3. CEO (or CLI user) approves/rejects each step
4. Approved actions are recorded in history for trust scoring
5. Over time, agents with high approval rates get shorter chains

## What Can Go Wrong

- **Action expired** -> Actions expire after 48 hours (configurable). Run `aicib safeguards pending` to see what's waiting.
- **Max pending reached** -> Each agent can have at most 10 pending actions. Older actions must be resolved first.
- **Trust not advancing** -> Check thresholds with `aicib trust`. Agents need minimum actions, approval rate, AND age. Use `aicib trust set` for manual overrides.
