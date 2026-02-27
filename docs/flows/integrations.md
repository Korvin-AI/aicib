# Integration Flows

## Adding a GitHub Integration

1. Set your GitHub token:
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ```

2. Add the integration:
   ```bash
   npx aicib integrations add github
   ```
   This creates the server config in `aicib.config.yaml` under `integrations.servers.github`.

3. Assign to agents by adding `mcp_servers` in config:
   ```yaml
   agents:
     cto:
       enabled: true
       model: opus
       mcp_servers: ["github"]
   ```

4. Verify:
   ```bash
   npx aicib integrations status
   ```

## Assigning Integrations to Agents

### Method 1: Inline agent config (recommended)

```yaml
agents:
  cto:
    mcp_servers: ["github", "linear"]
  cmo:
    mcp_servers: ["notion"]
```

Works for workers too:

```yaml
agents:
  cto:
    workers:
      - backend-engineer:
          mcp_servers: ["github"]
```

### Method 2: Per-agent map in integrations section

```yaml
integrations:
  per_agent:
    cto: ["github", "linear"]
    cmo: ["notion"]
```

Both methods are merged -- you can use either or both.

## Checking Integration Status

```bash
npx aicib integrations status
```

Shows:
- Whether the MCP framework is enabled
- Each configured server's status (configured, active, missing env)
- Usage counts and last-used timestamps (tracked automatically when agents use MCP tools)
- Error counts

## How Agents Use MCP Tools During Briefs

1. When `aicib start` or `aicib brief` runs, the agent-runner:
   - Calls `resolveAllMCPServers(config)` to get the union of all enabled agents' servers
   - Passes `mcpServers` to the SDK `query()` call at session level
   - Each sub-agent also gets its own `mcpServers` list via the SDK (per-agent enforcement)
   - Each sub-agent's prompt includes only their specific MCP tool list

2. During execution, agents can call MCP tools like:
   - `mcp__github__list_issues` -- list GitHub issues
   - `mcp__linear__create_issue` -- create a Linear issue
   - `mcp__notion__search` -- search Notion pages

3. The message handler tracks MCP tool usage automatically (updates `use_count` and `last_used` in the database).

## Removing an Integration

```bash
npx aicib integrations remove github
```

This removes the server from:
- `integrations.servers`
- All `integrations.per_agent` assignments
- `integrations.default_servers`
- All inline `agents.<role>.mcp_servers` assignments
- All worker-level `mcp_servers` assignments

## What Can Go Wrong

- **Missing env vars**: Server is skipped with a warning. Agent prompt won't list it. Fix: `export GITHUB_TOKEN=...`
- **Unknown server name in config**: Validation warns at config load. Fix: check spelling against `aicib integrations list`.
- **Disabled agent**: Its MCP servers won't start (saves resources). Enable the agent first.
