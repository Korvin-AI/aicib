# Cache Visibility & Accurate Cost Estimates

## What It Does

Makes prompt caching savings visible throughout AICIB. The Claude Agent SDK already performs prompt caching automatically and reports `cacheReadInputTokens` and `cacheCreationInputTokens` in its `ModelUsage` type — but AICIB previously ignored these fields. Users were already paying less than the raw token math suggested, but couldn't see the savings.

This feature:
- Tracks cache read/creation tokens in the database
- Shows estimated savings in the CLI cost report and after each brief
- Displays a "Saved by Caching" card on the web UI costs page
- Adds cache savings to the home dashboard context panel
- Replaces missing cost estimates in the setup wizard with dynamic model-aware estimates

## Schema Changes

### Migration (idempotent)

Two new columns added to `cost_entries` via `ALTER TABLE` in `CostTracker.init()`:

```sql
ALTER TABLE cost_entries ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cost_entries ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0;
```

Wrapped in try-catch — SQLite throws if columns already exist. Existing rows default to 0 (correct, since no cache data was tracked before).

### Updated Interface

```typescript
export interface CostEntry {
  // ... existing fields ...
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

export interface CacheSavings {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedSavingsUsd: number;
}
```

## New Methods on CostTracker

| Method | Returns | Purpose |
|--------|---------|---------|
| `getCacheSavingsToday()` | `CacheSavings` | Sum of cache tokens + estimated USD saved today |
| `getCacheSavingsThisMonth()` | `CacheSavings` | Same for current month |
| `getCacheSavingsAllTime()` | `CacheSavings` | Same for all time |
| `getAverageBriefCost(limit?)` | `number \| null` | Average `total_cost_usd` from recent completed foreground jobs |

### Savings Formula

```
estimatedSavingsUsd = (cacheReadTokens / 1_000_000) * inputRate * 0.9
```

Uses Sonnet's input rate ($3/MTok) as a conservative default. The 0.9 factor represents the 90% discount for cache reads vs full-price input tokens.

**Note:** This is an approximation. Opus-heavy workloads would have higher actual savings; Haiku-heavy workloads would have lower. All display labels include "~" or "(est.)" to communicate this.

### Cost Calculation Update

`recordCost()` (the fallback path when SDK doesn't report `costUSD`) now includes the 25% cache write premium:

```typescript
const cost =
  (inputTokens / 1_000_000) * rates.input +
  (outputTokens / 1_000_000) * rates.output +
  (cacheCreationTokens / 1_000_000) * rates.input * 0.25;
```

## Data Flow

```
SDK ModelUsage
  └─ cacheReadInputTokens, cacheCreationInputTokens
       └─ agent-runner.ts:recordRunCosts()
            └─ costTracker.recordCost() / recordCostWithActual()
                 └─ cost_entries table (cache_read_tokens, cache_creation_tokens)
                      ├─ CLI: aicib cost  →  Cache Savings section
                      ├─ CLI: aicib brief →  savings hint after each run
                      ├─ API: /api/costs  →  cacheSavings + averageBriefCost
                      ├─ API: /api/status →  cacheSavingsMonth
                      └─ UI:  /costs page, context panel, setup wizard
```

## Files Modified

| File | Changes |
|------|---------|
| `src/core/cost-tracker.ts` | Schema migration, CostEntry + CacheSavings interfaces, updated recordCost/recordCostWithActual, 4 new query methods |
| `src/core/agent-runner.ts` | Extract cache tokens from SDK ModelUsage in recordRunCosts() |
| `src/cli/cost.ts` | Display Cache Savings section + average brief cost |
| `src/cli/brief.ts` | Show avg cost + cache savings hint after each foreground brief |
| `ui/app/api/costs/route.ts` | cacheSavings + averageBriefCost in response, columnExists helper with table whitelist |
| `ui/app/api/status/route.ts` | cacheSavingsMonth in status response |
| `ui/app/(dashboard)/costs/page.tsx` | "Saved by Caching (est.)" StatCard, cache_read_tokens column in table, cache columns in CSV export |
| `ui/components/home/context-panel.tsx` | "Cache savings: ~$X.XX this month" line in Cost Snapshot |
| `ui/components/setup/step-launch.tsx` | estimateBriefCost() function with model-aware estimates in launch summary |

## Security

- `columnExists()` in the costs API route uses a `ALLOWED_TABLES` whitelist before interpolating table names into `PRAGMA table_info()` — prevents SQL injection even though currently only called with hardcoded strings.

## What's Not Included (Deferred)

- **Per-model cache rate tracking** — Would require storing the model ID alongside cache tokens. Current approach uses Sonnet rate as approximation.
- **Batch API** — Requires SDK investigation, deferred to Phase 4.
- **Context window management** — Phase 4.
