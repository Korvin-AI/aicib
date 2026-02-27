# Persona System

## What It Does

Two-tier agent personality system:

1. **Global Presets** — company-wide communication tone with per-agent overrides
2. **Agent Persona Studio** — per-agent display names, role archetypes, personality traits, and professional backgrounds

## Tier 1: Global Presets

### Preset Files

Four presets live in each template's `presets/` directory:

| Preset | Style |
|--------|-------|
| `professional` | Formal, data-driven, structured |
| `startup` | Fast, informal, bias-to-action |
| `technical` | Precise, terse, spec-like |
| `creative` | Storytelling, metaphors, expressive |

Each preset is a Markdown file with YAML frontmatter:
```yaml
---
name: startup
display_name: Startup Culture
description: Fast-moving and informal
---
## Style Guidelines
- Use first names...
```

### Config

```yaml
persona:
  preset: professional        # applies to all agents
  overrides:
    cmo: creative             # CMO gets a different style
    cto: technical            # CTO gets a different style
```

## Tier 2: Agent Persona Studio

### Four Layers

Applied in order during agent loading:

1. **Role Preset** — archetype .md file with behavioral instructions (e.g., "the-visionary" for CEO)
2. **Personality Traits** — 6 configurable dimensions compiled to natural language
3. **Professional Background** — years of experience, industries, specialized knowledge, work history
4. **Display Name** — modifies the `# Title` heading (e.g., `# Sarah — Chief Executive Officer (CEO)`)

### Role Presets

25 archetype files across 8 roles in `templates/saas-startup/presets/roles/`:

| Role | Presets |
|------|---------|
| CEO | the-visionary, the-operator, the-diplomat, the-disruptor |
| CTO | the-architect, the-pragmatist, the-innovator |
| CFO | the-strategist, the-controller, the-growth-oriented |
| CMO | the-growth-hacker, the-brand-builder, the-performance-marketer |
| Backend Engineer | the-craftsman, the-systems-thinker, the-pragmatist |
| Frontend Engineer | the-pixel-perfectionist, the-ux-advocate |
| Financial Analyst | the-modeler, the-advisor |
| Content Writer | the-storyteller, the-data-journalist, the-brand-voice |

Each preset is a Markdown file with YAML frontmatter (`name`, `display_name`, `description`) and behavioral content.

### Personality Traits

Six dimensions, each compiled to a 1-2 sentence behavioral instruction:

| Dimension | Values |
|-----------|--------|
| `communication_style` | direct, diplomatic, analytical, creative |
| `decision_making` | data-driven, intuitive, collaborative |
| `risk_tolerance` | conservative, moderate, aggressive |
| `assertiveness` | 1-5 (deferential → dominant) |
| `creativity` | 1-5 (conventional → unconventional) |
| `conflict_approach` | confrontational, collaborative, avoidant |

### Config

```yaml
persona:
  preset: professional
  agents:
    ceo:
      display_name: "Sarah"
      role_preset: the-visionary
      traits:
        communication_style: direct
        decision_making: data-driven
        assertiveness: 4
        creativity: 3
      background:
        years_experience: 15
        industry_experience: [fintech, saas]
        specialized_knowledge: [product-strategy, go-to-market]
        work_history: "Former VP Product at a Series B fintech startup"
```

### Application Flow

```
aicib.config.yaml
   → persona.preset + overrides (Tier 1)
   → persona.agents (Tier 2)
              ↓
loadPersonaFromConfig(config)
   → loads global presets + overrides
   → passes agentPersonas + templateDir
              ↓
loadAgentDefinitions(agentsDir, preset, overrides, agentPersonas, templateDir)
   → for each agent:
        1. applyPresetToContent()        → global tone
        2. applyPersonaStudio()          → 4-layer persona
           a. loadRolePreset()           → appends "## Role Archetype"
           b. compileTraits()            → appends "## Personality Calibration"
           c. compileBackground()        → appends "## Professional Background"
           d. applyDisplayName()         → modifies "# Title" heading
              ↓
buildSubagentMap() → SDK AgentDefinition objects with fully-personalized prompts
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `aicib agent` | Dashboard — all agents with persona summary |
| `aicib agent list` | Table view of all agents |
| `aicib agent show <role>` | Full persona detail + compiled preview |
| `aicib agent edit <role>` | Open soul.md in `$VISUAL`/`$EDITOR` |
| `aicib agent customize [role]` | Interactive wizard for display name, role preset, traits, background |

### Validation

- `role_preset` must be a valid slug (`/^[a-z][a-z0-9-]*$/`). Actual file existence checked at load time.
- `traits` must be an object (scalars like `traits: "direct"` are rejected).
- Trait enum values validated against constant arrays.
- `assertiveness` and `creativity` must be integers 1-5.
- `background` fields validated: `years_experience` is number, arrays are arrays, strings are strings.
- `loadRolePreset()` throws clear error if file not found. `listRolePresets()` warns and skips invalid files.

## Key Files

- `src/core/persona.ts` — types (`PersonalityTraits`, `AgentPersonaConfig`, `RolePreset`), constants, `loadPreset()`, `validateAgentPersona()`
- `src/core/persona-studio.ts` — `loadRolePreset()`, `listRolePresets()`, `compileTraits()`, `compileBackground()`, `applyDisplayName()`, `applyPersonaStudio()`
- `src/core/agents.ts` — `loadAgentDefinitions()` applies both preset overlays and persona studio layers
- `src/core/agent-runner.ts` — `loadPersonaFromConfig()` bridges config to both systems
- `src/core/config.ts` — full validation for `persona.agents` section
- `src/cli/agent.ts` — `agentDashboardCommand`, `agentListCommand`, `agentShowCommand`, `agentEditCommand`, `agentCustomizeCommand`
- `src/cli/init.ts` — interactive persona customization during project setup
- `src/cli/config.ts` — "Customize agent persona (studio)" menu option
- `src/index.ts` — `aicib agent` command registration
- `src/templates/saas-startup/presets/roles/` — 25 role preset .md files

## Related

- Linear: COM-8
- Agent soul.md files: `src/templates/saas-startup/agents/*.md`
- Global preset files: `src/templates/saas-startup/presets/*.md`
- Role preset files: `src/templates/saas-startup/presets/roles/<role>/*.md`
