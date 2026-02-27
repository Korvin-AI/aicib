# Routing — Communication Rules for Your AI Team

## Overview

Communication routing controls how agents talk to each other across departments — like an office communication policy. You choose a mode, and agents follow the rules when delegating, messaging, or collaborating.

## Quick Start

```bash
aicib routing              # See current routing config and department roster
```

## Modes

| Mode | What it means |
|------|--------------|
| **open_cc_manager** | Anyone can message anyone, but department heads get CC'd on cross-department messages. **This is the default.** |
| **strict_hierarchy** | Cross-department talk only through department heads. A developer can't message a marketer directly — has to go through the CTO. |
| **open** | No restrictions. Everyone talks to everyone. |
| **custom** | You set rules per department pair. |

## Config

In your `aicib.config.yaml`:

```yaml
routing:
  enabled: true
  mode: open_cc_manager       # or: strict_hierarchy, open, custom
  log_violations: true         # Log when agents break routing rules
  custom_rules:                # Only used when mode is "custom"
    - from_department: engineering
      to_department: marketing
      mode: strict_hierarchy   # Engineering → Marketing must go through dept heads
    - from_department: marketing
      to_department: finance
      mode: open               # Marketing → Finance is unrestricted
```

## What `aicib routing` Shows

- **Settings table:** Enabled status, mode, violation logging, number of custom rules
- **Custom rules table:** Per-department-pair overrides (if mode is "custom")
- **Department roster:** Which agents belong to which department
- **Active policy text:** The exact text injected into the CEO's prompt

## How It Works

1. The routing policy is injected into the CEO's system prompt
2. When the CEO delegates tasks or routes messages, it follows the policy
3. If an agent outputs `ROUTE::SEND` or `ROUTE::CC` markers, the system evaluates the route
4. Violations are logged via `console.warn` (visible in `aicib logs`)

## What Can Go Wrong

- **Agents without a department** — routing rules don't apply. By design — agents need a `department` in their frontmatter.
- **Unknown department** — under strict_hierarchy, agents in departments without a known head can't route cross-dept. CEO always can.
- **Violations logged but not blocked** — routing is advisory. The CEO's system prompt tells agents to follow the rules, but there's no hard enforcement. This matches how real company policies work.

## Related

- `docs/technical/communication-routing.md` — Technical architecture
- `docs/edge-cases.md` — Edge cases
