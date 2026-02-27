# External Safeguards & Trust Evolution

## Overview

Category-based approval chains for external agent actions (social media posts, code deployments, financial transactions, etc.). Trust evolution tracks agent reliability over time and progressively shortens approval chains for proven agents.

## File Structure

```
src/core/
  safeguards.ts               # Types, defaults, validation, evaluation, context formatting
  trust-evolution.ts          # Trust levels, scoring, recommendations, autonomy cap
  safeguards-register.ts      # Side-effect registration (config, tables, providers, handler)

src/cli/
  safeguards.ts               # CLI: aicib safeguards (dashboard, pending, approve, reject, history)
  trust.ts                    # CLI: aicib trust (dashboard, history, recommendations, set)
```

## Integration Pattern

1. **Side-effect import** in `index.ts` and `background-worker.ts` loads `safeguards-register.ts`
2. Register.ts calls `registerConfigExtension()` for both `safeguards:` and `trust:` sections
3. Register.ts calls `registerTable()` for `safeguard_pending` and `external_actions`
4. Register.ts calls `registerContextProvider()` for `external-safeguards` and `trust-evolution`
5. Register.ts calls `registerMessageHandler()` for `safeguard-actions` (detects SAFEGUARD:: markers)

## Database Tables

### safeguard_pending

Tracks actions awaiting approval through their chain.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| agent_role | TEXT | Agent that requested the action |
| category | TEXT | Action category (social_media, code_deployment, etc.) |
| description | TEXT | Human-readable description |
| approval_chain | TEXT | JSON array of `{ role, qualifier? }` |
| current_step | INTEGER | Index into approval_chain |
| status | TEXT | pending, approved, rejected, expired, auto_approved |
| approvals | TEXT | JSON array of `{ role, approved_at }` |
| rejection | TEXT | JSON `{ rejected_by, reason, rejected_at }` |
| created_at | TEXT | SQLite datetime |
| resolved_at | TEXT | When approved/rejected/expired |
| expires_at | TEXT | SQLite-format datetime for auto-expiry |

### external_actions

Historical record of all resolved actions (for trust scoring).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| agent_role | TEXT | Agent role |
| category | TEXT | Action category |
| description | TEXT | Action description |
| outcome | TEXT | approved or rejected |
| approved_by | TEXT | Who approved (null if rejected) |
| rejected_by | TEXT | Who rejected (null if approved) |
| rejection_reason | TEXT | Reason for rejection |
| created_at | TEXT | SQLite datetime |
| resolved_at | TEXT | When resolved |

## Action Categories

Seven categories with default approval chains:

| Category | Default Chain | Auto-Execute |
|----------|--------------|-------------|
| social_media | CMO | Yes |
| customer_email | department_head | Yes |
| marketing_email | CMO -> owner | Yes |
| code_deployment | CTO -> owner (production) | No |
| financial_transaction | CFO -> owner | No |
| public_content | department_head -> CMO -> owner | Yes |
| internal_tool_change | CTO -> owner | No |

`department_head` is resolved at runtime to the agent's department head (engineering->CTO, finance->CFO, marketing->CMO).

## Trust Levels

Four levels with escalating thresholds:

| Level | Min Actions | Min Approval % | Min Age (days) |
|-------|------------|----------------|---------------|
| probationary | 0 | 0% | 0 |
| established | 10 | 85% | 14 |
| trusted | 30 | 92% | 60 |
| veteran | 100 | 97% | 180 |

### Chain Modifications by Trust Level

- **probationary/established**: No modifications
- **trusted**: Skip first chain step for social_media, customer_email
- **veteran**: Skip first step for social_media, customer_email, public_content. Auto-approve social_media, customer_email, public_content (if auto_execute enabled)

### Autonomy Cap

Agents at restricted/guided autonomy levels are capped at `established` trust, preventing trust-based chain shortening from bypassing autonomy controls.

## Message Handler

Parses agent output for structured markers and natural language patterns.

### Structured SAFEGUARD:: Markers

```
SAFEGUARD::REQUEST category=<cat> agent=<role> description="<desc>"
SAFEGUARD::APPROVE id=<id> [by=<role>]
SAFEGUARD::REJECT id=<id> [by=<role>] [reason="<reason>"]
```

### Natural Language Fallback

```
requesting approval for social_media     → request (agent: ceo)
approved external action #5              → approve (by: ceo)
rejected external action #5              → reject (by: ceo)
```

### Debounced Queue

Actions are queued with a 500ms debounce timer. Before processing, deduplication by `(id/category:agent, type)` prevents double-processing from overlapping marker matches.

## Config

```yaml
safeguards:
  enabled: true
  action_expiry_hours: 48
  max_pending_per_agent: 10
  categories:
    social_media:
      approval_chain: [{ role: cmo }]
      auto_execute: true

trust:
  enabled: true
  max_level: veteran
  auto_recommend: true
  overrides:
    cto:
      code_deployment: trusted
```

## Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `evaluateSafeguardAction()` | safeguards.ts | Evaluate chain with trust modifications |
| `resolveApprover()` | safeguards.ts | Map department_head to concrete role |
| `resolveCategoryRule()` | safeguards.ts | Merge config overrides with defaults |
| `formatSafeguardsContext()` | safeguards.ts | Format pending actions for CEO prompt |
| `resolveTrustLevel()` | trust-evolution.ts | Compute effective trust (override -> history -> cap) |
| `computeTrustScore()` | trust-evolution.ts | Score from external_actions history |
| `getTrustRecommendations()` | trust-evolution.ts | Find agents ready for upgrade (2/3 criteria met) |
| `recordExternalAction()` | trust-evolution.ts | Record action outcome for trust tracking |
| `formatTrustContext()` | trust-evolution.ts | Format trust levels for CEO prompt |

## Related Docs

- `docs/flows/safeguards.md` — User guide for safeguards CLI
- `docs/technical/communication-routing.md` — Routing system (same phase)
- `docs/technical/review-chains.md` — Review chains (same phase)
- `docs/edge-cases.md` — Safeguard/trust edge cases
