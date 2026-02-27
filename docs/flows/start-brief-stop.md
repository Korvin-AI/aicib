# Start, Brief, and Stop Commands

## Overview

These three commands are the core workflow for using AICIB. You start the team, give them work, and stop when done.

## How It Works

### 1. `aicib start`

Boots up your AI company. Creates a CEO session with department heads (CTO, CMO, CFO) registered as subagents.

**What you see:**
```
AI Company-in-a-Box — Starting team

Team: MyStartup
Session: aicib-1707741234-abc123
Agents:
  → Chief Executive Officer (ceo) — opus
  → Chief Technology Officer (cto) — opus
  → Chief Financial Officer (cfo) — sonnet
  → Chief Marketing Officer (cmo) — sonnet

Cost limits: $50/day, $500/month

Launching CEO...

[SYSTEM] Session: abc-123-def | Model: opus
[CEO] I'm the CEO of MyStartup. My team is ready...
[RESULT] Cost: $0.0234 | Turns: 1 | Duration: 3.2s

Team is ready!
Use 'aicib brief "your directive"' to send directives.
```

**What can go wrong:**
- "No agent definitions found" → Run `aicib init` first
- "Team already running!" → Run `aicib stop` first, or use `aicib brief` directly
- "Error launching" → Check that Claude Code is authenticated (uses your Claude Code subscription)

### 2. `aicib brief "your directive"`

Sends a directive to the CEO. The CEO breaks it down and delegates to department heads.

**What you see (foreground mode):**
```
AI Company-in-a-Box — Briefing CEO

Company: MyStartup
Directive: "Build a landing page for our product"

Resuming session: abc-123-def

[CEO] I'll break this into technical and marketing workstreams...
[SUBAGENT] Working on technical architecture...
[SUBAGENT] Working on content strategy...
[CEO] Here's the status update from the team...

Cost: $1.4700 | Turns: 5 | Duration: 45.2s
```

**What can go wrong:**
- "No active session found" → Run `aicib start` first
- "Daily cost limit reached" → Increase limit in `aicib.config.yaml` or wait until tomorrow
- "A background brief is already running" → Wait for it to finish or run `aicib stop` to cancel
- "Stale job #N auto-healed" → A previous background worker crashed. AICIB detected it, cleaned it up, and proceeds with your new brief automatically. No action needed.

### 2b. `aicib brief -p "your project brief"`

For big, multi-step goals. Creates an autonomous project that the CEO decomposes into phases and executes sequentially — all in the background. See [Projects](projects.md) for full details.

### 2c. `aicib brief --background "your directive"`

Like sending an email to your CEO instead of standing in their office. Sends the directive and gives you your terminal back immediately. The team works in the background.

**What you see:**
```
AI Company-in-a-Box — Briefing CEO

Company: MyStartup
Directive: "Build a landing page for our product"

Brief sent. CEO is working on it.

Job #1 | PID 12345
Check progress: aicib status
View full logs:  aicib logs
```

**How it works under the hood:**
1. Creates a `background_jobs` record in the SQLite database (stores the directive text in the DB)
2. Spawns a detached Node.js child process (`background-worker.ts`) with only the job ID, project path, and SDK session ID — the directive is read from the DB, not passed as a process argument
3. The worker calls `sendBrief()` from the agent runner — same code as foreground mode
4. All agent messages are written to the `background_logs` table instead of the console
5. When done, the job is marked as `completed` with cost/turns/duration
6. If something goes wrong, the job is marked as `failed` with the error message

### 2d. `aicib logs`

Shows the full conversation log from the most recent background job.

**What you see:**
```
AI Company-in-a-Box — Logs for Job #1

Directive: "Build a landing page for our product"
Status: COMPLETED
Started: 2026-02-13 21:20:57
Completed: 2026-02-13T21:21:20.875Z

21:21:00 [system] [SYSTEM] Session: abc-123-def | Model: opus
21:21:06 [ceo] [CEO] I'll break this into workstreams...
21:21:09 [ceo] [CEO] [Tool: Task]
21:21:19 [ceo] [CEO] Directive complete. Here's the deliverable...
21:21:19 [system] [RESULT] Cost: $0.0746 | Turns: 2 | Duration: 19.5s

Cost: $0.0746 | Turns: 2 | Duration: 23.6s
```

**Options:**
- `aicib logs --job 3` — show logs from a specific job by ID
- `aicib logs --lines 50` — limit the number of log lines shown (must be a positive whole number)

### 3. `aicib stop`

Ends the session and shows final cost. If a background job is running, it kills the worker process first.

**What you see (with background job running):**
```
AI Company-in-a-Box — Stopping team

Stopping background job #2...
Background worker terminated.
Session aicib-1707741234-abc123 ended.
All agents marked as stopped.

Final cost breakdown:
  ceo                    $1.4934
  ──────────────────────────────
  Total                  $1.4934
```

**What you see (no background job):**
```
AI Company-in-a-Box — Stopping team

Session aicib-1707741234-abc123 ended.
All agents marked as stopped.
```

**What can go wrong:**
- "No active session found" → Team was already stopped or never started

## Technical Notes

- Sessions persist in SQLite (`.aicib/state.db`), so they survive terminal restarts
- `brief` resumes the exact same conversation — the CEO remembers previous briefs
- Cost tracking records token usage per command execution
- The CEO uses Claude's Task tool to delegate work to subagents (CTO, CMO, CFO)
- Background mode uses SQLite WAL mode with a 5-second busy timeout for safe concurrent reads/writes between the CLI and worker process
- Background worker is a detached Node.js child process — survives if you close your terminal
- Only one background job can run at a time per session (double-brief protection)
- `status` checks PID liveness — if the worker process crashed, it auto-marks the job as failed
- `brief` also checks PID liveness — if a previous worker crashed, `brief` auto-heals the stale job and proceeds with your new directive
- `stop` checks the job's current status before marking it as failed — if the worker finished just before you stopped, it stays `completed`
