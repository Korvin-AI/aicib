# Communication Routing Rules

## Overview

Configurable rules that control how agents communicate across departments. The CEO's system prompt includes the active routing policy so agents follow the correct communication paths. Four modes: strict hierarchy, open with CC, fully open, and custom per-department-pair rules.

## File Structure

```
src/core/
  routing.ts              # Types, validation, route evaluation, context formatting
  routing-register.ts     # Side-effect registration (config + context provider + message handler)

src/cli/
  routing.ts              # CLI command: `aicib routing`
```

## Integration Pattern

Same hook pattern as tasks, knowledge, and intelligence features:

1. **Side-effect import** in `index.ts` and `background-worker.ts` loads `routing-register.ts`
2. Register.ts calls `registerConfigExtension()` for the `routing:` config section
3. Register.ts calls `registerContextProvider()` for `communication-routing` — injects routing policy into CEO's prompt
4. Register.ts calls `registerMessageHandler()` for `routing-monitor` — detects ROUTE:: markers and logs violations

**Core files NOT modified:** `agent-runner.ts`, `config.ts`, `cost-tracker.ts`

## Routing Modes

| Mode | Behavior |
|------|----------|
| `strict_hierarchy` | Cross-dept communication only through department heads or CEO. Workers blocked from direct cross-dept messaging. |
| `open_cc_manager` | Anyone can message anyone, but department heads are CC'd on cross-dept messages. **Default mode.** |
| `open` | No restrictions. |
| `custom` | Per-department-pair overrides with `open_cc_manager` as fallback for unmatched pairs. |

## Route Evaluation

`evaluateRoute(fromRole, fromDept, toRole, toDept, config)` returns:
- `allowed: boolean` — whether the message is permitted
- `requiresCC: string[]` — department heads to CC (empty if not applicable)
- `violation?: string` — human-readable violation description

Same-department messages and messages involving agents without a department are always allowed.

## Department Head Mapping

```typescript
const DEPARTMENT_HEADS = {
  engineering: "cto",
  finance: "cfo",
  marketing: "cmo",
};
```

This duplicates the mapping in `task-manager.ts` and `review-chains.ts`. Known tech debt — not worth extracting for v1.

## Agent Message Markers

### Structured ROUTE:: Markers

```
ROUTE::SEND from=developer to=marketer message="Need copy for landing page"
ROUTE::CC agent=cto message="Engineering update"
```

### Natural Language Detection

The message handler also detects patterns like "sending to marketer" or "messaging cfo" and evaluates them against routing rules. Assumes CEO as sender in NL context.

## Config

```yaml
routing:
  enabled: true                    # Turn routing on/off
  mode: open_cc_manager            # strict_hierarchy | open_cc_manager | open | custom
  log_violations: true             # Log violations and CC notifications via console.warn
  custom_rules:                    # Only used when mode is "custom"
    - from_department: engineering
      to_department: marketing
      mode: strict_hierarchy
```

Custom rules cannot use `mode: "custom"` — must be a concrete mode.

## Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `evaluateRoute()` | routing.ts | Evaluate if a message route is allowed |
| `resolveEffectiveMode()` | routing.ts | Resolve mode for a dept pair (handles custom rules) |
| `validateRoutingConfig()` | routing.ts | Config validation for the `routing:` section |
| `formatRoutingContext()` | routing.ts | Format policy as prompt text for CEO |

## Related Docs

- `docs/flows/routing.md` — User guide for routing CLI
- `docs/technical/agent-runner.md` — Hook system and context providers
- `docs/technical/review-chains.md` — Review chain system
- `docs/edge-cases.md` — Routing edge cases
