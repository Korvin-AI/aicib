# Engine Abstraction Layer & Model Router

## What It Does

Two modules that sit between AICIB's business logic and the Claude Agent SDK:

- **Engine abstraction** (`src/core/engine/`) — wraps the SDK behind a swappable interface so the rest of the codebase never imports the SDK directly. If we switch engines later, only the adapter file changes.
- **Model router** (`src/core/model-router.ts`) — maps model names ("opus" ↔ "claude-opus-4-6"), provides pricing tiers, and validates model names from config.

## How It Works

### Engine Layer

```
AICIB code
    ↓ imports
engine/index.ts  (barrel export + singleton factory)
    ↓ uses
engine/engine-interface.ts  (AgentEngine interface)
    ↓ implemented by
engine/sdk-adapter.ts  (ClaudeSDKEngine class)
    ↓ calls
@anthropic-ai/claude-agent-sdk
```

The singleton pattern:
- `getEngine()` — returns the active engine (creates `ClaudeSDKEngine` on first call)
- `setEngine(mock)` — replaces the engine (for testing or future swaps)
- `resetEngine()` — clears the singleton so next `getEngine()` creates a fresh default

### Type Aliases

`engine/types.ts` re-exports SDK types under AICIB-owned names:

| AICIB Type | SDK Type | Purpose |
|-----------|----------|---------|
| `EngineMessage` | `SDKMessage` | Any streamed message |
| `EngineResultMessage` | `SDKResultMessage` | Final result with cost data |
| `EngineSystemMessage` | `SDKSystemMessage` | System/init messages |
| `EngineModelUsage` | `ModelUsage` | Per-model token breakdown |
| `EngineAgentDefinition` | (custom) | Agent def with flexible `model` field |
| `EngineQueryOptions` | (custom) | Options for startSession/resumeSession |

The SDK's `AgentDefinition` restricts model to `'opus'|'sonnet'|'haiku'|'inherit'`. Our `EngineAgentDefinition` accepts any string — the SDK adapter converts back to short names via the model router before passing to `query()`.

### Model Router

Maintains a catalog of known models with short names, full IDs, tiers, and fallback pricing:

| Short Name | Full Model ID | Tier | Fallback Pricing (per M tokens) |
|-----------|---------------|------|--------------------------------|
| opus | claude-opus-4-6 | opus | $5 in / $25 out |
| sonnet | claude-sonnet-4-6 | sonnet | $3 in / $15 out |
| haiku | claude-haiku-4-5-20251001 | haiku | $1 in / $5 out |

Key functions:

| Function | Purpose |
|----------|---------|
| `resolveModelId(name)` | "opus" → "claude-opus-4-6", pass-through for full IDs |
| `toSDKShortName(id)` | "claude-opus-4-6" → "opus", prefix-match heuristic for unknown IDs |
| `getModelTier(id)` | Returns "opus" / "sonnet" / "haiku" tier for cost grouping |
| `getFallbackPricing(id)` | Per-million-token rates when SDK doesn't report cost |
| `isValidModelName(name)` | Validates config entries (known names + any "claude-" prefix) |
| `supportedShortNames()` | Returns ["opus", "sonnet", "haiku"] |

### Unknown Model Heuristic

When `toSDKShortName()` or `getModelTier()` encounters an ID not in the catalog:
1. Check if it starts with `"claude-opus"` → opus tier
2. Check if it starts with `"claude-haiku"` → haiku tier
3. Otherwise → sonnet tier (with `console.warn` in `toSDKShortName`)

Uses `startsWith()` prefix matching (not `includes()`) to avoid false positives on hypothetical compound model names.

## Key Files

- `src/core/engine/index.ts` — Barrel export + singleton factory (`getEngine`, `setEngine`, `resetEngine`)
- `src/core/engine/types.ts` — Type aliases (AICIB names → SDK types)
- `src/core/engine/engine-interface.ts` — `AgentEngine` interface definition
- `src/core/engine/sdk-adapter.ts` — `ClaudeSDKEngine` class implementing the interface
- `src/core/model-router.ts` — Model catalog, name resolution, pricing, validation

## Edge Cases

- **Unknown model in `toSDKShortName()`**: Falls back to "sonnet" with a `console.warn`. The SDK accepts any short name, so this is safe.
- **Unknown model in `getModelTier()`**: Falls back via prefix heuristic, then to "sonnet". No warning (called frequently in cost paths).
- **Unknown model in `getFallbackPricing()`**: Uses tier-based fallback → if tier is also unknown, returns sonnet-tier pricing ($3/$15).
- **`isValidModelName()` accepts future models**: Any string starting with "claude-" passes validation — future-proof but permissive.
- **`costUSD === 0` from SDK**: Treated as "SDK didn't report cost" rather than "free call". Falls back to estimated pricing from the model router. See comment in `agent-runner.ts:recordRunCosts()`.

## Related

- `docs/technical/agent-runner.md` — Uses the engine layer for all SDK calls
- `docs/flows/cost-and-budgets.md` — Uses model router for pricing
- `implementation/Research-Pi-vs-AgentSDK.md` — Decision to stay on SDK with abstraction layer
