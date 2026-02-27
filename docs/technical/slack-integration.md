# Slack Integration — Technical Architecture

## What It Does

The Slack integration lets users interact with their AI company through Slack instead of (or alongside) the terminal. Each department gets its own channel, and the CEO receives briefs via messages in `#aicib-ceo`.

Built as a hook-based extension using the hook system — it registers its own config section, database tables, and message handler without modifying core files.

## Architecture Overview

```
Slack Workspace                          AICIB System
┌─────────────────┐                    ┌──────────────────────┐
│ #aicib-ceo      │◄──── Socket ────►  │ daemon.ts            │
│ #aicib-eng      │      Mode          │   ├─ Bolt App        │
│ #aicib-finance  │   (WebSocket)      │   ├─ BriefQueue      │
│ #aicib-marketing│                    │   ├─ ChatQueue       │
└─────────────────┘                    │   ├─ Log Polling     │
                                       │   └─ Heartbeat       │
                                       ├──────────────────────┤
                                       │ chat-handler.ts      │
                                       │   ├─ Classification  │
                                       │   ├─ CEO Chat        │
                                       │   ├─ Dept/Agent Chat │
                                       │   ├─ @Mention Parser │
                                       │   ├─ Brief Confirm   │
                                       │   └─ SessionLock     │
                                       ├──────────────────────┤
                                       │ message-bridge.ts    │
                                       │   ├─ Outbound handler│
                                       │   ├─ Inbound handler │
                                       │   └─ Slash commands  │
                                       ├──────────────────────┤
                                       │ channel-mapper.ts    │
                                       │   ├─ Tool-use routing│
                                       │   └─ Channel CRUD    │
                                       ├──────────────────────┤
                                       │ message-formatter.ts │
                                       │   └─ MD → mrkdwn     │
                                       └──────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/integrations/slack/types.ts` | Shared types, constants, channel maps, emoji maps |
| `src/integrations/slack/register.ts` | Side-effect: registers config extension + DB tables via hook system |
| `src/integrations/slack/state.ts` | Shared SQLite helpers for `slack_state` table |
| `src/integrations/slack/chat-handler.ts` | Chat classification, CEO/department/agent chat, @mentions, brief confirmation, SessionLock |
| `src/integrations/slack/channel-mapper.ts` | Channel creation, routing (tool_use → department), SQLite persistence |
| `src/integrations/slack/message-formatter.ts` | Markdown → Slack mrkdwn, Block Kit payloads, role name formatting |
| `src/integrations/slack/message-bridge.ts` | Outbound handler (with per-agent usernames), BriefQueue, slash commands, log polling |
| `src/integrations/slack/daemon.ts` | Long-lived detached process — Bolt Socket Mode, heartbeat, shutdown |
| `src/cli/slack.ts` | CLI: `aicib slack connect/disconnect/status` |

## How It Works

### Connection Flow

1. `aicib slack connect` prompts for Slack tokens (xapp- and xoxb-)
2. Tests connection via `auth.test()`
3. Creates/finds department channels (`#prefix-ceo`, `#prefix-engineering`, etc.)
4. Saves tokens to SQLite `slack_state` table (secrets stay out of YAML)
5. Saves non-secret config (prefix, debounce, threading) to YAML
6. Spawns daemon as detached child process
7. Polls `CONNECTION_STATE` for up to 10 seconds to verify daemon connected

### Daemon Lifecycle

The daemon (`daemon.ts`) runs as a detached Node.js process — same pattern as `background-worker.ts` but runs indefinitely.

- **PID tracking:** Stored in `slack_state` table. Checked by `disconnect` and `status` commands.
- **Heartbeat:** Writes ISO timestamp to DB every 30 seconds. Status command shows "last seen" from this.
- **Graceful shutdown:** Listens for SIGTERM/SIGINT. Cleans up state, closes DB, stops Bolt app.
- **Health detection:** `aicib slack status` checks PID liveness. Reports "crashed" if PID is dead but state says "connected".

### Message Flow — Inbound (Slack → AICIB)

Messages are now handled in **all** AICIB channels, not just `#aicib-ceo`.

**CEO channel (`#aicib-ceo`):**

1. User types in `#aicib-ceo`
2. Bolt's `app.message()` fires (skips bots/edits)
3. Check for `@mentions` — routes to specific agent via `ChatQueue`
4. Check for `/brief` prefix — bypasses classification, goes straight to `BriefQueue`
5. `classifyHeuristic()` categorizes: definite_chat, definite_brief, or ambiguous
   - Brief signals (deadlines, delegation, action verbs) are checked FIRST — they always win
   - Chat prefixes ("hi", "thanks", etc.) checked AFTER with word-boundary matching via `startsWithWord()` — prevents "hi" matching "hire"
6. definite_chat → `ChatHandler.handleCEOChat()` (resumes CEO session with `tools: []`)
7. definite_brief → `handleSlackBrief()` → `BriefQueue` (existing delegation pipeline)
8. ambiguous → `classifyWithAI()` (Haiku, ~$0.001, cost recorded as `"ceo-classifier"`) → chat or confirmation buttons
9. Confirmation buttons: "Yes, brief the team" / "No, let's chat" with 30s timeout
10. `SessionLock` prevents concurrent CEO session access between chat and briefs

**Department channels (`#aicib-engineering`, `#aicib-finance`, `#aicib-marketing`):**

1. User types in a department channel
2. Check for `@mentions` — overrides default channel owner
3. Route to department head (CTO, CFO, CMO) or mentioned agent via `ChatQueue`
4. `ChatHandler.handleChat()` creates/resumes per-agent SDK sessions
5. C-suite heads get full tools; worker agents get talk-only (no tools)
6. Per-agent sessions stored in `slack_chat_sessions` SQLite table

**Brief pipeline (unchanged):**

1. `handleSlackBrief()` validates session + cost limits (daily AND monthly)
2. Brief enqueued to `BriefQueue` with metadata (channelId, threadTs)
3. `BriefQueue` acquires `SessionLock` before `sendBrief()`, releases after
4. On completion, :eyes: swapped for :white_check_mark: — no "Brief complete" text posted

### Message Flow — Outbound (AICIB → Slack)

1. Agent produces a message during `sendBrief()` or `startCEOSession()`
2. `notifyMessageHandlers()` in agent-runner calls registered handlers
3. Slack handler: tracks task notifications, formats to Block Kit, resolves channel
4. Each message is posted with `username` set to the agent's role name ("CEO", "CTO", "Backend Engineer") and `icon_emoji` set to the role's emoji — requires `chat:write.customize` Slack scope
5. Routes to correct department channel using `DEPARTMENT_CHANNEL_MAP` + `toolUseToRole` map
6. CEO messages thread under the original Slack message (via `BriefQueue.currentThreadTs`)
7. `result` type messages (session-complete telemetry) are suppressed from Slack — only visible in the terminal

### Channel Routing

Agent role → department channel mapping:

| Agent Role | Channel Suffix |
|-----------|---------------|
| ceo | ceo |
| cto, backend-engineer, frontend-engineer | engineering |
| cfo, financial-analyst | finance |
| cmo, content-writer | marketing |
| unknown | ceo (fallback) |

The `toolUseToRole` map tracks which `tool_use_id` corresponds to which agent (built from `task_notification` messages). Cleared at the start of each brief via `BriefQueue.processNext()`.

### Cross-Process Log Polling

When briefs originate from the CLI (not Slack), the daemon still mirrors output to Slack via polling:

1. `startLogPolling()` runs on a 2-second interval
2. Queries `getBackgroundLogsSince(jobId, lastLogId)` — SQL-level filtering, not JS
3. Routes each log entry to the correct department channel
4. Uses `DEPARTMENT_CHANNEL_MAP` for routing (not hardcoded to CEO)

### Markdown → mrkdwn Conversion

`markdownToMrkdwn()` handles the translation between standard Markdown and Slack's format:

1. Preserves Slack tokens (`<@U123>`, `<#C456>`, `<!here>`) via placeholder extraction
2. Escapes `&`, `<`, `>` for HTML safety
3. Restores Slack tokens
4. Converts italic before bold (avoids double-conversion bug)
5. Converts links, strikethrough
6. Code blocks are split out and left untouched

### Agent Display Names

`formatRoleName(role, customNames?)` converts internal role IDs to display-friendly Slack usernames:

- **Custom names first:** If `slack.custom_display_names` is set in config (e.g., `{ ceo: "Alex (CEO)" }`), that takes priority
- C-suite acronyms: `ceo` → `"CEO"`, `cto` → `"CTO"`
- Hyphenated roles: `backend-engineer` → `"Backend Engineer"`

Used as the `username` parameter in `chat.postMessage`. Each message also gets the role's emoji via `icon_emoji`. Requires the `chat:write.customize` bot token scope — without it, messages still work but display as the app name.

### Chat Session Architecture

```
AICIB Session
  ├─ CEO SDK Session (session_data table) ─── used for briefs + CEO chat
  │     └─ Protected by SessionLock
  │
  ├─ CTO Chat Session (slack_chat_sessions) ─── created on first message
  ├─ CFO Chat Session (slack_chat_sessions) ─── created on first message
  ├─ CMO Chat Session (slack_chat_sessions) ─── created on first message
  └─ [Worker sessions created on demand via @mentions]
```

- Each department head gets its own SDK session, independent from CEO briefs
- Sessions persist across messages (resumed via stored SDK session ID)
- New `aicib start` creates a new AICIB session — old chat sessions become stale

### @Mention Resolution

`parseMention(text, config, slackConfig)` builds a reverse lookup map:

1. Standard roles from `DEPARTMENT_CHANNEL_MAP` (e.g., "cto", "CTO")
2. Display names from `formatRoleName()` (e.g., "Backend Engineer")
3. Custom names from `slack.custom_display_names` config
4. Agent roles from config (catches any roles not in DEPARTMENT_CHANNEL_MAP)

Sorted by name length (longest first) to prevent partial matches. Case-insensitive. Uses `(?=[\s.,!?;:]|$)` lookahead instead of `\b` word boundary to correctly handle display names with trailing punctuation (e.g., "Alex (CEO)").

### Database Tables

| Table | Purpose |
|-------|---------|
| `slack_state` | Key-value store for tokens, PID, heartbeat, connection state |
| `slack_channels` | Department → channel ID/name mappings |
| `slack_chat_sessions` | Per-agent chat SDK session IDs, scoped to AICIB session |

All registered via `registerTable()` from `register.ts`.

## Security

- **Tokens in SQLite, not YAML** — `bot_token` and `app_token` stored in `slack_state` table only
- **No tokens in logs** — daemon uses `process.stderr.write` for errors, never includes token values
- **Parameterized SQL** — all queries use `?` placeholders, no string interpolation

## Dependencies

- `@slack/bolt` — Slack Bolt SDK for Socket Mode + event handling
- `@slack/web-api` — Slack Web API client for posting messages

Both are direct dependencies (bundled with aicib, not peer deps) since the daemon needs them at runtime.
