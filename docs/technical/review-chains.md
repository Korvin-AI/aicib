# Review Chain Configuration

## Overview

Multi-layer quality control for agent deliverables. Different task types get different review chains (e.g., internal docs = self-review, marketing for publishing = self + peer + department head + owner). Chain state is tracked via task comments — no new DB tables.

## File Structure

```
src/core/
  review-chains.ts              # Chain resolution, reviewer resolution, state tracking, advancement
  review-chains-register.ts     # Side-effect registration (context provider + message handler)

src/cli/
  reviews.ts                    # CLI command: `aicib reviews`
```

## Integration Pattern

1. **Side-effect import** in `index.ts` and `background-worker.ts` loads `review-chains-register.ts`
2. Register.ts calls `registerContextProvider()` for `review-chains` — injects chain status into CEO's prompt
3. Register.ts calls `registerMessageHandler()` for `review-chain-actions` — detects REVIEW:: markers

No config extension registered — review chains use the existing `tasks:` config section. Validation for `review_chain_overrides` is added to `task-register.ts`.

**Core files modified:** `task-manager.ts` (added `review_chain_overrides` to `TasksConfig`)

## Review Layers

Five layer types, resolved in order:

| Layer | Reviewer | Skip behavior |
|-------|----------|---------------|
| `self` | Task assignee | Skipped if no assignee |
| `peer` | Another agent in the same department (excludes assignee + CEO) | Skipped if solo in department |
| `department_head` | CTO/CFO/CMO based on task department | Skipped if department unknown |
| `csuite` | Always "ceo" | Never skipped |
| `owner` | Always "human-founder" | Never skipped |

## Chain Type Inference

`inferChainType(title)` matches task title keywords against `TYPE_KEYWORDS` using first-match-wins. Categories with multi-word phrases are checked first to avoid broad single words (like "implement") stealing matches from specific phrases (like "marketing plan").

**Match order:** marketing_internal → marketing_external → financial_report → strategic_plan → customer_facing → code

Fallback: `internal_document` (chain: `["self"]`).

## Chain State Tracking (Comment-Based)

No new DB tables. Chain progress is derived from task comments:

1. **CHAIN_START_MARKER** — Written when a review chain starts/restarts. Scopes approval counting to prevent stale approvals from prior rejection cycles carrying over.
2. **review_result comments** — "Approved" or "Rejected: ..." comments track layer completion.
3. **getReviewChainState()** — Counts approvals after the most recent chain start marker, determines current layer index.

Comments are sorted by `created_at ASC, id ASC` for deterministic ordering when multiple comments share the same second-precision timestamp.

## Chain Lifecycle

### Submit (REVIEW::SUBMIT)
1. Resolve chain type from task title
2. Write CHAIN_START_MARKER comment
3. Skip layers with no available reviewer (log as comment)
4. If no reviewer available for ANY layer → auto-complete (set status: "done")
5. Otherwise → set status: "in_review", assign first reviewer

### Approve (REVIEW::APPROVE)
1. Record "Approved" as review_result comment
2. Re-derive state from comments
3. If chain complete → mark task as done
4. Otherwise → find next reviewer (skip unavailable layers), assign

### Reject (REVIEW::REJECT)
1. Record "Rejected: ..." as review_result comment
2. Set task back to in_progress
3. Assignee must fix and re-submit (new CHAIN_START_MARKER resets approval counting)

## Deduplication

Actions are queued with a 500ms debounce (same pattern as task-register.ts). Before processing, `flushPendingActions()` deduplicates by `(task_id, type)` — keeps only the first action per task per type per batch. This prevents duplicate REVIEW::APPROVE markers (or overlapping NL patterns like "approved task #5") from double-advancing a chain.

## Agent Message Markers

### Structured REVIEW:: Markers

```
REVIEW::SUBMIT task_id=5 chain_type=code
REVIEW::APPROVE task_id=5
REVIEW::REJECT task_id=5 feedback="Missing error handling"
```

### Natural Language Fallback

```
self-review complete task #5        → approve
approved task #5                    → approve
needs revision on task #5           → reject
```

## Config

Review chains are configured under the `tasks:` section:

```yaml
tasks:
  default_review_chains:
    code: [self, peer]
    marketing_internal: [self, department_head]
    marketing_external: [self, peer, department_head, owner]
    financial_report: [self, peer, csuite]
    customer_facing: [self, department_head, owner]
    strategic_plan: [department_head, csuite, owner]
    internal_document: [self]
  review_chain_overrides:
    engineering:
      code: [self, peer, department_head]   # Override: add dept head for engineering code
```

## Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `resolveReviewChain()` | review-chains.ts | Determine chain for a task (overrides → defaults → infer → fallback) |
| `inferChainType()` | review-chains.ts | Keyword-based type inference from task title |
| `resolveReviewerForLayer()` | review-chains.ts | Map a layer to a specific reviewer role |
| `getReviewChainState()` | review-chains.ts | Derive chain progress from comments |
| `advanceReviewChain()` | review-chains.ts | Process approve/reject and move chain forward |
| `formatReviewChainContext()` | review-chains.ts | Format chain status for CEO prompt |
| `validateReviewChainOverrides()` | review-chains.ts | Validate overrides config structure |

## Related Docs

- `docs/flows/tasks.md` — User guide for tasks (review chains integrate with tasks)
- `docs/technical/task-management.md` — Task system architecture
- `docs/technical/communication-routing.md` — Routing system
- `docs/edge-cases.md` — Review chain edge cases
