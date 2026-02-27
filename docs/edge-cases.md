# Edge Cases

Track edge cases discovered during implementation.

## Template System

### Template Import — Path Traversal via Template Name

**Scenario:** A crafted `template.yaml` has `name: "../../etc"` to write outside the intended directory.
**Handling:** `sanitizeTemplateName()` rejects any name not matching `[a-z0-9-]`. Throws before any path construction or file writes.
**User sees:** `Invalid template name "../../etc". Only lowercase letters, numbers, and hyphens are allowed.`

### Legacy Template Detection — New Dirs Matching

**Scenario:** `--template industries` or `--template structures` routes to `legacyInit()`, which crashes because these directories don't have `config.yaml`.
**Handling:** `listTemplates()` filters to only return directories containing both `config.yaml` and an `agents/` subdirectory. New dirs (`industries`, `structures`, `presets`) are excluded.
**User sees:** `Error: Template "industries" not found.`

### Org Chart — Non-Standard CEO Role Key

**Scenario:** A custom structure uses `managing_director` as the top role instead of `ceo`.
**Handling:** `printOrgChart()` detects the CEO dynamically via `reports_to: "human-founder"` and uses the detected role key for finding C-suite reports. Not hardcoded to `"ceo"`.
**User sees:** Correct org chart regardless of what the top-level role is named.

### User Template Discovery — HOME Not Set

**Scenario:** `HOME` and `USERPROFILE` environment variables are both unset (rare, but possible in restricted containers).
**Handling:** `getUserTemplatesDir()` returns `null`. All listing/loading functions skip the user templates directory gracefully. Only package templates are shown.
**User sees:** Only bundled templates available. No error.

## Agent Runner / SDK Integration

### Start — Double Start Prevention

**Scenario:** User runs `aicib start` when a session is already active
**Handling:** Checks `getActiveSDKSessionId()` before creating a new session. If active, blocks with message.
**User sees:** "Team already running! Use 'aicib brief' to send directives, or 'aicib stop' to end the session."

### Brief — No Active Session

**Scenario:** User runs `aicib brief` without running `aicib start` first
**Handling:** `getActiveSDKSessionId()` returns null, command exits with error
**User sees:** "No active session found. Run 'aicib start' first to launch the team."

### Brief — Daily Cost Limit Reached

**Scenario:** Accumulated API costs for today exceed the configured daily limit
**Handling:** Checks `getTotalCostToday()` against `config.settings.cost_limit_daily` before sending brief
**User sees:** "Daily cost limit reached ($X.XX / $50). Increase the limit in aicib.config.yaml or wait until tomorrow."

### Start — Missing CEO Agent Definition

**Scenario:** CEO soul.md file is missing from `.claude/agents/` directory
**Handling:** `startCEOSession()` throws error when `agents.get("ceo")` returns undefined
**User sees:** "CEO agent definition not found. Run 'aicib init' first."

### Agent Runner — SDK Tool Mismatch

**Scenario:** Soul.md files reference `SendMessage` and `TeamCreate` tools which don't exist in the Agent SDK
**Handling:** `EXCLUDED_TOOLS` set filters these out silently during `buildSubagentMap()`
**User sees:** Nothing — this is handled transparently

### Stop — No Active Session

**Scenario:** User runs `aicib stop` when no session is running
**Handling:** `getActiveSession()` returns null, command exits gracefully
**User sees:** "No active session found."

### Agent Runner — Disabled Agents

**Scenario:** Agent has `enabled: false` in config.yaml
**Handling:** `buildSubagentMap()` checks `agentConfig.enabled` and skips disabled agents
**User sees:** Disabled agents don't appear in the CEO's available team

### Brief — Subagent Saves Files in Wrong Directory

**Scenario:** CEO delegates to multiple department heads (CTO, CFO, CMO). Some subagents save deliverables in the project directory, others save to the repo root or `process.cwd()`.
**Cause:** The Agent SDK's `AgentDefinition` type doesn't support a `cwd` field. Subagents are supposed to inherit the parent session's `cwd`, but this is inconsistent — especially for agents spawned in parallel or after the first subagent.
**Handling:** CEO's system prompt (in `startCEOSession()`) and each brief prompt (in `sendBrief()`) now include the absolute project directory path with instructions to use absolute paths when delegating file-writing tasks to department heads.
**User sees:** All deliverables land in the correct project directory.

## Background Mode

### Brief — Double Background Brief Prevention

**Scenario:** User runs `aicib brief --background "task"` while another background job is already running
**Handling:** `getActiveBackgroundJob(sessionId)` checks for jobs with status `running`. If found and PID is alive, blocks with error.
**User sees:** "A background brief is already running. Job #2: 'test directive one...' Wait for it to finish or run 'aicib stop' to cancel."

### Brief — Stale Crashed Job Auto-Heal

**Scenario:** A previous background worker crashed (or was killed with `kill -9`), but the DB still shows `status = "running"`. User runs `aicib brief` again.
**Handling:** `brief.ts` checks PID liveness on any job marked `running`. If the PID is dead, auto-marks the job as `failed` with message "Worker process crashed (auto-healed by brief)" and proceeds with the new brief.
**User sees:** "Stale job #N auto-healed (worker had crashed)." followed by normal brief execution.

### Status — Worker Process Crashed

**Scenario:** Background worker process crashed or was killed externally, but DB still shows status `running`
**Handling:** `isProcessRunning(pid)` checks if the PID is still alive. If not, auto-updates job to `failed` with error message.
**User sees:** "Background work: FAILED (worker process not found)"

### Stop — Background Job Running During Stop

**Scenario:** User runs `aicib stop` while a background job is still running
**Handling:** `killBackgroundJob()` sends SIGTERM to the worker process. Re-reads the job's current status from DB before updating — only marks as `failed` if the job is still `running`. If the worker finished just before the kill, the `completed` status is preserved.
**User sees:** "Stopping background job #2... Background worker terminated."

### Stop — Race: Worker Completes Just Before Kill

**Scenario:** Worker finishes and marks job as `completed` at the exact moment `aicib stop` calls `killBackgroundJob()`
**Handling:** `killBackgroundJob()` re-reads job status from DB before writing. Sees `completed`, skips the update. The SIGTERM is harmless (process already exited).
**User sees:** Job shows as COMPLETED in `aicib status` / `aicib logs`, not incorrectly overwritten to FAILED.

### Background Worker — Config Load Failure

**Scenario:** Worker process can't load `aicib.config.yaml` (file deleted or corrupted after spawning)
**Handling:** Worker catches the error, marks job as `failed` with "Config load failed" message, exits
**User sees:** Job shows as FAILED in `aicib status` and `aicib logs`

### Background Worker — SDK Error (Cost Limit, API Key, etc.)

**Scenario:** `sendBrief()` throws during background execution (cost limit hit, API error, etc.)
**Handling:** Worker catches the error, logs it to `background_logs`, marks job as `failed` with error message
**User sees:** Error details in `aicib logs` and `aicib status`

### Background Worker — Job Not Found in DB

**Scenario:** Worker starts but its job ID doesn't exist in the database (e.g., DB was reset between spawn and worker startup)
**Handling:** Worker checks `getBackgroundJob(jobId)` immediately on startup. If null, writes error to stderr and exits with code 1.
**User sees:** Job never appears in `aicib status`. Worker process exits silently.

### Background Manager — Spawn Failure (PID Undefined)

**Scenario:** `spawn()` fails (bad path, permissions issue). `child.pid` is `undefined`.
**Handling:** Manager checks `child.pid === undefined` after spawn. If so, marks job as `failed` with "Failed to spawn worker process (pid undefined)" and throws an error.
**User sees:** Error message from `brief.ts`'s catch block.

### Logs — Invalid --lines Value

**Scenario:** User runs `aicib logs --lines abc` or `aicib logs --lines -5`
**Handling:** Validates parsed number is a positive integer. Rejects NaN, negative, zero, and fractional values.
**User sees:** "Error: --lines must be a positive integer."

## CEO Journal / Memory

### Journal Loading — Database Error

**Scenario:** Journal database is corrupted, has schema issues, or has permission problems when CEO starts up
**Handling:** `startCEOSession()` catches the error and logs a console warning. CostTracker is always closed via `finally` block (no DB connection leak). CEO starts without journal context.
**User sees:** "Warning: Failed to load journal entries: [error details]" — then normal session startup.

### Journal Generation — API Failure

**Scenario:** Haiku model call fails during journal summary generation (network error, budget exceeded, etc.)
**Handling:** Caught in `generateJournalEntry()`, warning logged. Brief result is unaffected.
**User sees:** "Warning: Journal entry generation failed: [error details]" — brief output is already complete.

### Journal Context — Too Long

**Scenario:** 10 journal entries exceed ~6000 characters (~3000 tokens), which could bloat the CEO's context
**Handling:** `startCEOSession()` trims to 5 entries if formatted text exceeds 6000 chars
**User sees:** Nothing — handled transparently

## Agent Persona Studio

### Display Name — Special Characters ($, \)

**Scenario:** User sets `display_name: "Anna$2"` — the `$` could be interpreted as a regex replacement pattern.
**Handling:** `applyDisplayName()` uses split/findIndex/rejoin instead of `String.replace()`. No regex replacement patterns are evaluated.
**User sees:** Heading correctly shows `# Anna$2 — Chief Executive Officer (CEO)`.

### Role Preset — Custom Slug

**Scenario:** User creates a custom preset file and sets `role_preset: my-custom-one` — the slug isn't in any hardcoded list.
**Handling:** Validation only checks slug format (`/^[a-z][a-z0-9-]*$/`). File existence is checked at load time by `loadRolePreset()`, which throws a clear error if missing.
**User sees:** If file exists: preset loads normally. If missing: warning during `aicib start`/`aicib brief`.

### Traits — Scalar Instead of Object

**Scenario:** User writes `traits: "direct"` in YAML instead of a nested object.
**Handling:** `validateConfig()` checks `typeof ap.traits !== "object"` and rejects with explicit error.
**User sees:** Config validation error: `persona.agents.ceo.traits must be an object`.

### Editor — Arguments in $EDITOR

**Scenario:** `EDITOR="code --wait"` or `VISUAL="nvim --noplugin"`.
**Handling:** `agentEditCommand()` splits the editor string on whitespace. First token is the command, rest are prepended to args.
**User sees:** Editor opens normally with the soul.md file.

### Preset File — Corrupt or Permission Error

**Scenario:** A `.md` file in `presets/roles/ceo/` has bad encoding or a filesystem permission error.
**Handling:** `listRolePresets()` catches the error and logs `Warning: Skipping invalid preset "..." for role "...": [error]`. Other valid presets still load.
**User sees:** Warning in terminal. The corrupt preset doesn't appear in selection lists.

### Init — Agent Personas Config Round-Trip

**Scenario:** User customizes agent personas during `aicib init`. The YAML needs to be written correctly.
**Handling:** Base config is written first with name/preset substitutions. Then `loadConfig()` parses it, sets `persona.agents`, and `saveConfig()` writes it back. No regex YAML injection.
**User sees:** Clean YAML in `aicib.config.yaml` with properly nested `persona.agents` section.

## Personas

### Init/Start — Missing Persona Preset

**Scenario:** Preset file doesn't exist or is malformed (e.g., template was created with an older version)
**Handling:** `loadPersonaFromConfig()` catches the error. For the default "professional" preset, shows a dim note. For user-selected presets, shows a warning.
**User sees:** "Note: No persona preset loaded. Agents running with base personalities only." or "Warning: Persona preset 'creative' could not be loaded."

### Config — Override Key Typo

**Scenario:** User sets a persona override for a role that doesn't exist (e.g., `overrides: { marketing: creative }` instead of `cmo`)
**Handling:** `buildSubagentMap()` checks override keys against loaded agent roles after building the map
**User sees:** "Warning: Persona override key 'marketing' does not match any agent role. Check spelling in config."

## Cost & Budget

### Brief — Daily Cost Limit Reached

**Scenario:** Today's accumulated API costs exceed the configured daily limit
**Handling:** `brief.ts` checks `getTotalCostToday()` before sending. Hard stop if exceeded.
**User sees:** "Daily cost limit reached ($50.12 / $50). Increase the limit in aicib.config.yaml or wait until tomorrow."

### Brief — Monthly Cost Limit Reached

**Scenario:** This month's accumulated API costs exceed the configured monthly limit
**Handling:** `brief.ts` checks `isMonthlyLimitReached()` before sending. Hard stop if exceeded.
**User sees:** "Monthly cost limit reached."

### Brief — Approaching Budget Limit

**Scenario:** Costs are between 50-80% or above 80% of daily/monthly limit
**Handling:** Warning displayed but brief proceeds
**User sees:** Yellow warning at 50%+, red warning at 80%+, with dollar amounts and percentages

### Cost Display — Corrupted Data

**Scenario:** Cost value is NaN, Infinity, or negative due to database corruption
**Handling:** `formatPercent()` returns "N/A" for non-finite or negative values instead of displaying garbage like "NaN%"
**User sees:** "N/A" in the percentage column

## Session Completion & Status Tracking

### Brief — Session Ends Before Sub-Agents Finish

**Scenario:** CEO delegates to CTO/CFO/CMO via Task tool, but the session ends after only 4-5 CEO turns before sub-agents complete their work
**Handling:** `maxTurns` set to 500 for CEO sessions and 200 for sub-agents. `maxBudgetUsd` remains the real cost safety net.
**User sees:** Full delegation cycle completes — sub-agents run, CEO compiles results

### Brief — Foreground Job Fails Mid-Execution

**Scenario:** `sendBrief()` throws an error during a foreground brief after the foreground job record was already created
**Handling:** Catch block marks the foreground job as "failed" in the database with the actual error message, and sets CEO status to "error"
**User sees:** Error message in terminal. `aicib logs` shows the job as FAILED with the error details.

### Status — Runtime Agent Status

**Scenario:** User runs `aicib status` while a brief is executing
**Handling:** `status.ts` reads from `agent_status` table (updated in real-time by brief.ts / background-worker.ts via `setAgentStatus()`). Shows working/idle/error/stopped with current task description.
**User sees:** CEO shows "working" with task snippet; sub-agents show "working" when dispatched, "idle" when done

### Logs — Foreground vs Background Job Display

**Scenario:** User runs `aicib logs` after a foreground brief
**Handling:** Foreground jobs are identified by `[foreground]` prefix on directive. Prefix stripped for display.
**User sees:** "Foreground Job #N" header instead of "Background Job #N"

## Slack Integration

### Slack — No Active Session When Brief Arrives

**Scenario:** User sends a message in `#aicib-ceo` but hasn't run `aicib start`
**Handling:** `handleSlackBrief()` checks `getActiveSDKSessionId()`. Returns error if null. BriefQueue's `processNext()` also checks and posts warning to Slack.
**User sees:** Bot replies: "No active session. Run `aicib start` first."

### Slack — Daily Cost Limit Reached

**Scenario:** Accumulated API costs for today exceed the configured daily limit when a Slack brief arrives
**Handling:** `handleSlackBrief()` checks `getTotalCostToday()` before enqueuing
**User sees:** Bot replies: "Daily cost limit reached ($X.XX / $50). Increase the limit or wait until tomorrow."

### Slack — Monthly Cost Limit Reached

**Scenario:** Monthly costs exceed the configured monthly limit when a Slack brief arrives
**Handling:** `handleSlackBrief()` checks `getTotalCostThisMonth()` after the daily check
**User sees:** Bot replies: "Monthly cost limit reached ($X.XX / $500). Increase the limit or wait until next month."

### Slack — Daemon Crashes

**Scenario:** The Slack daemon process crashes (OOM, unhandled exception, killed externally)
**Handling:** `aicib slack status` checks PID liveness via `isProcessRunning()`. If PID is dead but state says "connected", reports "daemon crashed".
**User sees:** Status shows "CRASHED" in red. Hint: "Restart with: aicib slack connect"

### Slack — Concurrent Briefs (Queue Ordering)

**Scenario:** Multiple Slack messages arrive before the first brief finishes processing
**Handling:** `BriefQueue` processes sequentially. Each brief gets its own `currentThreadTs` and calls `clearToolUseTracking()` at start. Subsequent briefs wait in FIFO order.
**User sees:** "Brief queued (position #2). I'll get to it after the current task."

### Slack — Rapid Messages (Debounce Coalescing)

**Scenario:** User types 3 messages within 2 seconds
**Handling:** `BriefQueue.enqueue()` merges them into one brief via debounce timer. Text joined with newlines.
**User sees:** Single acknowledgment. All 3 messages processed as one brief.

### Slack — Bold/Italic Markdown Conversion

**Scenario:** Agent output contains `**bold**` and `*italic*` Markdown
**Handling:** Italic regex runs BEFORE bold regex. Italic `(?<!\*)\*(?!\*)` won't match `**bold**` delimiters. Bold converts after.
**User sees:** Correct formatting: bold appears bold, italic appears italic (not both as italic).

### Slack — Mentions in Agent Output

**Scenario:** Agent output contains Slack tokens like `<@U123>` or `<#C456>`
**Handling:** `markdownToMrkdwn()` extracts Slack tokens before HTML escaping, replaces with placeholders, restores after escaping.
**User sees:** Mentions render correctly as clickable Slack links, not escaped text.

### Slack — Channel Not Accessible

**Scenario:** Channel exists but bot isn't a member (private channel, or name_taken error)
**Handling:** `ensureChannels()` catches the error, logs warning, skips that channel
**User sees:** Warning during `aicib slack connect`. Department messages fall back to CEO channel.

### Slack — DB Connection Locked During Heartbeat

**Scenario:** Daemon's heartbeat write fails because another process holds a DB lock
**Handling:** Heartbeat catch block silently ignores the error. WAL mode + busy_timeout=5000ms reduces occurrence.
**User sees:** Nothing — heartbeat resumes on next 30-second tick.

### Slack — Health Check Timeout on Connect

**Scenario:** Daemon spawns but fails to connect within 10 seconds (bad token, network issues)
**Handling:** `slackConnectCommand()` polls `CONNECTION_STATE` for 10s. If "error" or timeout, warns user.
**User sees:** "Slack bot started but hasn't confirmed connection yet. Check: aicib slack status"

### Slack — Agent Display Name Without chat:write.customize Scope

**Scenario:** Bot posts messages with `username` and `icon_emoji` but the Slack App doesn't have the `chat:write.customize` scope
**Handling:** Slack silently ignores the `username` and `icon_emoji` parameters. Message still posts successfully.
**User sees:** All messages show as the app name (e.g., "AICIB") instead of "CEO", "CTO", etc. Functional but less clear.

### Slack — Session-Complete Telemetry Suppressed

**Scenario:** SDK emits a `result` type message with cost/turns/duration after processing a brief
**Handling:** `formatForSlack()` returns `null` for `result` messages. The message handler skips posting.
**User sees:** Nothing in Slack. Telemetry only appears in the terminal via `aicib logs`.

### Slack — Brief Completion Signal

**Scenario:** CEO finishes processing a message from Slack
**Handling:** BriefQueue swaps the :eyes: reaction for :white_check_mark: on the original message. No "Brief complete" text is posted.
**User sees:** Their message gets a checkmark reaction when done. Thread contains only the CEO's actual reply.

### Slack — Immediate Brief vs Queued Brief Acknowledgment

**Scenario:** User sends a message when no other brief is processing (position 1) vs when a brief is already in progress (position > 1)
**Handling:** Position 1: no text ack — just :eyes: reaction. Position > 1: text reply "Brief queued (position #N)." Errors always get text replies.
**User sees:** Clean conversation for single messages. Queue position feedback when busy.

### Slack — Chat Classification Wrong (Chat Treated as Brief)

**Scenario:** User asks "What do you think about our pricing strategy?" — heuristic is ambiguous, AI classifier says BRIEF.
**Handling:** Confirmation buttons appear. User clicks "No, let's chat." CEO switches to conversational mode.
**User sees:** Brief confirmation message, then conversational reply after clicking "No."

### Slack — Chat Classification Wrong (Brief Treated as Chat)

**Scenario:** User says "Can you get the team to look at our pricing?" — heuristic classifies as chat by mistake.
**Handling:** CEO replies conversationally. User can re-send with clearer language or use "/brief" prefix.
**User sees:** A conversational reply. They can retype more explicitly or prefix with "/brief".

### Slack — AI Classification Fails

**Scenario:** Haiku classification call throws (network, budget, timeout).
**Handling:** `classifyWithAI()` catches the error, logs a warning, and returns "chat" (cheaper/safer fallback).
**User sees:** Conversational CEO reply. No error visible.

### Slack — Brief Confirmation Timeout

**Scenario:** User gets confirmation buttons but doesn't click within 30 seconds.
**Handling:** Timer fires, removes buttons, auto-treats as chat. Posts ":speech_balloon: No response — treating as a chat."
**User sees:** Button message updates to "treating as a chat", then CEO responds conversationally.

### Slack — Stale Confirmation Button Click

**Scenario:** Timeout fires (auto-chat), then user clicks "Yes, brief the team" on the stale message.
**Handling:** `resolveConfirmation()` returns undefined (already cleaned up). Action handler responds: "This was already handled."
**User sees:** "This was already handled. Send a new message or use /brief to submit a brief."

### Slack — Department Chat No Active Session

**Scenario:** User sends a message in #aicib-engineering before running `aicib start`.
**Handling:** `handleChat()` checks `getActiveSDKSessionId()` — returns null, posts error.
**User sees:** ":warning: No active session. Run `aicib start` first."

### Slack — Department Chat Agent Disabled

**Scenario:** User sends a message in #aicib-engineering but CTO has `enabled: false` in config.
**Handling:** `handleChat()` checks agent config. Posts error with the agent's display name.
**User sees:** ":warning: CTO is currently offline. Enable the agent in aicib.config.yaml."

### Slack — @Mention Unrecognized Agent

**Scenario:** User types "@Designer" which doesn't match any known role.
**Handling:** `parseMention()` returns `{ mentionedRole: null }`. Message is handled by the channel's default owner.
**User sees:** Department head responds normally (ignoring the unrecognized mention).

### Slack — @Mention Cross-Department

**Scenario:** User types "@CFO" in #aicib-engineering.
**Handling:** @mention takes priority over channel owner. CFO responds in #aicib-engineering.
**User sees:** CFO replies in the engineering channel. By design — user explicitly requested a specific agent.

### Slack — Concurrent Chat Multiple Channels

**Scenario:** User sends messages in #aicib-engineering and #aicib-finance at the same time.
**Handling:** ChatQueue processes different agents in parallel. CTO and CFO each have their own queue slot.
**User sees:** Both agents respond independently. No blocking.

### Slack — Chat During Active Brief

**Scenario:** A CEO brief is processing, and user sends a message in #aicib-engineering.
**Handling:** Department chat sessions are independent from the CEO brief pipeline. CTO has its own SDK session.
**User sees:** CTO responds while CEO brief continues. No interference.

### Slack — SessionLock Contention (CEO Chat During Brief)

**Scenario:** User sends a casual chat message in #aicib-ceo while a brief is processing.
**Handling:** `SessionLock` is held by BriefQueue. CEO chat waits until the brief completes, then processes.
**User sees:** Delayed response — chat arrives after the brief finishes. Not an error.

### Slack — Chat Cost Limits

**Scenario:** Daily cost limit reached when a department chat message arrives.
**Handling:** `handleChat()` checks cost limits before starting. Posts cost limit message.
**User sees:** ":warning: Daily cost limit reached ($X / $Y)."

### Slack — Chat Prefix False Positive ("hire" matches "hi")

**Scenario:** User sends "hire a developer" — the classifier's chat prefix "hi" would match "hire" via `startsWith`.
**Handling:** `classifyHeuristic()` uses `startsWithWord()` which checks for word boundaries (space, punctuation, or end-of-string after the prefix). Also, brief signals (deadlines, delegation, action verbs) are checked BEFORE chat prefixes so strong brief evidence always wins.
**User sees:** "hire a developer" is correctly classified as ambiguous or definite_brief, not chat.

### Slack — @Mention with Punctuation in Custom Display Name

**Scenario:** Custom display name has punctuation like "Alex (CEO)" — user types `@Alex (CEO)`.
**Handling:** `parseMention()` uses `(?=[\s.,!?;:]|$)` lookahead instead of `\b` word boundary. Since `\b` fails after non-word characters like `)`, the lookahead correctly matches when followed by whitespace, punctuation, or end-of-string.
**User sees:** Mention is correctly detected; the named agent responds.

### Slack — Brief Confirmation Button Click After Timeout

**Scenario:** 30-second timeout fires (auto-chat), then user clicks "Yes" or "No" on the stale buttons.
**Handling:** `resolveConfirmation()` returns undefined (already cleaned up by timeout). Both `confirm_brief` and `reject_brief` handlers check for undefined and return "Already handled."
**User sees:** "This was already handled. Send a new message or use /brief to submit a brief."

### Slack — Department Chat When chat_enabled is false

**Scenario:** User set `chat_enabled: false` in config, but sends a message in `#aicib-engineering`.
**Handling:** Department channel routing checks `!slackConfig.chat_enabled` and returns early. Message is silently ignored.
**User sees:** No response. Consistent with CEO channel behavior when chat is disabled.

## HR System

### HR Review — NaN Score Propagation

**Scenario:** CLI user passes non-numeric score (e.g., `aicib hr review cto --task abc`)
**Handling:** After `parseFloat`, each score is checked with `Number.isFinite()`. Invalid values trigger an error message and `process.exit(1)`.
**User sees:** "Error: Invalid score for --task: 'abc'. Must be a number."

### HR Promote/Demote — Missing --from Level

**Scenario:** User runs `aicib hr promote cto --to autonomous` without specifying `--from`
**Handling:** `resolveFromLevel()` checks latest promoted/demoted event → onboarding phase autonomy → "unknown"
**User sees:** Promotion recorded with auto-resolved from-level (e.g., "standard -> autonomous")

### HR Improve --resolve — Wrong Agent

**Scenario:** `aicib hr improve cfo --resolve 1` but plan #1 belongs to cto
**Handling:** After `updateImprovementPlan()`, checks `plan.agent_role !== role`. Prints mismatch error.
**User sees:** "Error: Plan #1 belongs to 'cto', not 'cfo'."

### HR Hire — Mentor Dropped

**Scenario:** Agent outputs `HR::HIRE role=designer department=product mentor=cto`
**Handling:** `recordHire()` accepts `mentor` param, passes to `startOnboarding()`. Mentor stored in `hr_onboarding.mentor`.
**User sees:** Nothing — mentor correctly associated with onboarding record.

### HR NL — "completed onboarding" Does Full Completion

**Scenario:** Agent says "completed onboarding for designer"
**Handling:** Dispatches `onboard_complete` action → `hr.completeOnboarding()`. Jumps to phase 4 and sets `completed_at`.
**User sees:** Nothing — agent is fully onboarded, not just advanced one phase.

### HR Review Due — Fired/Archived Agents Excluded

**Scenario:** Dashboard checks for review-due agents, but some agents are fired or archived
**Handling:** `getAgentsDueForReview()` checks `getAgentState()` for "archived"/"stopped" and checks for "fired" events. Excluded agents don't appear in due list.
**User sees:** Only active agents appear as review-due on the dashboard.

### HR Dashboard — Duplicate DB Connection

**Scenario:** Dashboard command creates multiple HRManager instances for the same project
**Handling:** Fixed: uses single `hr` instance for all queries (listOnboarding, getEvents, getAgentsDueForReview).
**User sees:** Nothing — internal optimization, same dashboard output.

## Hook System / Extension Registries

### Config Extension — Reserved Key

**Scenario:** A feature module calls `registerConfigExtension({ key: 'agents', ... })` using a key that belongs to the core config
**Handling:** `registerConfigExtension()` checks against `RESERVED_CONFIG_KEYS` set and throws immediately
**User sees:** Developer error at startup: `Config extension key "agents" is reserved`

### Config Extension — Duplicate Key

**Scenario:** A feature module is imported twice, or two features use the same config key
**Handling:** `registerConfigExtension()` checks for existing key in the registry and throws
**User sees:** Developer error at startup: `Config extension key "autonomy" is already registered`

### Config Extension — Partial YAML Section

**Scenario:** User's YAML has `autonomy: { level: high }` but the extension defaults include `{ enabled: true, level: 'medium' }`
**Handling:** `validateConfig()` shallow-merges defaults with YAML values: `{ ...defaults, ...yamlValues }`
**User sees:** Nothing — missing fields silently filled with defaults. The merged result is `{ enabled: true, level: 'high' }`

### Config — Unknown YAML Keys Preserved

**Scenario:** User manually adds a custom section to their YAML (e.g., `my_notes: ...`), or a process saves config without importing all feature modules
**Handling:** `validateConfig()` collects unrecognized top-level keys into `extensions`. `saveConfig()` flattens them back to top-level YAML.
**User sees:** Nothing — their custom sections survive load/save round-trips

### Hook Registration — Duplicate Name

**Scenario:** `registerContextProvider('task-status', fn)` called twice (module imported multiple times)
**Handling:** Second call throws: `Context provider "task-status" is already registered`
**User sees:** Developer error at startup. Same pattern for `registerMessageHandler()` and `registerTable()`.

### Message Handler — Runtime Error

**Scenario:** A registered message handler (e.g., Slack bridge) throws during message processing
**Handling:** `notifyMessageHandlers()` catches the error and logs: `Warning: Message handler "slack-bridge" failed: [error]`
**User sees:** Warning in terminal. Main session flow continues unaffected.

## Agent Intelligence Features

### Intelligence — Unknown Skill Name

**Scenario:** Frontmatter or config references a skill name that doesn't exist in the built-in library or custom skills.
**Handling:** `resolveSkills()` logs a console warning and skips the unknown skill. Agent continues with remaining valid skills.
**User sees:** `Warning: Unknown skill "nonexistent_skill" — skipping. Add it as a custom skill in config or check the name.`

### Intelligence — Empty Skills Array in Frontmatter

**Scenario:** Agent frontmatter has `skills: []` (explicit empty array).
**Handling:** `resolveAgentSkills()` treats `undefined`/missing as "use defaults" and `[]` (explicit empty) as "no skills." Empty frontmatter array is respected — the user intentionally removed all skills.
**User sees:** Nothing — agent gets no skill context injected.

### Intelligence — Config Override for Non-Existent Agent

**Scenario:** Config has `autonomy.overrides.data-scientist: { level: full }` but no data-scientist agent exists.
**Handling:** The override is silently ignored since no agent will resolve with that role name during context provider execution.
**User sees:** Nothing — the override has no effect.

### Intelligence — CEO Escalation Chain

**Scenario:** CEO needs to escalate something.
**Handling:** `buildEscalationChain()` skips the "ceo" step for the CEO role (checks `if (agentRole !== "ceo")`). CEO's chain is: retry → human_founder.
**User sees:** CEO's escalation protocol shows only 2 steps.

### Intelligence — All Features Disabled

**Scenario:** User sets `autonomy.enabled: false`, `escalation.enabled: false`, `skills.enabled: false` in config.
**Handling:** Each context provider checks the `enabled` flag and returns empty string. No prompt context injected.
**User sees:** Zero behavior change from pre-Session-3 behavior. System works exactly as before.

### Intelligence — Skills Scalar in Frontmatter

**Scenario:** Agent frontmatter uses `skills: code_review` (scalar string) instead of a YAML array (`skills:\n  - code_review`).
**Handling:** `resolveAgentSkills()` accepts `string | string[] | undefined`. Scalar strings are wrapped in a single-element array. Without this, spreading a string `[..."code_review"]` would produce `["c","o","d","e","_","r",...]`.
**User sees:** Nothing — skill resolves correctly regardless of YAML format.

### Intelligence — Chain Override Includes human-founder

**Scenario:** Config `chain_overrides.cto` includes `"human-founder"` as one of the targets.
**Handling:** After building the custom chain, `buildEscalationChain()` checks if the last step already targets `"human-founder"` before appending the always-present final step. Prevents duplicate.
**User sees:** Nothing — chain has exactly one human_founder step at the end.

### Intelligence — Chain Override Excess Targets

**Scenario:** Config `chain_overrides.cto` has 6 targets but only 4 custom slots are available (retry and human_founder are fixed).
**Handling:** `buildEscalationChain()` logs a `console.warn` about excess targets. Extra targets are silently dropped — only the first 4 are used.
**User sees:** Warning in terminal: `Warning: chain_overrides.cto has 6 targets but only 4 are used (retry and human_founder are fixed).`

### Intelligence — Config Section is Non-Object

**Scenario:** User writes `skills: "on"` or `autonomy: true` (scalar instead of object) in the config YAML.
**Handling:** All three validators (`validateAutonomyConfig`, `validateEscalationConfig`, `validateSkillsConfig`) check `typeof raw !== "object"` and return an error immediately.
**User sees:** Config validation error: `skills must be an object (not a scalar)`.

### Intelligence — Config Array Elements are Non-Strings

**Scenario:** User writes `autonomy.overrides.cto.grant: [true, 42]` (non-string array elements).
**Handling:** Validators check `.some((x) => typeof x !== "string")` on all array fields (`grant`, `restrict`, `add`, `remove`, `chain_overrides.*`).
**User sees:** Config validation error: `autonomy.overrides.cto.grant items must be strings`.

### Intelligence — Context Provider Performance

**Scenario:** Three context providers each call `loadAgentDefinitions()` which reads all soul.md files from disk.
**Handling:** With 8 small .md files, each call takes < 10ms. Total: ~30ms. Not a concern for session startup.
**Future optimization:** Cache agent definitions across providers within a single `gatherExtensionContext()` call — deferred to a future release.

### Cost Recording — Unknown Model

**Scenario:** SDK returns a model ID that doesn't start with "claude-opus" or "claude-haiku" (e.g., a new model family)
**Handling:** Assigned to sonnet tier via prefix-match heuristic (`startsWith`). `toSDKShortName()` logs a `console.warn` on fallback. Uses sonnet-tier fallback pricing ($3/$15 per M tokens).
**User sees:** `Unknown model "claude-future-5" — falling back to sonnet tier`

### Cost Recording — SDK Reports $0 Cost

**Scenario:** SDK's `costUSD` field is exactly 0 for a model usage entry
**Handling:** Treated as "SDK didn't calculate cost" rather than "genuinely free." Falls back to estimated pricing from model router's `getFallbackPricing()`.
**User sees:** Nothing — cost is recorded using estimated pricing instead of $0.

### Engine — Test State Leak

**Scenario:** A test calls `setEngine(mockEngine)` but doesn't clean up, leaving the mock in place for subsequent tests
**Handling:** `resetEngine()` clears the singleton. Call in test teardown (`afterEach`) to restore default behavior.
**User sees:** N/A — developer/test concern only.

## Task Management

### Tasks — Circular Blocker Dependency

**Scenario:** User or agent tries to add a blocker that would create a cycle (e.g., A blocks B, then B blocks A).
**Handling:** `addBlocker()` runs BFS cycle detection starting from `blockerId` and following existing blocker edges. If `taskId` is reachable from `blockerId`, adding the edge would create a cycle, so it throws an error. (Fixed in peer review — original implementation started from `taskId` looking for `blockerId`, which missed cycles because it traversed edges in the wrong direction.)
**User sees:** "Adding this blocker would create a cycle" — the blocker is not added.

### Tasks — TASK::CREATE with Fields in Any Order

**Scenario:** Agent outputs `TASK::CREATE title="Test" priority=high department=engineering` (priority before department).
**Handling:** Regex matches the title first, then scans the remainder for individual key=value pairs in any order.
**User sees:** Nothing — task created correctly regardless of field order.

### Tasks — Natural Language False Positive Prevention

**Scenario:** Agent says "I completed 5 items in the backlog" (not referring to task #5).
**Handling:** Natural language patterns now require the word "task" before `#N`. "completed 5 items" won't match; "completed task #5" will.
**User sees:** Nothing — only genuine task references trigger updates.

### Tasks — Message Handler projectDir Bridging

**Scenario:** The task message handler needs `projectDir` but the handler API doesn't pass it.
**Handling:** The context provider sets module-level `lastProjectDir` during each session. The message handler reads it. One session per process, so no cross-session contamination.
**User sees:** Nothing — TASK:: markers in agent output are processed correctly.

### Tasks — Blocked Filter

**Scenario:** User runs `aicib tasks list --blocked` to see tasks waiting on other work.
**Handling:** SQL subquery checks for unfinished blockers (`status NOT IN ('done', 'cancelled')`). Tasks with only completed blockers are NOT shown as blocked.
**User sees:** Only tasks that are genuinely stuck waiting for other unfinished work.

### Tasks — Column Whitelist in Updates

**Scenario:** Message handler passes a `Record<string, unknown>` to `updateTask()` — keys come from parsed agent output.
**Handling:** `updateTask()` checks each key against `ALLOWED_COLUMNS` set. Unknown keys silently skipped.
**User sees:** Nothing — only valid task fields are updated.

### Tasks — Multiple CLI Update Flags

**Scenario:** User runs `aicib tasks update 5 --status done --priority high --assign cto`.
**Handling:** All field changes collected into one object, applied in a single `updateTask()` call. Comment added separately.
**User sees:** One "Task Updated" confirmation with all changes listed.

### Tasks — Flush Failures Logged

**Scenario:** Database write fails during debounced task update flush (e.g., disk full, table locked).
**Handling:** Individual update failures logged via `console.warn("Task update failed:", e)`. Outer DB connection failures logged via `console.warn("Task flush DB error:", e)`. Other queued updates continue.
**User sees:** Warning in terminal. Agent session not interrupted.

### Tasks — Fresh Project (No Tables Yet)

**Scenario:** User runs `aicib tasks` before ever running `aicib start` (which creates DB tables via CostTracker.init).
**Handling:** `TaskManager` constructor calls `ensureTables()` which runs `CREATE TABLE IF NOT EXISTS` for all 3 task tables + indexes. Safe to run alongside CostTracker since both use `IF NOT EXISTS`.
**User sees:** Empty task board — no crash.

### Tasks — TASK::CREATE with Empty Title

**Scenario:** Agent outputs `TASK::CREATE title=""` (empty title).
**Handling:** Message handler checks `if (!title?.trim()) break;` before calling `createTask()`. Empty or whitespace-only titles are silently skipped.
**User sees:** Nothing — no task created.

### Tasks — max_context_tasks Set to Zero

**Scenario:** User sets `tasks.max_context_tasks: 0` in config to disable task board injection.
**Handling:** Context provider returns `""` immediately when `maxTasks === 0`. `listTasks()` also guards with `limit != null && limit > 0` so `0` doesn't become unlimited.
**User sees:** No task board in agent prompts. Tasks still exist in DB and are accessible via `aicib tasks`.

## Projects (Long Autonomous Task Chains)

### Project — sendBrief() Throws Mid-Phase

**Scenario:** `sendBrief()` throws during phase execution (network error, API failure, cost limit mid-run).
**Handling:** Try/catch around the entire phase execution block. Marks the current phase as `"failed"` with the error message and `completed_at`. Adds prior accumulated costs to project totals. Marks project as `"failed"`. Breaks out of loop — normal completion logic updates the background job.
**User sees:** Phase shows as FAILED in `aicib project status`. `aicib logs` shows the error.

### Project — External Cancellation While Phase Running

**Scenario:** User runs `aicib project cancel` while a phase is actively executing.
**Handling:** Cancel sets project status to `"cancelled"` in DB and sends SIGTERM to the worker. At the top of each loop iteration, the worker re-reads project status. If `"cancelled"` or `"paused"`, it breaks out. Even if SIGTERM delivery fails (race, permission), the DB check catches it.
**User sees:** `aicib project status` shows project as "cancelled". Worker stops after current phase's `sendBrief()` returns.

### Project — Cancel Uses Correct Session ID

**Scenario:** User runs `aicib stop` then `aicib start` (new session), then `aicib project cancel`. The active CLI session differs from the session that spawned the project.
**Handling:** `projectCancelCommand()` looks up the background job using the project's own `session_id` (from the `projects` table), not the current CLI session.
**User sees:** Cancel works correctly regardless of session changes.

### Project — Cost Under-Counting on Failed Phase

**Scenario:** A phase is rejected 3 times (max retries). Each attempt costs $2. Only the last attempt's cost was being recorded in the project totals.
**Handling:** The failed-phase branch now computes accumulated totals from all retry attempts (same pattern as the approved-phase branch): `phaseTotalCost = phase.cost_usd + phaseResult.totalCostUsd`. These accumulated values are used in both `updatePhase()` and `updateProject()`.
**User sees:** `aicib project status` shows correct total cost including all retry attempts.

### Project — Duplicate Phase Numbers

**Scenario:** A bug or race condition tries to insert two phases with the same `phase_number` for the same project.
**Handling:** `UNIQUE(project_id, phase_number)` constraint on the `project_phases` table. SQLite rejects the duplicate insert.
**User sees:** Error during planning phase. Project fails with clear error message.

### Project — Daily Cost Limit Hit Between Phases

**Scenario:** Phase 3 completes but today's total cost now exceeds the daily limit.
**Handling:** Cost limit checked at the top of each loop iteration before starting the next phase. Project status set to `"paused"`.
**User sees:** `aicib project status` shows "paused". Can resume tomorrow or after increasing the limit.

### Project — SIGTERM Between Phases

**Scenario:** `aicib stop` sends SIGTERM while the worker is between phases (e.g., checking loop conditions).
**Handling:** `sigtermReceived` flag is set. Checked at the top of each loop iteration. Project status set to `"paused"`.
**User sees:** Project shows as "paused". Background job shows as "completed" (graceful stop).

### Tasks — Natural Language Multiple Task References

**Scenario:** Agent says "Completed task #5 and task #3" in a single message.
**Handling:** NL patterns use `.matchAll()` with the `g` flag instead of `.match()` (first match only). Both task #5 and #3 are updated to "done".
**User sees:** Both tasks updated — not just the first one mentioned.

## Knowledge Management

### Knowledge — Wiki Slug Uniqueness

**Scenario:** Agent or user tries to create a wiki article with a slug that already exists.
**Handling:** `wiki_articles.slug` has a UNIQUE constraint. `createArticle()` in the CLI checks for existing slug before insert. The DB constraint provides a safety net for the message handler path.
**User sees:** CLI: "Article with slug 'X' already exists." Message handler: silent skip (best-effort).

### Knowledge — Wiki Update Snapshots Previous Version

**Scenario:** Wiki article is updated — previous content must be preserved.
**Handling:** `updateArticle()` wraps the version snapshot INSERT and article UPDATE in a `db.transaction()` to ensure atomicity. If a crash occurs between the two statements, neither takes effect — no orphan version rows.
**User sees:** `aicib knowledge wiki history <slug>` shows all previous versions.

### Knowledge — Natural Language False Positive Prevention

**Scenario:** Agent says "I learned a lot" (too short to be useful as a journal entry).
**Handling:** Natural language patterns require at least 10 characters in the captured text. Short matches like "I learned a lot" (matched text: "a lot" = 5 chars) are silently skipped.
**User sees:** Nothing — no spurious journal entries created.

### Knowledge — Message Handler projectDir Bridging

**Scenario:** The knowledge message handler needs `projectDir` but the handler API doesn't pass it.
**Handling:** Same pattern as task-register.ts: context provider sets module-level `lastProjectDir` during each session. Message handler reads it. One session per process.
**User sees:** Nothing — KNOWLEDGE:: markers in agent output are processed correctly.

### Knowledge — Flush Failures Logged

**Scenario:** Database write fails during debounced knowledge update flush (disk full, table locked).
**Handling:** Individual update failures logged via `console.warn("Knowledge update failed:", e)`. Other queued updates continue.
**User sees:** Warning in terminal. Agent session not interrupted.

### Knowledge — Fresh Project (No Tables Yet)

**Scenario:** User runs `aicib knowledge` before ever running `aicib start`.
**Handling:** `KnowledgeManager` constructor calls `ensureTables()` with `CREATE TABLE IF NOT EXISTS` for all 5 tables + indexes. Safe to run alongside CostTracker.
**User sees:** Empty knowledge dashboard — no crash.

### Knowledge — Context Provider Returns Empty for New Projects

**Scenario:** No wiki articles, decisions, or archives exist yet.
**Handling:** Context provider checks if each formatted section is empty. If all are empty, returns `""` — no context injected.
**User sees:** Nothing — no empty headers in agent prompt.

### Knowledge — All Features Disabled

**Scenario:** User sets `knowledge.enabled: false` in config.
**Handling:** Context provider returns `""`. Message handler returns immediately without parsing. CLI commands still work (they access the DB directly).
**User sees:** No knowledge context in agent prompts. CLI still functional for manual management.

### Knowledge — Search With Empty Keyword

**Scenario:** Internal search with empty string (used by journals listing).
**Handling:** `LIKE '%%'` matches all rows. Results still respect the limit parameter.
**User sees:** All entries up to the limit.

### Knowledge — Archive Search With Null completed_at

**Scenario:** Searching returns `on_hold` archives that have no `completed_at` date. `new Date("").getTime()` produces NaN, causing undefined sort order.
**Handling:** Archive search falls back to `started_at` when `completed_at` is null. The sort comparator uses `|| 0` as a final fallback for truly empty dates, placing them at the end.
**User sees:** Search results in consistent chronological order regardless of archive status.

### Knowledge — Context Provider DB Error

**Scenario:** Knowledge database can't be opened during context injection (e.g., first run before `aicib start`, corrupted DB, permissions).
**Handling:** Context provider catches the error and logs via `console.warn("Knowledge context error:", e)`. Returns empty string — agent starts without knowledge context.
**User sees:** Warning in terminal. Agent session starts normally without knowledge context.

### Knowledge — Debounced Queue Multiple Markers

**Scenario:** Agent outputs multiple KNOWLEDGE:: markers in a single message.
**Handling:** All markers are parsed and queued. The 500ms debounce timer batches them into a single DB flush.
**User sees:** Nothing — all entries created efficiently in one batch.

## Web Dashboard

### Dashboard — No Database Found

**Scenario:** User runs `aicib ui` before running `aicib init`, so `.aicib/state.db` doesn't exist.
**Handling:** `lib/db.ts` throws an error with a clear message. API routes catch it and return HTTP 500 with `"Database not found at <path>. Run 'aicib init' and 'aicib start' first."`.
**User sees:** Dashboard loads but KPI cards and agent grid show no data. Browser console shows the error. Brief submission shows an error message.

### Dashboard — No Config File Found

**Scenario:** `AICIB_PROJECT_DIR` is not set and the current directory has no `aicib.config.yaml` up the tree.
**Handling:** `lib/config.ts` throws `"Could not find aicib.config.yaml"`. API routes return HTTP 500.
**User sees:** Dashboard layout renders (sidebar, topbar) but content area shows error state. The `aicib ui` command sets `AICIB_PROJECT_DIR` so this mainly happens when running `npm run dev` manually from the wrong directory.

### Dashboard — No Active Session

**Scenario:** User opens dashboard after `aicib init` but before `aicib start`.
**Handling:** `/api/status` returns `session: { active: false }`. Agent statuses default to "stopped". Brief submission returns HTTP 400 with `"No active session. Run 'aicib start' first."`.
**User sees:** KPI Session card shows "Inactive" badge. All agents show gray "stopped" dots. Brief input shows error message when trying to send.

### Dashboard — Brief Already Running

**Scenario:** User submits a brief from the dashboard while another brief is still executing.
**Handling:** `/api/brief` checks `background_jobs` for running jobs with an alive PID (via `process.kill(pid, 0)`). Returns HTTP 409.
**User sees:** Error message: `"A brief is already running (job #N). Wait for it to complete."`.

### Dashboard — Brief With Dead PID

**Scenario:** A background job has status "running" in the DB but the process has actually exited (crashed, killed externally).
**Handling:** `/api/brief` tries `process.kill(pid, 0)` which throws for dead processes. The check falls through and allows a new brief to be submitted.
**User sees:** Brief submits successfully despite stale "running" job in DB.

### Dashboard — SSE Database Locked

**Scenario:** SQLite database is temporarily locked by a write operation from a running agent (e.g., cost recording, log writing).
**Handling:** The SSE polling loop wraps all queries in try/catch. On lock errors, skips that poll cycle and tries again 2 seconds later. The 5s busy timeout on the connection handles brief locks.
**User sees:** At most a 2-second delay in live updates. No visible error.

### Dashboard — SSE Client Disconnect

**Scenario:** User closes browser tab or navigates away while SSE stream is open.
**Handling:** The `ReadableStream.cancel()` callback closes the read-only SQLite connection and stops the polling interval.
**User sees:** Nothing — clean teardown on their end.

### Dashboard — SSE Auto-Reconnect

**Scenario:** SSE connection drops (server restart, network blip, Next.js hot reload during dev).
**Handling:** `useSSE()` hook detects the error, sets `connected: false`, waits 3 seconds, then reconnects. New connection initializes fresh watermarks.
**User sees:** Red "Disconnected" dot in topbar for ~3 seconds, then green "Live" returns. May miss events during disconnect but next `/api/status` fetch catches up.

### Dashboard — Config Parsing Fallback

**Scenario:** The YAML regex parser in `/api/status` fails to extract agents from an unusual config format (deeply nested workers, unusual indentation).
**Handling:** If regex parsing finds no agents, falls back to DB-only agent statuses. Agents will show `model: "unknown"` and `department: <role>`.
**User sees:** Agent cards still appear (from DB statuses) but without config-level info like model names.

### Dashboard — Port Already In Use

**Scenario:** User runs `aicib ui` but port 3000 is already taken by another app.
**Handling:** Next.js dev server exits with `EADDRINUSE` error. The `ui-launcher.ts` forwards the exit code.
**User sees:** Error in terminal: `"Error: listen EADDRINUSE: address already in use :::3000"`. Fix: use `aicib ui --port 3001`.

### Dashboard — First Run Auto-Install

**Scenario:** First time running `aicib ui` — `ui/node_modules/` doesn't exist.
**Handling:** `ui-launcher.ts` checks for `node_modules/` and runs `npm install` with inherited stdio before starting the dev server.
**User sees:** Terminal shows `"Installing UI dependencies (first run)..."` followed by npm install output. Takes ~15-20 seconds, then dashboard starts normally.

## Communication Routing

### Routing — Agent Without Department

**Scenario:** An agent without `department` in its frontmatter sends a cross-department message.
**Handling:** `evaluateRoute()` returns `{ allowed: true, requiresCC: [] }` when either department is empty. Routing rules don't apply.
**User sees:** Nothing — message proceeds without restriction. By design.

### Routing — Unknown Department in Strict Hierarchy

**Scenario:** Under `strict_hierarchy`, a message involves a department not in the `DEPARTMENT_HEADS` map.
**Handling:** `getDepartmentHead()` returns null for unknown departments. Neither sender nor receiver is recognized as a department head, so the message is blocked.
**User sees:** Violation logged: "Cross-department communication requires routing through department heads." CEO can always route cross-dept.

### Routing — Custom Rule with "custom" Mode

**Scenario:** User writes a custom rule with `mode: "custom"` (recursive).
**Handling:** `validateRoutingConfig()` catches this at config validation: "custom_rules[N].mode cannot be 'custom'."
**User sees:** Config validation error.

### Routing — NL Pattern False Positive

**Scenario:** Agent says "I'm contacting support" — "contacting support" matches the NL pattern but "support" isn't an agent.
**Handling:** `agentDepts.get("support")` returns undefined. Empty department means same-department check passes — no violation.
**User sees:** Nothing — no false positive.

## Review Chains

### Review — Duplicate REVIEW::APPROVE Markers

**Scenario:** Agent writes `REVIEW::APPROVE task_id=5` twice in one message, or writes both the structured marker and "approved task #5".
**Handling:** `flushPendingActions()` deduplicates by `(task_id, type)` before processing. Only the first action per task per type per batch is kept.
**User sees:** Nothing — chain advances exactly once.

### Review — No Reviewer Available on Submit

**Scenario:** A task is submitted for review but no reviewer is available for any layer in the chain (e.g., empty agents list).
**Handling:** After the skip-loop, if `firstReviewer` is null, task is set to `status: "done"` with comment "Review chain auto-completed (no available reviewers)."
**User sees:** Task goes straight to done. Comment explains why.

### Review — Keyword Misclassification

**Scenario:** Task titled "Implement marketing plan" could match "implement" (code) or "marketing plan" (marketing_internal).
**Handling:** `TYPE_KEYWORDS` is ordered with multi-word phrase categories before broad single-word categories. "marketing plan" is checked before "implement."
**User sees:** Correct chain type: marketing_internal, not code.

### Review — Comments in Same Second

**Scenario:** Chain start marker, skip comment, and review request are all written within the same second.
**Handling:** `getComments()` sorts by `created_at ASC, id ASC`. The auto-incrementing `id` is a deterministic tiebreaker.
**User sees:** Nothing — comments are always in the correct order.

### Review — Rejection Resets Chain

**Scenario:** Task is approved through layer 1, then rejected at layer 2. Assignee fixes and re-submits.
**Handling:** Re-submit writes a new CHAIN_START_MARKER. `getReviewChainState()` only counts approvals after the most recent marker. Stale layer-1 approval doesn't carry over.
**User sees:** Chain restarts from layer 1 after re-submission.

### Review — Pending Actions Lost on Exit

**Scenario:** Process exits within the 500ms debounce window, before `flushPendingActions()` fires.
**Handling:** Not handled — known architectural limitation shared with task-register.ts. Actions in the queue are lost. Should be addressed as a cross-cutting `beforeExit` handler issue.
**User sees:** Last batch of review actions may not be recorded.

### Review — CLI `aicib tasks review` Bypasses Chain

**Scenario:** Founder runs `aicib tasks review` and approves/rejects directly.
**Handling:** `submitReview()` sets done/in_progress directly, bypassing the chain. By design — the CLI is the human founder's override. The founder IS the "owner" layer.
**User sees:** Task goes directly to done or in_progress.

## External Safeguards & Trust Evolution

### Safeguards — Expiry Datetime Format

**Scenario:** `expires_at` is stored in the DB and compared with `datetime('now')`. If formats differ (ISO `T` separator vs SQLite space), lexicographic comparison fails silently — expired actions never get cleaned up.
**Handling:** `expires_at` is formatted with `.toISOString().replace("T", " ").slice(0, 19)` to match SQLite's `datetime('now')` format exactly.
**User sees:** Nothing — expiry works correctly. Expired actions are cleaned up on read.

### Safeguards — Trust Disabled But Chain Still Modified

**Scenario:** User sets `trust.enabled: false` but `resolveTrustLevel()` still computes trust from history and modifies approval chains.
**Handling:** `processSafeguardAction` short-circuits to `"probationary"` when trust is disabled. Probationary has empty modification lists, so no chain changes occur.
**User sees:** Full approval chains always apply when trust is disabled.

### Safeguards — Autonomy Cap Not Applied

**Scenario:** A restricted/guided agent gets trust-modified (shortened) approval chains because autonomy config wasn't passed to `resolveTrustLevel()`.
**Handling:** `lastAutonomyConfig` is cached from both the context provider and message handler, then passed to `resolveTrustLevel()`. Restricted/guided agents are capped at `established` trust.
**User sees:** Restricted agents always go through full approval chains regardless of their action history.

### Safeguards — Action Expiry (48h default)

**Scenario:** A pending action sits unreviewed for more than 48 hours.
**Handling:** Expire-on-read pattern: every query that reads pending actions first runs `UPDATE ... SET status = 'expired' WHERE expires_at < datetime('now')`. No background job needed.
**User sees:** `aicib safeguards pending` won't show expired actions. `aicib safeguards approve <id>` returns "not found, not pending, or expired."

### Safeguards — Max Pending Per Agent

**Scenario:** Agent already has 10 pending actions (default limit) and tries to request another.
**Handling:** `processSafeguardAction` checks `pendingCount >= max_pending_per_agent` before inserting. Silently drops the request.
**User sees:** Nothing — the 11th request is not created. Agent should resolve existing actions first.

### Trust — Recommendation Threshold (2 of 3)

**Scenario:** Agent meets action count and approval rate but not age requirement for the next trust level.
**Handling:** `getTrustRecommendations()` surfaces agents meeting 2 of 3 criteria. Operator can apply early override with `aicib trust set`.
**User sees:** Agent appears in `aicib trust recommendations` with progress details.

### Trust — Manual Override Capped by max_level

**Scenario:** Operator sets `aicib trust set cto --category code_deployment --level veteran` but config has `max_level: trusted`.
**Handling:** `resolveTrustLevel()` applies the `max_level` cap AFTER override resolution. Override of "veteran" is capped to "trusted".
**User sees:** `aicib trust` shows effective level as "trusted" even though the override says "veteran".

### Safeguards — NL Fallback Hardcodes agent=ceo

**Scenario:** Natural language pattern "requesting approval for social_media" is detected without an explicit agent.
**Handling:** NL fallback assigns `agent: "ceo"` — same pattern as other register files (e.g., HR NL assigns `department: "general"`). REQUEST only creates pending actions, never auto-approves. Structured SAFEGUARD:: markers are the primary interface.
**User sees:** Nothing — pending action created for CEO. CEO can approve/reject via structured markers.

## Data Export/Import

### Export — DB Connection Leak on Error

**Scenario:** Export opens state.db in read-only mode but an error occurs during table iteration (e.g., corrupted table, disk full writing JSON files).
**Handling:** DB open and close wrapped in `try/finally`. `db.close()` always executes regardless of errors.
**User sees:** Error message from the CLI. No leaked DB connections.

### Export — Partial Export Cleanup

**Scenario:** Export creates the export directory and starts writing files, but fails mid-process (e.g., disk full, tar compression fails).
**Handling:** `exportCompanyData()` body wrapped in `try/catch` that calls `fs.rmSync(exportDir, { recursive: true })` on any error, then re-throws.
**User sees:** Error message. No partial export directory left on disk.

### Import — Tar Extraction Failure

**Scenario:** Archive is corrupted or tar command fails. tempDir was created but extraction didn't complete.
**Handling:** Tar extraction moved inside the `try` block whose `finally` always cleans up tempDir. Cleanup runs whether extraction fails, validation fails, or import fails.
**User sees:** Error from tar command. No leftover temp directory.

### Export/Import — Invalid Table Name in SQL

**Scenario:** A table name in CATEGORY_TABLES somehow contains special characters (defense-in-depth, shouldn't happen with current constants).
**Handling:** `VALID_TABLE_NAME` regex (`^[a-z0-9_]+$`) checked before any SQL construction in both export and import. Invalid names silently skipped.
**User sees:** Nothing — invalid table names are skipped without error.

### Export — Secret Pattern False Positives

**Scenario:** Config key "author" or "authorized_at" or "auth_method" is redacted to `{{REDACTED}}` by the overly broad `/auth/i` pattern.
**Handling:** Replaced `/auth/i` with specific patterns: `/auth_token/i`, `/auth_secret/i`, `/oauth_token/i`, `/oauth_secret/i`. Structural fields like "author" are preserved.
**User sees:** Correct config export — structural fields intact, only actual secrets redacted.

### Import — DB Connection Leak on Transaction Error

**Scenario:** Import opens state.db writable, but the transaction fails (e.g., constraint violation, disk full).
**Handling:** DB open and close wrapped in `try/finally` inside the data import block. `db.close()` always executes.
**User sees:** Error message. No leaked DB connections.

### Dashboard — Tasks Table Missing

**Scenario:** Database exists but `tasks` table hasn't been created yet (happens if `aicib start` was run before task management was added, or on very old DB versions).
**Handling:** `/api/status` and `/api/stream` wrap task queries in try/catch. Return zero counts on error.
**User sees:** Active Tasks KPI shows 0. No error visible.

## Agent Scheduler

### Scheduler — Invalid Cron on Non-Interactive Create

**Scenario:** Agent marker `SCHEDULE::CREATE name="Test" cron="not-valid" directive="..."` or programmatic `createSchedule()` with an invalid cron expression.
**Handling:** `createSchedule()` validates the cron expression with `parseExpression()` before inserting. Throws with a clear error message including the invalid expression and parser error.
**User sees:** Error: `Invalid cron expression "not-valid": ...`. Schedule is not created.

### Scheduler — Trigger Dedupe Key Collision

**Scenario:** Agent output contains both a `task_completed` trigger for task #5 and a `project_completed` trigger in the same message batch.
**Handling:** Dedupe key for trigger actions uses `trigger:${triggerType}:${triggerValue}` instead of `undefined:trigger`. Different trigger types/values are preserved as separate actions.
**User sees:** Nothing — both triggers fire correctly instead of only one surviving deduplication.

### Scheduler — Running Schedule Stuck During Quiet Hours

**Scenario:** A scheduled job is running when quiet hours begin. The daemon's early-return guard would previously skip `checkCompletedSchedules()`, leaving the schedule stuck as "running" indefinitely.
**Handling:** `checkCompletedSchedules()` runs before quiet-hours/cost/session guards. Running jobs get their completion status updated regardless.
**User sees:** Schedule correctly transitions to idle/error after its background job finishes, even during quiet hours.

### Scheduler — Cost Limit Per Run Exceeded (Pre-Execution)

**Scenario:** A schedule's historical average cost per run exceeds `cost_limit_per_run`. Without enforcement, it would keep running and exceeding the budget.
**Handling:** Before spawning, daemon checks `total_cost_usd / run_count > cost_limit_per_run`. If exceeded, schedule is marked as error with a message showing the average cost vs the limit.
**User sees:** Schedule status shows "error" with message like `Average cost per run ($6.50) exceeds cost_limit_per_run ($5.00)`.

### Scheduler — Cost Limit Per Run Exceeded (Post-Execution)

**Scenario:** A single execution finishes and its cost exceeds `cost_limit_per_run`.
**Handling:** After job completion in `checkCompletedSchedules()`, daemon checks if `job.total_cost_usd > cost_limit_per_run`. If exceeded, schedule is put in error state instead of returning to idle.
**User sees:** Schedule shows "error" with message like `Last execution cost ($7.20) exceeded cost_limit_per_run ($5.00)`.

### Scheduler — Missed Run Policy Skip

**Scenario:** Daemon was stopped for hours and restarts. Multiple schedules have `next_run_at` far in the past. With `missed_run_policy: "skip"`, they shouldn't all fire at once.
**Handling:** If `next_run_at` is overdue by more than `poll_interval_seconds * 2`, daemon recomputes `next_run_at` to the next future occurrence and records a "skipped" execution.
**User sees:** Skipped schedules show in execution history as "skipped". Next run is set to the proper future time.

### Scheduler — Dynamic SQL Column Whitelist

**Scenario:** `updateSchedule()` or `updateExecution()` receives an object with unexpected keys (e.g., from a future code path or unexpected caller).
**Handling:** Both methods check each key against `ALLOWED_SCHEDULE_COLUMNS` / `ALLOWED_EXECUTION_COLUMNS` sets. Unknown keys are silently skipped (matches `task-manager.ts` pattern).
**User sees:** Nothing — only valid columns are updated.

## Reporting Suite

### Reporting — Invalid Delivery Method in CLI

**Scenario:** User passes `--delivery email` which is not a valid delivery method.
**Handling:** CLI validates against `VALID_DELIVERY_METHODS` before creating the report. Exits with clear error.
**User sees:** `Error: Invalid delivery method "email". Valid: slack, file, both`

### Reporting — Report Content Capture on COMPLETE

**Scenario:** Agent emits `REPORT::COMPLETE id=42` in a message. Previous behavior: report status updated to completed but content field stayed empty forever.
**Handling:** The message handler captures the full assistant message text, strips the `REPORT::COMPLETE id=N` marker, and saves the cleaned text as report content.
**User sees:** Report content is visible in `aicib report show <id>`.

### Reporting — Directive Contains Literal `<report_id>` Placeholder

**Scenario:** `buildReportDirective()` emitted `REPORT::COMPLETE id=<report_id>` as a literal string. Agent would emit this literally, and the regex `id=(\d+)` wouldn't match.
**Handling:** `buildReportDirective()` now takes a `reportId: number` parameter and injects the real ID into the directive.
**User sees:** Report completion works end-to-end.

### Reporting — listReports with limit=0

**Scenario:** Config has `max_context_reports: 0` (meaning "show none"). Old code treated `0` as falsy, so no LIMIT clause was added and all reports were returned.
**Handling:** Changed check to `filter?.limit !== undefined && filter.limit > 0`.
**User sees:** Setting `max_context_reports: 0` correctly returns no reports in context.

## Automated Performance Reviews

### Auto-Reviews — Trigger Mode "periodic" Queues Task Completions

**Scenario:** Config has `trigger: "periodic"` but task completions still queue auto-reviews.
**Handling:** Message handler now checks `triggerMode` before processing task completions. Only `"task_completed"` and `"both"` queue reviews on task completion. `AUTOREVIEW::PROCESS` and `AUTOREVIEW::SKIP` markers are always honored regardless of trigger mode.
**User sees:** Setting `trigger: periodic` prevents task-completion-based queueing.

### Auto-Reviews — Quality Score Counts Non-Review Comments

**Scenario:** `task_comments` contains general comments, review requests, etc. Old query counted ALL comments in the denominator but only `review_result` rows in the numerator, deflating the approval rate.
**Handling:** Both numerator and denominator now filter on `comment_type = 'review_result'`. Pattern match uses `LIKE 'approved%'` (no leading `%`) to avoid matching "not approved".
**User sees:** More accurate quality scores that reflect actual review outcomes.

### Auto-Reviews — Concurrent Queue Claim Race Condition

**Scenario:** Two concurrent workers call `processAutoReviewQueue()`. Both SELECT the same pending rows, both UPDATE to processing, both process the same reviews (duplicate reviews created).
**Handling:** Replaced two-step SELECT+UPDATE with an atomic `db.transaction()` that claims one entry at a time. Second worker skips already-claimed entries.
**User sees:** No duplicate auto-reviews.

### Auto-Reviews — SQL Injection via windowDays

**Scenario:** `windowDays` parameter interpolated directly into SQL template strings. If a non-integer value were passed, it could corrupt the query.
**Handling:** Value is clamped to `Math.max(1, Math.min(365, Math.floor(windowDays)))` and all queries use `datetime('now', ?)` with bound parameters instead of string interpolation.
**User sees:** No change in behavior; defense-in-depth fix.

## Notification System

### Notifications — Async/Close Race in Scheduler Daemon

**Scenario:** `processNotifications()` calls `nm.processNotificationQueue()` (async, may do Slack HTTP calls) but the `finally` block closes the DB immediately while delivery is in flight.
**Handling:** `NotificationManager.processQueue()` static method opens its own DB connection, awaits the full queue processing, and closes in its own `finally` block. The scheduler daemon calls this fire-and-forget with `.catch()`.
**User sees:** Nothing — Slack delivery completes correctly instead of failing with a closed DB.

### Notifications — Digest Batches Never Delivered

**Scenario:** Medium/low urgency notifications are batched by `buildDigestBatches()` which marks them as "batched", but `processNotificationQueue()` only counted them without calling `markDelivered()`.
**Handling:** After building digest batches, `markDelivered(ids, "digest")` is called for each batch. Items progress from "batched" to "delivered" status.
**User sees:** Nothing — notifications don't get stuck in "batched" status forever.

### Notifications — Slack bot_token Table Missing

**Scenario:** `deliverViaSlack()` queries `slack_state` table for `bot_token`, but Slack integration hasn't been set up yet.
**Handling:** `this.db.prepare(...)` wrapped in try-catch. Missing table falls through to `botToken = null`, which triggers dashboard fallback delivery.
**User sees:** Notification delivered to dashboard instead of Slack.

### Notifications — Quiet Hours Critical Override

**Scenario:** It's 2 AM (quiet hours) and a critical system error notification is created.
**Handling:** `getPendingPushNotifications()` filters by quiet hours but exempts `urgency === "critical"`. Critical notifications always push through.
**User sees:** Critical alerts arrive immediately regardless of quiet hours.

## Company Events

### Events — SCHEDULED Prefix Blocks EVENT Detection

**Scenario:** Scheduler daemon prepends `[SCHEDULED::42]` to every directive. Background worker receives `[SCHEDULED::42] [EVENT::5::0] Facilitate Daily Standup...`. The regex `^\[EVENT::` is anchored to start and never matches.
**Handling:** Background worker strips optional `[SCHEDULED::N]` prefix before pattern matching: `directive.replace(/^\[SCHEDULED::\d+\]\s*/, "")`. Stripped version is also passed to `runEventBrief()`.
**User sees:** Nothing — scheduled events now correctly route through `runEventBrief()` instead of `runSingleBrief()`.

### Events — Malformed participants_config JSON

**Scenario:** `participants_config` column contains invalid JSON (corruption, manual DB edit, schema migration).
**Handling:** `JSON.parse()` wrapped in try-catch at 3 call sites. Defaults to `{ mode: "all" }` for config objects and `[]` for participant arrays.
**User sees:** Event runs with all participants instead of crashing.

### Events — Action Item task_id Not Written Back

**Scenario:** Action items are extracted and tasks created, but `task_id` is never set on the action items. `formatForContext()` filters by `!a.task_id`, so all action items always appear as "pending".
**Handling:** After `tm.createTask()`, `item.task_id = task.id` is set. After the loop, `em.updateInstance(instance.id, { action_items: JSON.stringify(actionItems) })` writes enriched items back.
**User sees:** Action items with tasks no longer appear in "pending action items" context section.

### Events — Participant Resolution Empty Department

**Scenario:** Department mode with no matching departments in org tree.
**Handling:** `resolveParticipants()` falls back to `flattenTree(tree)` (all agents) when filtered roles array is empty.
**User sees:** Event includes all agents instead of none.

### Events — Event Without Cron Expression

**Scenario:** Event created without `cron_expression` — exists in DB but has no schedule.
**Handling:** No schedule is created (guarded by `if (!event.cron_expression)`). Event can be triggered manually via CLI or agent markers.
**User sees:** Event appears in list but has no `next_run_at` date.
