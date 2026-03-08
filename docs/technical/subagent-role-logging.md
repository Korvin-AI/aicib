# Subagent Role Logging Fix

## What Was Fixed

Non-CEO agents (CTO, CFO, CMO, etc.) showed "No recent activity" in the Web UI's agent panel. The CEO panel worked fine.

**Root cause:** When agent messages were logged to the `background_logs` database table, ALL non-CEO agents were given the generic role `"subagent"` instead of their actual role name (`cto`, `cfo`, `cmo`). The UI filters logs by `agent_role` — so it matched `"ceo"` for the CEO but `"subagent" !== "cto"` for everyone else.

## Where the Bug Existed

Two files write messages to `background_logs`, and both had the same hard-coded logic:

```typescript
// Both files had this:
role = msg.parent_tool_use_id ? "subagent" : "ceo";
```

- `src/core/background-worker.ts` — background brief execution
- `src/cli/brief.ts` — foreground brief execution

## How the Fix Works

### Background Worker (`background-worker.ts`)

The `activeSubagents` map (populated by `trackSubagentStatus()`) already tracks `tool_use_id -> agent role name`. When the CEO delegates via the Task tool, the map gets populated:

1. CEO sends assistant message with Task tool_use block (`id="xyz"`, `input.subagent_type="cto"`)
2. `trackSubagentStatus()` runs -> `activeSubagents.set("xyz", "cto")`
3. Subagent responds with `parent_tool_use_id="xyz"` -> `activeSubagents.get("xyz")` returns `"cto"`

The fix also moved `trackSubagentStatus()` to run **before** the role lookup, so the map is always populated before it's read.

```typescript
role = msg.parent_tool_use_id
  ? (activeSubagents.get(msg.parent_tool_use_id) || "subagent")
  : "ceo";
```

### Foreground Brief (`brief.ts`)

`brief.ts` didn't have a subagent tracking map. A local `toolUseToRole` map was added, populated from Task tool_use blocks in assistant messages using the same pattern as `trackSubagentStatus()`:

```typescript
const toolUseToRole = new Map<string, string>();

// Inside callback — populate map from Task delegations
if (msg.type === "assistant" && msg.message?.content) {
  for (const block of msg.message.content) {
    // Extract subagent_type or agent_name from Task tool_use blocks
    // and map: tool_use_id -> role name
  }
}

// Then resolve role
role = msg.parent_tool_use_id
  ? (toolUseToRole.get(msg.parent_tool_use_id) || "subagent")
  : "ceo";
```

### UI Panel (`ui/components/agent-panel.tsx`)

The panel previously used the `logs` prop, which was pre-filtered from a global 20-entry feed. It now prefers `insights.recentLogs` from the per-agent API endpoint (`/api/agents/[role]`), which queries the database directly for that agent's role. This is more reliable and not limited by the global 20-entry cap.

### Database Index (`cost-tracker.ts`)

Added a composite index on `background_logs(agent_role, id DESC)` to support the per-agent log query efficiently:

```sql
CREATE INDEX IF NOT EXISTS idx_bg_logs_agent ON background_logs(agent_role, id DESC);
```

## Files Changed

| File | Change |
|------|--------|
| `src/core/background-worker.ts` | Resolve role from `activeSubagents` map; moved `trackSubagentStatus()` before role lookup |
| `src/cli/brief.ts` | Added `toolUseToRole` map populated from Task blocks; resolve role from map |
| `ui/components/agent-panel.tsx` | Added `recentLogs` to `AgentInsights`; prefer per-agent API logs for activity display |
| `src/core/cost-tracker.ts` | Added `idx_bg_logs_agent` index on `(agent_role, id DESC)` |

## Note on Existing Data

Old log entries still have `"subagent"` as the role. Only new runs write correct roles. A one-time SQL update can fix historical data if desired:

```sql
UPDATE background_logs SET agent_role = 'cto' WHERE content LIKE '%CTO%' AND agent_role = 'subagent';
UPDATE background_logs SET agent_role = 'cfo' WHERE content LIKE '%CFO%' AND agent_role = 'subagent';
UPDATE background_logs SET agent_role = 'cmo' WHERE content LIKE '%CMO%' AND agent_role = 'subagent';
```

This is approximate and optional — the fix applies to all future runs automatically.
