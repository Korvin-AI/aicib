# MCP Integration Framework

## Overview

The MCP Integration Framework connects AICIB agents to external tools (GitHub, Linear, Notion, Slack, etc.) via the Model Context Protocol (MCP). Each agent can be assigned specific MCP servers, and the framework handles resolution, environment variable management, prompt injection, and per-agent SDK enforcement.

## Architecture

### Resolution Flow

```
aicib.config.yaml             Agent config (inline)
       |                              |
       v                              v
  integrations:                  mcp_servers:
    servers: {...}                 - github
    per_agent:                    - linear
      cto: [github, linear]
       |                              |
       +----------+-------------------+
                  v
         mcp.ts: resolveMCPServersForRole(role, config)
                  |
                  v
         Merged list of server names per agent
                  |
                  v
         Resolve names -> MCPServerConfig
         (command, args, env with ${VAR} expansion)
                  |
                  v
         agent-runner.ts: pass to engine as mcpServers
         (session-level union + per-agent SDK restriction)
```

### Per-Agent Access Control (Two Layers)

1. **SDK-level enforcement**: Each sub-agent's `mcpServers` field lists only its authorized servers. The SDK restricts tool availability per agent.
2. **Prompt injection**: Each agent's prompt includes only their authorized MCP servers, so agents know what tools they have.

Both layers are built from the same resolved server list in `buildSubagentMap()`. The agent-runner resolves MCP servers once per role, then uses the result for both the SDK field and the prompt context.

### Resolution Safety

- `resolveServer()` — resolves a server name to `MCPServerConfig`. Emits `console.warn` for skipped servers (missing env vars, unknown name). Used at resolution entry points.
- `canResolveServer()` — side-effect-free check. Returns true/false without warnings. Used for filtering and display logic (e.g., `formatMCPContextForRole`).

This prevents duplicate warnings when the same server name is checked for prompt context and then resolved for the session.

### Disabled Agent Handling

`resolveAllMCPServers()` skips agents with `enabled: false`. This prevents MCP server processes from starting for disabled agents.

## Type Safety

### `getMCPConfig()` Type Guard

All access to the MCP config section goes through `getMCPConfig(config)` instead of manual `config.extensions?.integrations as MCPIntegrationsConfig` casts:

```typescript
export function getMCPConfig(config: AicibConfig): MCPIntegrationsConfig | undefined {
  const raw = config.extensions?.integrations;
  if (!raw || typeof raw !== "object") return undefined;
  return raw as MCPIntegrationsConfig;
}
```

Used in: `mcp.ts`, `mcp-register.ts`, `integrations.ts` (CLI).

## Config Schema

### `integrations:` section in `aicib.config.yaml`

```yaml
integrations:
  enabled: true                    # Master switch
  composio:                        # Composio unified gateway (future)
    enabled: false
    api_key: ""
  servers:                         # Explicitly configured servers
    github:
      command: "npx"
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_TOKEN: "${GITHUB_TOKEN}"
      description: "GitHub"
      category: "development"
  per_agent:                       # Per-agent server assignments
    cto: ["github", "linear"]
    ceo: ["notion"]
  default_servers: []              # Fallback for agents with no assignment
```

### Inline agent config

```yaml
agents:
  cto:
    enabled: true
    model: opus
    mcp_servers: ["github", "linear"]
```

Both `integrations.per_agent` and `agents.<role>.mcp_servers` are merged.

### Config Validation

`validateMCPConfig()` validates:
- Type correctness of all fields
- Server definitions have required `command` + `args`
- **Server name references** in `per_agent` and `default_servers` are validated against known servers (configured + built-in catalog). Typos like "githb" are caught at config load time.

## Built-in Server Catalog

| Server | Category | Description | Required Env | Version |
|--------|----------|-------------|--------------|---------|
| github | development | GitHub -- code, issues, PRs | GITHUB_TOKEN | latest |
| linear | project-management | Linear -- issues, cycles | LINEAR_API_KEY | latest |
| notion | knowledge | Notion -- docs, wikis | NOTION_TOKEN | latest |
| playwright | automation | Playwright -- browser automation | (none) | 0.0.68 |
| slack-mcp | communication | Slack -- messaging | SLACK_BOT_TOKEN | latest |
| stripe | finance | Stripe -- payments | STRIPE_SECRET_KEY | latest |

## Environment Variables

Server configs use `${VAR}` patterns that resolve to `process.env[VAR]` at runtime.

Resolution order in `resolveServer()`:
1. Check for missing env vars first (via `findMissingEnvVars`)
2. If missing, skip server with warning and return `null`
3. Only then resolve `${VAR}` patterns to actual values

This prevents passing empty strings as tokens to MCP servers.

## How MCP Tools Appear in Agent Prompts

Each agent receives a section in their prompt (built by `formatMCPContextFromNames()`):

```
## Your MCP Tools (External Integrations)

You have access to the following external tools via MCP servers.
Use them by calling tools prefixed with `mcp__<server>__`.

- **github** (development): GitHub -- code, issues, PRs, repos
- **linear** (project-management): Linear -- project management, issues, cycles
```

Only servers that can actually resolve are listed (filtered via `canResolveServer()`).

The CEO also gets an overview (via `formatMCPOverview()`) showing which agents have which integrations.

## Database Tracking

### Schema

The `mcp_integrations` table tracks runtime usage:

```sql
CREATE TABLE mcp_integrations (
  server_name TEXT PRIMARY KEY,
  status TEXT DEFAULT 'configured',
  last_used TEXT,
  use_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_error TEXT,
  added_at TEXT DEFAULT (datetime('now'))
);
```

### How Tracking Works

1. The message handler (`mcp-usage-tracker` in `mcp-register.ts`) watches for assistant messages containing `tool_use` blocks with names starting with `mcp__`.
2. Extracts server name: `mcp__github__list_issues` -> `github`.
3. Calls `upsertMCPUsage(projectDir, serverName)` which uses `CostTracker.runOnRegisteredTable()` to INSERT or UPDATE the row.
4. The `lastProjectDir` pattern (module-level variable set by context provider, read by message handler) bridges the gap between handler and DB.

DB access uses `CostTracker.queryRegisteredTable<T>()` and `runOnRegisteredTable()` — public methods added to avoid unsafe private field casts.

## CLI Commands

| Command | Description |
|---------|-------------|
| `aicib integrations list` | Shows configured servers (with agent assignments including workers) and available built-in servers |
| `aicib integrations add <server>` | Adds a server from the built-in catalog |
| `aicib integrations remove <server>` | Removes a server from config, per_agent, default_servers, AND all inline agent/worker assignments |
| `aicib integrations status` | Shows runtime status with usage stats (use count, last used, errors) |

## Key Files

| File | Purpose |
|------|---------|
| `src/core/mcp.ts` | Types, catalog, resolution, formatting, config helpers, type guard, DB helpers |
| `src/core/mcp-register.ts` | Side-effect registrations (config, DB, context, message handler with usage tracking) |
| `src/cli/integrations.ts` | CLI commands (list with worker iteration, add, remove, status) |
| `src/core/engine/types.ts` | `MCPServerConfig` type, `mcpServers` on `EngineAgentDefinition`, engine options |
| `src/core/engine/sdk-adapter.ts` | Passes `mcpServers` through to SDK per-agent and session-level |
| `src/core/agent-runner.ts` | Resolves MCP servers, builds per-agent prompt + SDK fields |
| `src/core/config.ts` | `mcp_servers` on `AgentConfig` and `WorkerConfig` interfaces |
| `src/core/cost-tracker.ts` | `queryRegisteredTable<T>()` and `runOnRegisteredTable()` for safe DB access |
