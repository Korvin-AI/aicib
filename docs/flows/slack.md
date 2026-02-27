# Slack Integration

## Overview

Talk to your AI company through Slack. Send briefs by typing in `#aicib-ceo`, and watch agent output flow into department channels — just like real employees collaborating.

## Setup: `aicib slack connect`

Interactive wizard that connects your Slack workspace in ~2 minutes.

**What happens step by step:**
1. Prompts for your Slack App tokens (you create these at api.slack.com — see below)
2. Tests the connection to your workspace
3. Asks for a channel prefix (default: `aicib`)
4. Creates 4 channels: `#aicib-ceo`, `#aicib-engineering`, `#aicib-finance`, `#aicib-marketing`
5. Starts the Slack bot in the background
6. Confirms connection (waits up to 10 seconds for the bot to connect)

**After setup — join the channels:**
The bot creates the channels but doesn't add you automatically. In Slack, press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux), search for your prefix (e.g., "aicib"), and join each channel.

**What you need first — Creating the Slack App:**

1. Go to **api.slack.com/apps** → "Create New App" → "From scratch"
2. Name it anything (e.g., "AICIB") and pick your workspace
3. **Enable Socket Mode:** Settings → Socket Mode → toggle ON
4. **Create App-Level Token:** It'll prompt you — give it `connections:write` scope. Copy the token (starts with `xapp-`)
5. **Add Bot Token Scopes:** Go to OAuth & Permissions → Bot Token Scopes → add:
   - `channels:manage`, `channels:read`, `channels:history`
   - `chat:write`, `chat:write.customize`, `reactions:read`, `reactions:write`
   - `commands` (optional — needed for `/aicib` slash commands)
   > **Note:** `chat:write.customize` lets the bot show agent names (CEO, CTO, etc.) instead of just "AICIB" on each message. Without it, messages still work but all show as "AICIB."
6. **Enable Event Subscriptions:** Go to Event Subscriptions → toggle ON → under "Subscribe to bot events" add:
   - `message.channels` (this lets the bot hear messages in public channels)
7. **Install to workspace:** Click "Install to Workspace" at the top → Allow
8. **Copy Bot Token:** Go to OAuth & Permissions → copy "Bot User OAuth Token" (starts with `xoxb-`)

**Important:** If you forget step 6 (Event Subscriptions), the bot will connect but won't hear any messages you type.

## Chatting with Your Team

Just type naturally in any AICIB channel. The system figures out what you want:

### CEO Channel (`#aicib-ceo`)

**Casual chat** — Greetings, questions, opinions are handled conversationally by the CEO.
```
You: Hey, what do you think about our pricing?
CEO: Great question! Based on our current positioning...
```

**Work directives** — Clear tasks are automatically detected and trigger the full delegation pipeline:
```
You: Build a competitive analysis report by Friday
CEO: [delegates to CTO, CFO, CMO — full team works on it]
```

**Ambiguous messages** — When the system isn't sure, it asks with buttons:
```
You: We should look into our competitors
CEO: 💼 That sounds like a task for the team. Want me to brief the department heads?
    [Yes, brief the team]  [No, let's chat]
```

If you don't click within 30 seconds, it defaults to a chat response.

**Force a brief** — Prefix with `/brief` to skip classification:
```
You: /brief Research the top 5 competitors in our space
CEO: [immediately starts delegation — no classification step]
```

### Department Channels

Type in any department channel to talk directly with the department head:

| Channel | Who responds | Capabilities |
|---------|--------------|--------------|
| `#aicib-engineering` | CTO | Can read code, create files, run commands |
| `#aicib-finance` | CFO | Can read data, create spreadsheets, run calculations |
| `#aicib-marketing` | CMO | Can create content, review marketing materials |

```
# In #aicib-engineering:
You: What's the current state of our API?
CTO: I'll take a look at the codebase... [reads files, provides analysis]
```

### @Mentions

Tag a specific agent in any channel:

```
# In #aicib-engineering:
You: @Backend Engineer what APIs are you working on?
Backend Engineer: [responds directly — talk-only, no tools]

# Cross-department mention:
You: @CFO what's our budget look like?
CFO: [responds in engineering channel with budget info]

# In #aicib-ceo:
You: @CTO check the build status
CTO: [responds directly — not treated as a brief]
```

**Note:** C-suite agents (CTO, CFO, CMO) can use tools (read files, create docs). Other agents (Backend Engineer, Content Writer) can only chat.

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/aicib status` | Shows which agents are working, idle, or errored |
| `/aicib cost` | Shows today's and this month's spending with per-agent breakdown |
| `/aicib brief <text>` | Submit a brief via slash command (skips classification) |
| `/aicib help` | Lists available commands |

## Department Channel Output Routing

Agent output from briefs is automatically routed to the right channel:

| Channel | Who posts here |
|---------|---------------|
| `#aicib-ceo` | CEO messages, system notifications |
| `#aicib-engineering` | CTO, backend engineer, frontend engineer |
| `#aicib-finance` | CFO, financial analyst |
| `#aicib-marketing` | CMO, content writer |

Department channels are also interactive — see "Chatting with Your Team" above.

## Managing the Connection

### Check status
```
aicib slack status
```
Shows: connection state, workspace name, daemon PID, last heartbeat, channel list. Detects crashed daemons automatically.

### Disconnect
```
aicib slack disconnect
```
Gracefully stops the bot (SIGTERM → waits 5s → SIGKILL if needed). Updates state to "disconnected".

### Reconnect
```
aicib slack connect
```
Re-runs the setup wizard. Finds existing channels if they already exist.

## What Can Go Wrong

| Situation | What happens |
|-----------|-------------|
| Bot connected but ignores messages | Event Subscriptions not enabled. Go to api.slack.com/apps → your app → Event Subscriptions → enable + add `message.channels` bot event → reinstall app. |
| Can't see the channels | The bot created them but you haven't joined. Press Cmd+K, search for the prefix, and join each channel. |
| No active session | Bot replies: "No active session. Run `aicib start` first." |
| Daily cost limit reached | Bot replies with the limit message. Brief is rejected. |
| Monthly cost limit reached | Same — brief rejected with monthly limit message. |
| Bot daemon crashes | `aicib slack status` shows "CRASHED". Reconnect with `aicib slack connect`. |
| Bot can't access a channel | Warning during setup. Invite the bot to the channel manually. |
| Multiple briefs at once | Queued and processed one at a time. User sees position number. |
| Chat classified as brief | Confirmation buttons appear — click "No, let's chat." Timeout (30s) auto-treats as chat. |
| Brief classified as chat | CEO replies conversationally. Retype with clearer wording or prefix with `/brief`. |
| Chat disabled but dept message sent | Silently ignored in all channels when `chat_enabled: false`. |

## Agent Display Names

With the `chat:write.customize` scope (step 5 above), each message shows the agent's role as the sender name — "CEO", "CTO", "Backend Engineer" — instead of the generic app name. Each role also gets its own emoji icon.

Without the scope, everything still works but all messages show as your app name (e.g., "AICIB").

## Technical Notes

- The Slack bot runs as a separate background process (detached daemon), not inside the main CLI
- Tokens are stored securely in SQLite, not in the YAML config file
- The bot uses Socket Mode (WebSocket) — no public URL or server needed
- CLI-initiated briefs are also mirrored to Slack via log polling
- Session-complete telemetry (cost, turns, duration) only shows in the terminal, not in Slack
