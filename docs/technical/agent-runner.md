# Agent Runner — Claude Agent SDK Integration

## What It Does

The agent runner (`src/core/agent-runner.ts`) is the core engine that connects AICIB to Claude's AI via the official Claude Agent SDK. It replaces the old approach of spawning `claude --print` as a child process.

It handles: creating CEO sessions, defining C-suite subagents, sending briefs, streaming responses, and extracting cost data.

## How It Works

### Session Lifecycle

```
aicib start
  → startCEOSession() creates new SDK session
  → CEO agent initialized with system prompt from soul.md
  → C-suite (CTO, CMO, CFO) registered as subagents
  → Session ID saved to SQLite for later resume
  → CEO introduces itself, confirms team structure

aicib brief "directive"
  → sendBrief() resumes existing session via SDK session ID
  → Directive formatted and sent to CEO
  → CEO delegates to subagents via Task tool
  → Subagents produce deliverables
  → Cost recorded to database

aicib stop
  → Session marked as ended in database
  → SDK session data cleared
```

### Soul.md to SDK Mapping

The agent runner reads soul.md files (via `agents.ts`) and converts them to SDK `AgentDefinition` objects:

| Soul.md Field | SDK Field | Notes |
|--------------|-----------|-------|
| `content` (markdown body) | `prompt` | Agent's full personality/instructions |
| `frontmatter.title` | `description` | Used in agent description string |
| `frontmatter.tools` | `tools` | Filtered — `SendMessage` and `TeamCreate` removed (don't exist in SDK) |
| `frontmatter.model` | `model` | Config.yaml overrides soul.md default |

Only C-suite agents (where `reports_to === "ceo"`) become direct subagents. Workers (backend-engineer, content-writer, etc.) are spawned by department heads during execution.

### Key Functions

| Function | Purpose |
|----------|---------|
| `buildSubagentMap(projectDir, config)` | Reads soul.md files, filters to C-suite, builds SDK agent definitions |
| `startCEOSession(projectDir, config, onMessage?)` | Creates new CEO session with subagents, loads journal context, streams messages |
| `sendBrief(sdkSessionId, directive, projectDir, config, onMessage?)` | Resumes session, sends directive, streams responses |
| `generateJournalEntry(sdkSessionId, directive, result, ...)` | Resumes CEO session with Haiku, generates 3-5 sentence summary, saves to DB |
| `recordRunCosts(result, costTracker, sessionId, agentRole, model)` | Saves per-model token usage and cost to SQLite |
| `loadPersonaFromConfig(config)` | Loads persona preset + per-agent overrides from config |
| `formatMessagePlain(message)` | Converts SDK messages to uncolored terminal strings |

### Persona Integration

`buildSubagentMap()` and `startCEOSession()` load persona data via `loadPersonaFromConfig()`:
1. Reads `config.persona.preset` (default: `professional`)
2. Loads the preset from the template's `presets/` directory
3. Loads any per-agent overrides from `config.persona.overrides`
4. Passes both to `loadAgentDefinitions()`, which appends tone guidelines to each agent's prompt

See `docs/technical/persona-system.md` for full details.

### Journal / CEO Memory

`startCEOSession()` loads recent journal entries into the CEO's context:
1. Opens a CostTracker, calls `getRecentJournalEntries(10)`
2. Formats entries as Markdown via `formatJournalForContext()`
3. Trims to 5 entries if text exceeds ~6000 chars (~3000 tokens)
4. Appends as `## Recent Session History` block to CEO's system prompt
5. Always closes the CostTracker in a `finally` block (prevents DB connection leaks)
6. Logs a warning if journal loading fails (never blocks session startup)

After each brief, `generateJournalEntry()` resumes the CEO session with the Haiku model (cheapest), asks for a summary, and saves it. Uses `permissionMode: "bypassPermissions"` with `tools: []` (no dangerous permissions needed).

See `docs/technical/journal-and-output.md` for full details.

### Hook System

The agent runner exposes two extension points for future features to plug in without editing `agent-runner.ts`:

| Registry | Registration Function | What It Does |
|----------|----------------------|-------------|
| Context Providers | `registerContextProvider(name, fn)` | Inject text into CEO/agent prompts (e.g., active task list) |
| Message Handlers | `registerMessageHandler(name, fn)` | Tap into every SDK message as it streams (e.g., Slack bridge) |

Both are called at module load time. Context providers run during `startCEOSession()` and `sendBrief()`. Message handlers run after every streamed message.

**Guards:**
- Duplicate name → throws `Error` (prevents double-registration if a module is imported twice)
- Handler errors → logged as warnings via `console.warn`, never break the main flow
- Context provider errors → same warning pattern

The config system (`config.ts`) has a parallel extension registry:

| Registry | Registration Function | What It Does |
|----------|----------------------|-------------|
| Config Extensions | `registerConfigExtension({ key, defaults, validate? })` | Add a new top-level YAML section with defaults and validation |

**Guards:**
- Reserved keys (`company`, `agents`, `settings`, `persona`) → throws `Error`
- Duplicate key → throws `Error`
- Partial YAML values → shallow-merged with defaults (e.g., `{ level: 'high' }` merged with `{ enabled: true, level: 'medium' }` → `{ enabled: true, level: 'high' }`)
- Unknown top-level YAML keys → preserved in `extensions` for round-trip safety (not silently dropped on save)

The cost tracker (`cost-tracker.ts`) has a table registry:

| Registry | Registration Function | What It Does |
|----------|----------------------|-------------|
| Table Registry | `registerTable({ name, createSQL, indexes? })` | Register a new SQLite table created during `CostTracker.init()` |

**Guard:** Duplicate table name → throws `Error`

### Subagent Working Directory Fix

The SDK's `AgentDefinition` type does not support a `cwd` field — subagents inherit the parent's `cwd` from the session options. However, this inheritance is inconsistent: some subagents (especially those spawned in parallel or after the first) may fall back to `process.cwd()` instead.

**Fix:** Both `startCEOSession()` and `sendBrief()` inject the absolute project directory into the CEO's prompt:
- `startCEOSession()` appends a `## Working Directory` section to the CEO's system prompt
- `sendBrief()` appends a `REMINDER` line to each brief prompt

This instructs the CEO to tell all department heads to use absolute paths when saving files, bypassing the SDK's unreliable cwd propagation.

### SDK Configuration

The CEO session is configured with:
- `systemPrompt`: Claude Code preset + CEO soul.md content + persona overlay + journal context + **working directory instruction** appended
- `tools`: Claude Code preset (full tool access)
- `agents`: C-suite subagents built from soul.md files with persona overlays
- `permissionMode`: `bypassPermissions` (agents work autonomously)
- `maxBudgetUsd`: Daily cost limit from config
- `maxTurns`: 500 for CEO sessions, 200 for sub-agents — prevents premature session termination while budget limit acts as the real cost safety net

### Session Persistence

Sessions are persisted via SQLite so `brief` can resume a session started by `start`:

1. `start` calls `startCEOSession()` → gets SDK session ID
2. SDK session ID saved to `session_data` table via `costTracker.saveSDKSessionId()`
3. `brief` calls `costTracker.getActiveSDKSessionId()` → retrieves SDK session ID
4. `brief` calls `sendBrief()` with `resume: sdkSessionId`

## Background Mode

The agent runner's `sendBrief()` function is also used by the background worker process (`background-worker.ts`). In background mode:

1. `brief.ts` checks for stale jobs (PID dead but status still `running`) and auto-heals them before proceeding
2. `brief.ts` calls `startBackgroundBrief()` in `background-manager.ts`
3. The manager creates a `background_jobs` DB record (including the directive text) and spawns a detached child process with only `jobId`, `projectDir`, and `sdkSessionId` as args
4. The worker reads its directive from the `background_jobs` DB row (avoids OS arg-length limits and `ps aux` leakage)
5. The worker calls `sendBrief()` with an `onMessage` callback that writes to `background_logs` instead of the console
6. Costs are recorded using the job's own `session_id` (immutable on the DB row) — not `getActiveSession()`, which can return null if the session ends while the worker is finishing
7. On completion/error, the worker updates the job record and exits
8. `killBackgroundJob()` re-reads the job status before overwriting — if the worker already marked it `completed`, the kill does not clobber it to `failed`

This means `sendBrief()` and `formatMessage()` are shared between foreground and background execution — the only difference is where the output goes (console vs. database).

### Foreground Log Persistence (S6)

Foreground briefs now also save every message to the database via `costTracker.logBackgroundMessage()`, using a "foreground job" record created by `costTracker.createForegroundJob()`. This makes `aicib logs` work for both foreground and background sessions. Foreground jobs are identified by a `[foreground]` prefix on their directive in the `background_jobs` table.

### Agent Status Tracking (S6)

Both foreground (`brief.ts`) and background (`background-worker.ts`) paths now track agent status in real-time:
1. CEO set to "working" when brief starts
2. Sub-agent statuses updated via `task_notification` messages from the SDK
3. CEO set to "idle" on completion, "error" on failure
4. `aicib status` reads runtime statuses from the `agent_status` table and shows working/idle/error/stopped instead of enabled/disabled

## Key Files

- `src/core/agent-runner.ts` — The SDK bridge (this module)
- `src/core/engine/` — Engine abstraction layer (see `docs/technical/engine-abstraction.md`)
- `src/core/model-router.ts` — Model catalog, name resolution, pricing tiers
- `src/core/cost-tracker.ts` — SQLite persistence (sessions, costs, session_data, background_jobs, background_logs, ceo_journal tables)
- `src/core/persona.ts` — Persona preset loading and application
- `src/core/output-formatter.ts` — Color-coded message formatting (`formatMessageWithColor`)
- `src/core/org-chart.ts` — Unicode org chart builder and renderer
- `src/core/background-worker.ts` — Detached worker process for background brief execution
- `src/core/background-manager.ts` — Spawn/kill logic for background workers
- `src/core/agents.ts` — Soul.md parser with persona overlay support
- `src/core/team.ts` — Team state creation, agent directory helpers
- `src/cli/ui.ts` — Shared UI helpers (tables, colors, formatting)
- `src/cli/start.ts` — CLI command that calls `startCEOSession()`, renders org chart
- `src/cli/brief.ts` — CLI command with budget checks, calls `sendBrief()` or `startBackgroundBrief()`, generates journal entry
- `src/cli/cost.ts` — Per-agent cost breakdown, spending limits, history
- `src/cli/journal.ts` — View/search CEO journal entries
- `src/cli/logs.ts` — CLI command that reads background_logs from the database
- `src/cli/status.ts` — Dashboard with org chart, agent table, background job status
- `src/cli/stop.ts` — Kills running background workers before ending session

## Edge Cases

- **No CEO soul.md**: Throws error "CEO agent definition not found. Run 'aicib init' first."
- **Disabled agents**: Agents with `enabled: false` in config are excluded from subagent map
- **SDK tools mismatch**: `SendMessage` and `TeamCreate` from soul.md are silently filtered out
- **Cost recording**: Per-model breakdown via SDK `modelUsage` field. Falls back to single entry if unavailable.
- **Unknown model ID**: If a model ID doesn't start with "claude-opus" or "claude-haiku", it's assigned the sonnet tier. `toSDKShortName()` logs a `console.warn` on fallback. Prefix matching (`startsWith`) avoids false positives on hypothetical compound names.
- **Subagent wrong cwd**: SDK's `AgentDefinition` lacks a `cwd` field. Subagents may fall back to `process.cwd()` instead of inheriting the CEO's `cwd`. Mitigated by injecting absolute project path into CEO/brief prompts.
- **Journal loading failure**: Caught and warned — CEO starts without memory, session is not blocked
- **Journal DB connection**: Always closed via `finally` block, even if loading throws
- **Persona preset missing**: Warned but not blocking — agents run with base personality only
- **Persona override typo**: Warns if an override key doesn't match any agent role
- **Duplicate hook registration**: Context providers, message handlers, config extensions, and table registrations all throw on duplicate name/key
- **Reserved config key**: `registerConfigExtension()` rejects `company`, `agents`, `settings`, `persona`
- **Partial extension config**: Missing fields filled from defaults via shallow merge
- **Unknown YAML keys**: Preserved through load/save round-trips instead of being silently dropped
- **Message handler failure**: Logged as warning, never breaks the main message stream

### Registered Hooks (as of Wave 2)

| Module | Context Providers | Message Handlers | Config Sections | DB Tables |
|--------|-------------------|------------------|-----------------|-----------|
| Slack (`integrations/slack/register.ts`) | — | `slack-bridge` | `slack` | — |
| Tasks (`core/task-register.ts`) | `task-board` | `task-actions` | `tasks` | `tasks`, `task_blockers`, `task_comments` |
| Intelligence (`core/intelligence-register.ts`) | `autonomy-rules`, `escalation-chain`, `agent-skills` | — | `autonomy`, `escalation`, `skills` | `escalation_events` |

## Related Docs

- `docs/technical/engine-abstraction.md` — Engine abstraction layer and model router
- `docs/technical/task-management.md` — Task/project management system
- `docs/technical/agent-intelligence.md` — Autonomy, escalation, skills
- `docs/technical/persona-system.md` — Persona preset system
- `docs/technical/journal-and-output.md` — Journal, colored output, org chart
- `docs/flows/cost-and-budgets.md` — Cost command and budget alerts
- `docs/flows/tasks.md` — Task commands user guide
- `docs/flows/journal.md` — Journal command user guide
- `docs/flows/start-brief-stop.md` — Core command workflow
