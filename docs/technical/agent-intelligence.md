# Agent Intelligence Architecture

## Overview

Three features that make agent behavior structured, configurable, and consistent:

1. **Autonomy Matrix (#5)** — 5 levels governing what agents decide alone vs. escalate
2. **Escalation Protocol (#24)** — up-to-6-step chain for handling errors and blockers
3. **Skills System (#3)** — 14 built-in capabilities with prompt templates and tool requirements

All three are **prompt-based**: structured rules are injected into the CEO's system prompt via context providers. No runtime enforcement — agents follow the injected rules as part of their instructions.

## File Structure

```
src/core/
  autonomy-matrix.ts          # Autonomy levels, profiles, resolution, formatting
  escalation.ts               # Escalation chains, org-based routing, DB helpers
  skills.ts                   # 14 built-in skills, resolution, default mappings
  intelligence-register.ts    # Side-effect registration (config + DB + context)
```

## Integration Pattern

Follows the same hook pattern as the Slack integration:

1. **Side-effect import** in `index.ts` loads `intelligence-register.ts`
2. Register.ts calls `registerConfigExtension()` for 3 config sections
3. Register.ts calls `registerTable()` for `escalation_events` table
4. Register.ts calls `registerContextProvider()` for 3 context providers
5. Context providers fire during `gatherExtensionContext()` in `startCEOSession()` and `sendBrief()`

**Core files NOT modified:** `agent-runner.ts`, `config.ts`, `cost-tracker.ts`

## Feature 1: Autonomy Matrix

### Levels

| Level | Description | Typical Agents |
|-------|-------------|----------------|
| `restricted` | Must get approval for nearly all actions | New/untested agents |
| `guided` | Acts within clear parameters, escalates ambiguity | Workers (engineers, analyst, writer) |
| `standard` | Independent on routine work, escalates significant items | Default for all agents |
| `autonomous` | Most decisions independent, escalates strategic items | C-suite (CTO, CFO, CMO) |
| `full` | CEO-level, escalates only to human founder | CEO |

### Categories

Each level defines rules across 4 categories:
- **file_operations** — what file actions the agent can take
- **decisions** — what choices the agent can make independently
- **communication** — who the agent can communicate with
- **spending** — what financial commitments the agent can make

### Resolution Priority

Effective autonomy level is resolved in this order:
1. Config override (`autonomy.overrides.<role>.level`)
2. Frontmatter field (`autonomy_level` in soul.md)
3. Config default (`autonomy.default_level`)
4. Fallback: `"standard"`

### Config

```yaml
autonomy:
  enabled: true                # Set false to disable autonomy context injection
  default_level: standard      # Default for agents without explicit level
  overrides:                   # Per-agent overrides
    cto:
      level: autonomous
      grant:                   # Additional autonomous permissions
        - "Approve minor dependency additions"
      restrict:                # Always-escalate items
        - "Database schema changes"
```

## Feature 2: Escalation Protocol

### Up-to-6-Step Chain

1. **RETRY** — Try again with a different approach (up to `max_retries`)
2. **PEER** — Ask a colleague at the same level
3. **MANAGER** — Escalate to direct manager (`reports_to`)
4. **DEPARTMENT_HEAD** — Escalate to the C-suite head of the department
5. **CEO** — Cross-department escalation
6. **HUMAN_FOUNDER** — Requires human intervention

### Dynamic Chain Building

Chains are built from the org structure at runtime using `reports_to` and `department` fields:

- **Backend Engineer**: retry → frontend-engineer (peer) → CTO (manager) → CEO → human
- **CTO**: retry → CEO (manager) → human
- **CEO**: retry → human

Steps are skipped when they don't apply (e.g., CEO skips the "ceo" step).

### Escalation Format

Agents are instructed to use this format when escalating:

```
ESCALATION [Step N: step_name] from [role] to [target_role]
Priority: [low|medium|high|critical]
Category: [area]
Issue: [what went wrong]
Attempted: [what was tried]
Need: [what is needed]
```

### Database Table

```sql
escalation_events (
  id, session_id, from_agent, to_agent, step, priority,
  category, reason, resolved, resolution, created_at, resolved_at
)
```

Indexed on: `session_id`, `from_agent`, `resolved`, `created_at`

### SQL Helpers

`getRecentEscalationsSQL(limit)` returns a `{ sql, params }` tuple with parameterized LIMIT (not string interpolation). These are utilities for long task chains — not called in current code but ready for future use.

### Config

```yaml
escalation:
  enabled: true
  max_retries: 2
  track_events: true
  chain_overrides: {}          # Per-agent custom chains
```

## Feature 3: Skills System

### Built-in Skills (14)

| Domain | Skills |
|--------|--------|
| Engineering | `code_review`, `architecture_design`, `api_development`, `frontend_development`, `testing` |
| Finance | `financial_modeling`, `market_analysis`, `budget_tracking` |
| Marketing | `content_strategy`, `copywriting`, `seo_optimization` |
| Cross-functional | `project_planning`, `stakeholder_reporting`, `research` |

### Skill Definition Structure

Each skill includes:
- `name` — unique identifier
- `description` — human-readable summary
- `prompt_template` — behavioral guidance injected into prompts
- `required_tools` — tools the agent needs for this skill
- `knowledge_domains` — areas of expertise
- `typical_roles` — which agents usually have this skill

### Resolution Priority

1. Frontmatter `skills:` array (if present, even empty)
2. Default role → skills mapping (if frontmatter has no `skills:` field)
3. Config overrides (`skills.overrides.<role>.add/remove`)

### Config

```yaml
skills:
  enabled: true
  custom:                      # User-defined skills
    competitor_research:
      description: "Deep-dive competitor analysis"
      prompt_template: |
        When analyzing competitors:
        - Create feature comparison matrix
        - Compare pricing tiers
  overrides:                   # Per-agent skill adjustments
    cmo:
      add:
        - competitor_research
```

## Feature Interactions

1. **Autonomy level determines escalation frequency**: Restricted agents have more "requires_escalation" items, triggering the escalation chain more often.
2. **Skills inform autonomy scope**: Skills define what an agent CAN do; autonomy defines what they MAY do without asking.
3. **Escalation chain uses org structure**: The same `reports_to`/`department` fields that define the org chart determine the escalation path.
4. **Context providers are additive**: All three fire independently during `gatherExtensionContext()`, building on each other in the CEO's prompt.

## Frontmatter Fields

Added to `AgentFrontmatter` in `agents.ts`:

```typescript
autonomy_level?: string;      // AutonomyLevel value
skills?: string[];             // Skill name references
escalation_priority?: string;  // EscalationPriority value — reserved for future use
```

**Note:** `escalation_priority` is present in frontmatter but not yet wired into code. It will be used as the default priority when recording escalation events in a future release.

Compatible with the existing simple YAML frontmatter parser (flat scalars and string arrays).

## Context Provider Scope

Context providers fire only for the **CEO prompt** (in `startCEOSession` and `sendBrief`). Subagents rely on their soul.md prose for behavioral guidance. The structured data gives the CEO better delegation awareness — knowing which agents are equipped for which work and at what autonomy level.
