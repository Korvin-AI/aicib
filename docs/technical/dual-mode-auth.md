# Dual-Mode Engine Authentication

## What It Does

Adds a switchable authentication mode to AICIB: users choose between **Claude Code subscription** (free, uses their existing login) and **Anthropic API key** (pay-per-use, enter their own key). The mode is stored in `aicib.config.yaml` and respected by all agent execution paths (start, brief, background jobs, Slack, journal generation).

## How It Works

### Engine Mode Flow

```
User selects mode during init or config
    ↓
aicib.config.yaml stores engine.mode + optional engine.api_key
    ↓
assertEngineReady(config) — CLI guard, fails fast before SDK calls
    ↓
resolveApiKey(config) — returns key or undefined
    ↓
resolveEngineEnv(config) — builds env override for SDK subprocess
    ↓
SDK receives env: { ...process.env, ANTHROPIC_API_KEY: key }
    or env: undefined (inherits process.env as-is)
```

### Two Modes

| Mode | Config Value | Auth Source | Who Pays | When to Use |
|------|-------------|------------|----------|-------------|
| **Claude Code** | `claude-code` (default) | OAuth via Claude Code login | Subscription | Development, personal use |
| **Claude API** | `claude-api` | `engine.api_key` in config or `ANTHROPIC_API_KEY` env var | Per-token API billing | Production, cloud, CI/CD |

### Config YAML

```yaml
# Default (subscription) — engine section omitted entirely
company:
  name: "My Startup"

# API key mode — engine section present
company:
  name: "My Startup"
engine:
  mode: claude-api
  api_key: "sk-ant-api03-..."   # optional if env var is set
```

The `saveConfig()` function omits the `engine` section when mode is `claude-code` with no key — keeps config clean for the default case.

## Key Functions

All in `src/core/config.ts`:

| Function | Purpose |
|----------|---------|
| `resolveApiKey(config)` | Returns API key string or `undefined`. Checks config first, then `process.env.ANTHROPIC_API_KEY`. Returns `undefined` for `claude-code` mode. |
| `maskApiKey(key)` | Masks key for display: `"sk-ant-...xxxx"` (shows last 4 chars). Short keys get `"sk-ant-...****"`. |
| `validateApiKeyFormat(key)` | Returns `true` or an error message string. Checks non-empty and `sk-ant-` prefix. Used in all 3 validation locations (config validator, settings wizard, init wizard). |
| `assertEngineReady(config)` | CLI guard — calls `process.exit(1)` with a helpful error if mode is `claude-api` but no key is available. Used in `start.ts` and `brief.ts`. |
| `resolveEngineEnv(config)` | Builds the `env` object for SDK subprocess. Returns `undefined` in subscription mode (SDK inherits `process.env`). In API mode, copies full `process.env` + overrides `ANTHROPIC_API_KEY`. |

### Why `resolveEngineEnv` Copies Full `process.env`

The Agent SDK's `env` parameter **replaces** the subprocess environment entirely — it does not merge with `process.env`. When `env` is omitted, the subprocess inherits `process.env` as its default. But when `env` IS provided, the subprocess gets ONLY what's in that object.

This means we must copy everything (`PATH`, `HOME`, `SHELL`, etc.) and then add/override `ANTHROPIC_API_KEY`. Without the copy, the subprocess would lack basic environment variables and fail to execute.

## Validation Strategy

API key format is validated in 3 places, all using the centralized `validateApiKeyFormat()`:

1. **`validateConfig()`** — at config load time, surfaces errors for malformed keys. Missing keys are a warning, not an error (user may set env var later).
2. **Settings wizard** (`src/cli/config.ts`) — `inquirer` validate callback for "enter key" prompt. Env var path validates before accepting.
3. **Init wizard** (`src/cli/init.ts`) — `inquirer` validate callback during first-time setup.

The hard guard is `assertEngineReady()` at runtime — called in `start.ts` and `brief.ts` before any SDK call.

## Execution Paths

Every path that calls the Agent SDK now passes `resolveEngineEnv(config)`:

| Path | File | How |
|------|------|-----|
| `aicib start` | `agent-runner.ts:startCEOSession()` | `env` option in `startSession()` |
| `aicib brief` (foreground) | `agent-runner.ts:sendBrief()` | `env` option in `resumeSession()` |
| `aicib brief --background` | `background-worker.ts` | Passes config to `sendBrief()` |
| `aicib brief --project` | `background-worker.ts` | Passes config through project planner |
| Journal generation | `agent-runner.ts:generateJournalEntry()` | `env` option in `resumeSession()` (Haiku call) |
| Slack brief | `message-bridge.ts` | Passes config to `sendBrief()` |

## Security

- **`.gitignore`**: `aicib.config.yaml` is gitignored to prevent accidental API key commits.
- **Config warning**: After entering a key via CLI, the user sees: "The API key is stored in aicib.config.yaml. Ensure this file is in .gitignore."
- **Masking**: API keys are never displayed in full — always masked via `maskApiKey()`.
- **Env vars**: When using `ANTHROPIC_API_KEY` env var, the key is never written to disk.
- **Web UI**: The settings page shows only the masked key (via `EngineConfigSnapshot.maskedKey`). The full key never reaches the browser.

## Web UI Integration

The UI reads engine config via `ui/lib/config-read.ts:parseEngine()`. It produces an `EngineConfigSnapshot`:

```typescript
interface EngineConfigSnapshot {
  mode: "claude-code" | "claude-api";
  hasApiKey: boolean;
  maskedKey?: string;  // "sk-ant-...xxxx" — never the real key
}
```

The masking logic is duplicated in `config-read.ts` (can't import from CLI core due to Turbopack `.js` extension issues). A sync comment marks the location.

## Key Files

- `src/core/config.ts` — `EngineConfig` type, `resolveApiKey`, `maskApiKey`, `validateApiKeyFormat`, `assertEngineReady`, `resolveEngineEnv`, engine validation in `validateConfig()`
- `src/core/agent-runner.ts` — `resolveEngineEnv(config)` called in `startCEOSession()`, `sendBrief()`, `generateJournalEntry()`
- `src/cli/start.ts` — `assertEngineReady()` guard + engine mode display
- `src/cli/brief.ts` — `assertEngineReady()` guard
- `src/cli/config.ts` — Settings wizard "Engine mode" menu option
- `src/cli/init.ts` — Auth mode selection during first-time setup
- `src/core/background-worker.ts` — Passes config through to `sendBrief()` and `generateJournalEntry()`
- `src/integrations/slack/message-bridge.ts` — Passes config through to `sendBrief()` and `generateJournalEntry()`
- `ui/lib/config-read.ts` — `parseEngine()` for UI display
- `ui/app/(dashboard)/settings/page.tsx` — Engine mode display on settings page
- `ui/app/api/settings/route.ts` — Engine snapshot in API response
- `.gitignore` — Includes `aicib.config.yaml`

## Edge Cases

- **No engine section in YAML**: Defaults to `{ mode: "claude-code" }`. No key needed.
- **`claude-api` mode with no key**: Warning at config load time (not an error — user may set env var later). Hard error at runtime via `assertEngineReady()`.
- **Invalid key format**: `validateApiKeyFormat()` rejects keys that don't start with `sk-ant-`. The settings wizard re-prompts; the init wizard re-prompts; `validateConfig()` throws.
- **Env var key + config key**: Config key takes precedence (checked first in `resolveApiKey()`).
- **Switching modes**: `saveConfig()` strips the engine section when switching back to `claude-code`, keeping the YAML clean.
- **Background workers**: Background processes inherit the config that was active when the job was dispatched. If the user changes engine mode mid-job, the running job continues with the original mode.

## Related

- `docs/technical/engine-abstraction.md` — The engine interface that this auth system feeds into
- `docs/flows/start-brief-stop.md` — User-facing flow that triggers engine auth
- `docs/technical/slack-integration.md` — Slack brief path that uses engine auth
