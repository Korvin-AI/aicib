# Agent Persona Studio

## Overview

Give each AI agent a unique identity — display name, personality archetype, behavioral traits, and professional background. Changes take effect on the next `aicib start` or `aicib brief`.

## How It Works

### During Init

1. Run `aicib init --name "MyStartup"`
2. Choose a global personality preset (professional, startup, technical, creative)
3. Optionally customize individual agents:
   - Set display names (e.g., "Sarah" for CEO)
   - Pick role presets (e.g., "the-visionary" for CEO)
4. Config saved to `aicib.config.yaml`

### Customizing Later

Run `aicib agent customize ceo` (or any role). Interactive wizard lets you:

- **Set display name** — appears in the agent's `# Title` heading
- **Choose role preset** — pre-built personality archetype
- **Configure traits** — communication style, decision making, risk tolerance, assertiveness (1-5), creativity (1-5), conflict approach
- **Set background** — years of experience, industries, specializations, work history summary

Each change saves immediately to `aicib.config.yaml`.

### Viewing Agent Persona

- `aicib agent` — dashboard table of all agents with persona info
- `aicib agent show ceo` — full detail view with compiled preview

### Editing Soul Files Directly

`aicib agent edit ceo` opens the soul.md in your editor (`$VISUAL` or `$EDITOR`). Validates the file after save.

Editors with arguments work fine (e.g., `EDITOR="code --wait"`).

## Available Role Presets

| Role | Presets |
|------|---------|
| CEO | The Visionary, The Operator, The Diplomat, The Disruptor |
| CTO | The Architect, The Pragmatist, The Innovator |
| CFO | The Strategist, The Controller, The Growth-Oriented |
| CMO | The Growth Hacker, The Brand Builder, The Performance Marketer |

Workers (Backend Engineer, Frontend Engineer, etc.) also have presets.

## What Can Go Wrong

- **Preset file missing** — Warning printed, agent runs without that preset. Not a fatal error.
- **Invalid trait value in YAML** — Config validation rejects it with a clear message.
- **Non-object traits** (e.g., `traits: "direct"`) — Rejected with "traits must be an object".
- **Editor fails to open** — Error message shown. File unchanged.

## Config Example

```yaml
persona:
  preset: startup
  agents:
    ceo:
      display_name: "Sarah"
      role_preset: the-visionary
      traits:
        communication_style: direct
        assertiveness: 4
      background:
        years_experience: 15
        industry_experience: [fintech, saas]
    cto:
      display_name: "Marcus"
      role_preset: the-architect
      traits:
        communication_style: analytical
        risk_tolerance: moderate
```
