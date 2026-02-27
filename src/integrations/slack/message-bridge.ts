/**
 * Bidirectional bridge between AICIB agent messages and Slack.
 *
 * Outbound: SDK messages → Slack channels (via registered MessageHandler)
 * Inbound:  Slack messages → sendBrief() pipeline (via BriefQueue)
 */

import type { WebClient } from "@slack/web-api";
import type { EngineMessage } from "../../core/engine/index.js";
import type { MessageHandler } from "../../core/agent-runner.js";
import type { AicibConfig } from "../../core/config.js";
import type { CostTracker } from "../../core/cost-tracker.js";
import type { SlackConfig, ChannelMapping } from "./types.js";
import { formatForSlack, formatRoleName } from "./message-formatter.js";
import { resolveChannel, trackTaskNotification, clearToolUseTracking } from "./channel-mapper.js";
import { DEPARTMENT_CHANNEL_MAP, ROLE_EMOJI } from "./types.js";
import { sendBrief, recordRunCosts, generateJournalEntry } from "../../core/agent-runner.js";
import { loadConfig } from "../../core/config.js";
import type { SessionLock } from "./chat-handler.js";

// --- Outbound: AICIB → Slack ---

/**
 * Creates a MessageHandler function that forwards SDK messages to Slack.
 * Register with `registerMessageHandler('slack-bridge', handler)`.
 */
export function createSlackMessageHandler(
  client: WebClient,
  mappings: Map<string, ChannelMapping>,
  slackConfig: SlackConfig,
  getThreadTs: () => string | undefined
): MessageHandler {
  return (msg: EngineMessage, _config: AicibConfig) => {
    // Track task notifications for channel routing
    trackTaskNotification(msg);

    // Format the message for Slack
    const payload = formatForSlack(msg);
    if (!payload) return;

    // Determine which channel to post to
    const channel = resolveChannel(msg, mappings);
    if (!channel) return;

    // Build post options
    const postOptions: {
      channel: string;
      text: string;
      blocks: unknown[];
      thread_ts?: string;
      unfurl_links?: boolean;
      username?: string;
      icon_emoji?: string;
    } = {
      channel: channel.channelId,
      text: payload.text,
      blocks: payload.blocks,
      unfurl_links: false,
    };

    // Override bot display name with agent role (requires chat:write.customize scope)
    if (payload.role) {
      postOptions.username = formatRoleName(payload.role, slackConfig.custom_display_names);
      const emoji = ROLE_EMOJI[payload.role];
      if (emoji) postOptions.icon_emoji = emoji;
    }

    // Thread replies in CEO channel for continuity
    if (slackConfig.thread_replies && channel.department === "ceo") {
      const activeThread = getThreadTs();
      if (activeThread) {
        postOptions.thread_ts = activeThread;
      }
    }

    // Post asynchronously — don't block the message stream
    client.chat.postMessage(postOptions).catch((error) => {
      console.warn(`  Warning: Failed to post to Slack #${channel.channelName}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
}

// --- Inbound: Slack → AICIB ---

/**
 * Handles a brief submitted from Slack. Validates session state,
 * checks cost limits, and queues the brief for processing.
 */
export async function handleSlackBrief(
  text: string,
  projectDir: string,
  costTracker: CostTracker,
  briefQueue: BriefQueue,
  meta?: { channelId?: string; threadTs?: string }
): Promise<{ success: boolean; message: string; position?: number }> {
  // Check for active session
  const activeSession = costTracker.getActiveSDKSessionId();
  if (!activeSession) {
    return {
      success: false,
      message: "No active session. Run `aicib start` first.",
    };
  }

  // Check daily cost limit
  let config: AicibConfig;
  try {
    config = loadConfig(projectDir);
  } catch {
    return { success: false, message: "Failed to load config." };
  }

  const todayCost = costTracker.getTotalCostToday();
  if (config.settings.cost_limit_daily > 0 && todayCost >= config.settings.cost_limit_daily) {
    return {
      success: false,
      message: `Daily cost limit reached ($${todayCost.toFixed(2)} / $${config.settings.cost_limit_daily}). Increase the limit or wait until tomorrow.`,
    };
  }

  // Check monthly cost limit
  const monthCost = costTracker.getTotalCostThisMonth();
  if (config.settings.cost_limit_monthly > 0 && monthCost >= config.settings.cost_limit_monthly) {
    return {
      success: false,
      message: `Monthly cost limit reached ($${monthCost.toFixed(2)} / $${config.settings.cost_limit_monthly}). Increase the limit or wait until next month.`,
    };
  }

  // Enqueue the brief with metadata
  const position = briefQueue.enqueue(text, meta);
  return {
    success: true,
    message: position === 1
      ? "Brief received. I'll post updates as the team works."
      : `Brief queued (position #${position}). I'll get to it after the current task.`,
    position,
  };
}

/**
 * Handles /aicib slash commands from Slack.
 */
export async function handleSlashCommand(
  command: string,
  _args: string,
  projectDir: string,
  costTracker: CostTracker
): Promise<string> {
  switch (command) {
    case "status": {
      const statuses = costTracker.getAgentStatuses();
      if (statuses.length === 0) {
        return "No agents are currently tracked. Run `aicib start` first.";
      }
      const lines = statuses.map((s) => {
        const icon = s.status === "working" ? ":large_green_circle:" :
                     s.status === "idle" ? ":white_circle:" :
                     s.status === "error" ? ":red_circle:" : ":black_circle:";
        const task = s.current_task ? ` — ${s.current_task}` : "";
        return `${icon} *${s.agent_role}*: ${s.status}${task}`;
      });
      return lines.join("\n");
    }

    case "cost": {
      let config: AicibConfig;
      try {
        config = loadConfig(projectDir);
      } catch {
        return "Failed to load config.";
      }
      const todayCost = costTracker.getTotalCostToday();
      const monthCost = costTracker.getTotalCostThisMonth();
      const byAgent = costTracker.getCostByAgent();
      const agentLines = byAgent.map(
        (a) => `  ${a.role}: $${a.total_cost_usd.toFixed(4)} (${a.entry_count} entries)`
      ).join("\n");

      return [
        `:moneybag: *Cost Summary*`,
        `Today: $${todayCost.toFixed(4)} / $${config.settings.cost_limit_daily}`,
        `This month: $${monthCost.toFixed(4)} / $${config.settings.cost_limit_monthly}`,
        byAgent.length > 0 ? `\n*By agent:*\n${agentLines}` : "",
      ].filter(Boolean).join("\n");
    }

    case "help":
      return [
        ":robot_face: *AICIB Slack Commands*",
        "",
        "Type a message in #aicib-ceo to send a brief to the CEO.",
        "",
        "`/aicib status` — Show agent statuses",
        "`/aicib cost` — Show cost breakdown",
        "`/aicib stop` — Stop the current session",
        "`/aicib help` — Show this help message",
      ].join("\n");

    default:
      return `Unknown command: ${command}. Try \`/aicib help\`.`;
  }
}

// --- Brief Queue ---

interface QueuedBrief {
  text: string;
  userId?: string;
  channelId?: string;
  threadTs?: string;
  enqueuedAt: number;
}

/**
 * FIFO queue for sequential brief processing.
 * sendBrief() handles one directive at a time, so we queue incoming
 * Slack messages and process them in order.
 */
export class BriefQueue {
  private queue: QueuedBrief[] = [];
  private processing = false;
  private projectDir: string;
  private costTracker: CostTracker;
  private client: WebClient;
  private debounceMs: number;
  private sessionLock: SessionLock | null;
  private pendingDebounce: { text: string; timer: NodeJS.Timeout; meta: Omit<QueuedBrief, "text" | "enqueuedAt"> } | null = null;

  /** Thread timestamp of the brief currently being processed. */
  public currentThreadTs: string | undefined;

  constructor(
    projectDir: string,
    costTracker: CostTracker,
    client: WebClient,
    debounceMs: number = 2000,
    sessionLock: SessionLock | null = null
  ) {
    this.projectDir = projectDir;
    this.costTracker = costTracker;
    this.client = client;
    this.debounceMs = debounceMs;
    this.sessionLock = sessionLock;
  }

  /**
   * Enqueue a brief. If the user sends multiple messages within the debounce
   * window, they're coalesced into a single brief (OpenClaw pattern).
   */
  enqueue(
    text: string,
    meta?: { userId?: string; channelId?: string; threadTs?: string }
  ): number {
    // Debounce: coalesce rapid messages from the same user
    if (this.debounceMs > 0 && this.pendingDebounce) {
      // Append to existing pending message
      this.pendingDebounce.text += `\n${text}`;
      clearTimeout(this.pendingDebounce.timer);
      this.pendingDebounce.timer = setTimeout(() => {
        this.flushDebounce();
      }, this.debounceMs);
      return this.queue.length + 1; // approximate position
    }

    if (this.debounceMs > 0) {
      // Start a new debounce window
      this.pendingDebounce = {
        text,
        meta: meta || {},
        timer: setTimeout(() => {
          this.flushDebounce();
        }, this.debounceMs),
      };
      return this.queue.length + 1;
    }

    // No debouncing — enqueue immediately
    this.queue.push({ text, ...meta, enqueuedAt: Date.now() });
    this.processNext();
    return this.queue.length;
  }

  private flushDebounce(): void {
    if (!this.pendingDebounce) return;

    const { text, meta } = this.pendingDebounce;
    this.pendingDebounce = null;

    this.queue.push({
      text,
      ...meta,
      enqueuedAt: Date.now(),
    });

    this.processNext();
  }

  get length(): number {
    return this.queue.length;
  }

  /**
   * Processes the next brief in the queue. Non-blocking — chains itself
   * until the queue is empty.
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const brief = this.queue.shift()!;

    try {
      // Clear stale routing and set thread context for this brief
      clearToolUseTracking();
      this.currentThreadTs = brief.threadTs;

      const activeSession = this.costTracker.getActiveSDKSessionId();
      if (!activeSession) {
        if (brief.channelId) {
          await this.client.chat.postMessage({
            channel: brief.channelId,
            text: ":warning: No active session. Run `aicib start` first.",
            thread_ts: brief.threadTs,
          });
        }
        return;
      }

      const config = loadConfig(this.projectDir);

      // Add ack reaction (OpenClaw pattern)
      if (brief.channelId && brief.threadTs) {
        await this.client.reactions.add({
          channel: brief.channelId,
          timestamp: brief.threadTs,
          name: "eyes",
        }).catch((err) => { console.warn(`  Warning: ${err instanceof Error ? err.message : String(err)}`); });
      }

      // Acquire session lock to prevent concurrent CEO session access (chat vs brief)
      if (this.sessionLock) await this.sessionLock.acquire();

      let result;
      try {
        // Process the brief
        result = await sendBrief(
          activeSession.sdkSessionId,
          brief.text,
          this.projectDir,
          config,
          // onMessage is handled by the registered slack-bridge message handler
        );

        // Record costs
        recordRunCosts(
          result,
          this.costTracker,
          activeSession.sessionId,
          "ceo",
          config.agents.ceo?.model || "opus"
        );

        // Generate journal entry (best-effort) — also resumes CEO session
        await generateJournalEntry(
          activeSession.sdkSessionId,
          brief.text,
          result,
          this.projectDir,
          this.costTracker,
          activeSession.sessionId
        ).catch(() => { /* best-effort */ });
      } finally {
        if (this.sessionLock) this.sessionLock.release();
      }

      // Swap 👀 reaction for ✅ — no text summary posted (keeps the thread clean)
      if (brief.channelId && brief.threadTs) {
        await this.client.reactions.remove({
          channel: brief.channelId,
          timestamp: brief.threadTs,
          name: "eyes",
        }).catch((err) => { console.warn(`  Warning: ${err instanceof Error ? err.message : String(err)}`); });

        await this.client.reactions.add({
          channel: brief.channelId,
          timestamp: brief.threadTs,
          name: "white_check_mark",
        }).catch((err) => { console.warn(`  Warning: ${err instanceof Error ? err.message : String(err)}`); });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`  Warning: Brief processing failed: ${errorMsg}`);

      // Notify in Slack
      if (brief.channelId) {
        await this.client.chat.postMessage({
          channel: brief.channelId,
          text: `:x: Brief failed: ${errorMsg}`,
          thread_ts: brief.threadTs,
        }).catch((err) => { console.warn(`  Warning: ${err instanceof Error ? err.message : String(err)}`); });
      }
    } finally {
      this.currentThreadTs = undefined;
      this.processing = false;
      // Process next in queue
      if (this.queue.length > 0) {
        this.processNext();
      }
    }
  }
}

// --- Cross-process log forwarding ---

/**
 * Polls background_logs for new entries and forwards them to Slack.
 * Used when briefs are initiated from the CLI (not Slack) so the daemon
 * can still mirror output to Slack channels.
 */
export function startLogPolling(
  client: WebClient,
  costTracker: CostTracker,
  mappings: Map<string, ChannelMapping>,
  intervalMs: number = 2000
): NodeJS.Timeout {
  let lastLogId = 0;

  // Get the current max log ID to avoid replaying old logs
  try {
    const activeSession = costTracker.getActiveSDKSessionId();
    if (activeSession) {
      const job = costTracker.getActiveBackgroundJob(activeSession.sessionId);
      if (job) {
        const logs = costTracker.getBackgroundLogs(job.id);
        if (logs.length > 0) {
          lastLogId = logs[logs.length - 1].id;
        }
      }
    }
  } catch { /* start from 0 */ }

  return setInterval(() => {
    try {
      const activeSession = costTracker.getActiveSDKSessionId();
      if (!activeSession) return;

      const job = costTracker.getActiveBackgroundJob(activeSession.sessionId);
      if (!job) return;

      const newLogs = costTracker.getBackgroundLogsSince(job.id, lastLogId);

      for (const log of newLogs) {
        lastLogId = log.id;

        // Route to department channel based on agent role
        const channelSuffix = DEPARTMENT_CHANNEL_MAP[log.agent_role] || "ceo";

        const channel = mappings.get(channelSuffix);
        if (!channel) continue;

        // Post as a simple message (already formatted as plain text)
        client.chat.postMessage({
          channel: channel.channelId,
          text: log.content,
          unfurl_links: false,
        }).catch((err) => { console.warn(`  Warning: ${err instanceof Error ? err.message : String(err)}`); });
      }
    } catch {
      // Polling errors are non-fatal
    }
  }, intervalMs);
}
