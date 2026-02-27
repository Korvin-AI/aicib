#!/usr/bin/env node

/**
 * Slack daemon process — runs as a detached long-lived process.
 * Invoked as: node daemon.js <projectDir>
 *
 * Maintains a persistent WebSocket connection to Slack via Socket Mode (Bolt).
 * Receives messages from Slack, forwards them as briefs or chats, and posts
 * agent output back to Slack channels.
 *
 * Pattern follows background-worker.ts but runs indefinitely.
 */

// Side-effect imports: register Slack, task, intelligence, and knowledge hooks before anything loads
import "./register.js";
import "../../core/task-register.js";
import "../../core/intelligence-register.js";
import "../../core/knowledge-register.js";

import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import path from "node:path";
import fs from "node:fs";

import { loadConfig } from "../../core/config.js";
import { CostTracker } from "../../core/cost-tracker.js";
import { registerMessageHandler } from "../../core/agent-runner.js";
import type { SlackConfig, ChannelMapping } from "./types.js";
import { SLACK_STATE_KEYS, DEPARTMENT_HEAD_MAP } from "./types.js";
import { loadChannelMappings } from "./channel-mapper.js";
import { getSlackDb, getStateValue, setStateValue } from "./state.js";
import {
  createSlackMessageHandler,
  handleSlackBrief,
  handleSlashCommand,
  BriefQueue,
  startLogPolling,
} from "./message-bridge.js";
import {
  SessionLock,
  ChatHandler,
  ChatQueue,
  classifyHeuristic,
  classifyWithAI,
  parseMention,
} from "./chat-handler.js";

// --- Helpers ---

/**
 * Builds a reverse map: Slack channel ID → { department, headRole }.
 * Used to determine which agent "owns" each department channel.
 */
function buildChannelOwnerMap(
  mappings: Map<string, ChannelMapping>
): Map<string, { department: string; headRole: string }> {
  const owners = new Map<string, { department: string; headRole: string }>();
  for (const [suffix, mapping] of mappings) {
    const headRole = DEPARTMENT_HEAD_MAP[suffix];
    if (headRole) {
      owners.set(mapping.channelId, { department: suffix, headRole });
    }
  }
  return owners;
}

// --- Main daemon ---

async function main(): Promise<void> {
  const [, , projectDir] = process.argv;

  if (!projectDir) {
    process.stderr.write("Usage: daemon.js <projectDir>\n");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(projectDir, ".aicib", "state.db"))) {
    process.stderr.write("Error: No AICIB state database found. Run 'aicib init' first.\n");
    process.exit(1);
  }

  // Open a dedicated DB connection for the daemon
  const db = getSlackDb(projectDir);

  // Read tokens from slack_state table
  const botToken = getStateValue(db, SLACK_STATE_KEYS.BOT_TOKEN);
  const appToken = getStateValue(db, SLACK_STATE_KEYS.APP_TOKEN);

  if (!botToken || !appToken) {
    process.stderr.write("Error: Slack tokens not found. Run 'aicib slack connect' first.\n");
    db.close();
    process.exit(1);
  }

  // Load config
  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    process.stderr.write(`Error loading config: ${error instanceof Error ? error.message : String(error)}\n`);
    db.close();
    process.exit(1);
  }

  const slackConfig = (config.extensions.slack || {}) as SlackConfig;

  // Load channel mappings from DB
  const channelMappings = loadChannelMappings(db);
  if (channelMappings.size === 0) {
    process.stderr.write("Error: No channel mappings found. Run 'aicib slack connect' first.\n");
    db.close();
    process.exit(1);
  }

  // Create Slack client and Bolt app
  const client = new WebClient(botToken);

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  // Create a CostTracker for brief processing
  const costTracker = new CostTracker(projectDir);

  // --- Session Lock (shared between BriefQueue and CEO chat) ---
  const sessionLock = new SessionLock();

  // Register the outbound message handler (briefQueue assigned after construction)
  let briefQueue!: BriefQueue;
  const slackHandler = createSlackMessageHandler(
    client,
    channelMappings,
    slackConfig,
    () => briefQueue.currentThreadTs
  );
  registerMessageHandler("slack-bridge", slackHandler);

  // Create brief queue for inbound processing (with session lock)
  briefQueue = new BriefQueue(
    projectDir,
    costTracker,
    client,
    slackConfig.debounce_ms,
    sessionLock
  );

  // --- Chat handler and queue ---
  const chatHandler = new ChatHandler(
    projectDir,
    costTracker,
    client,
    slackConfig,
    sessionLock
  );
  const chatQueue = new ChatQueue(chatHandler);

  // Build channel owner map for department routing
  const channelOwners = buildChannelOwnerMap(channelMappings);
  const ceoChannel = channelMappings.get("ceo");

  // Collect all known AICIB channel IDs for filtering
  const aicibChannelIds = new Set<string>();
  for (const mapping of channelMappings.values()) {
    aicibChannelIds.add(mapping.channelId);
  }

  // --- Inbound message handling (all channels) ---

  app.message(async ({ message, say }) => {
    const msg = message as unknown as Record<string, unknown>;

    // Skip bot messages, edits, and deletes
    if (msg.bot_id || msg.subtype) return;

    const text = typeof msg.text === "string" ? msg.text : "";
    if (!text.trim()) return;

    const channelId = typeof msg.channel === "string" ? msg.channel : "";
    const ts = typeof msg.ts === "string" ? msg.ts : undefined;

    // Ignore messages from channels we don't own
    if (!aicibChannelIds.has(channelId)) return;

    // --- CEO channel routing ---
    if (ceoChannel && channelId === ceoChannel.channelId) {
      // Check if chat mode is disabled — fall back to brief-only behavior
      if (!slackConfig.chat_enabled) {
        const result = await handleSlackBrief(text, projectDir, costTracker, briefQueue, {
          channelId: ceoChannel.channelId,
          threadTs: ts,
        });
        if (!result.success || (result.position && result.position > 1)) {
          await say({ text: result.message, thread_ts: ts });
        }
        return;
      }

      // Check for @mentions first — route to specific agent
      const mention = parseMention(text, config, slackConfig);
      if (mention.mentionedRole) {
        const cleanText = mention.cleanText || text;
        if (mention.mentionedRole === "ceo") {
          await chatHandler.handleCEOChat(cleanText, channelId, ts);
        } else {
          chatQueue.enqueue({
            text: cleanText,
            agentRole: mention.mentionedRole,
            channelId,
            threadTs: ts,
          });
        }
        return;
      }

      // Explicit brief prefix — bypass classification
      if (text.trimStart().startsWith("/brief ")) {
        const briefText = text.trimStart().slice(7).trim();
        if (briefText) {
          const result = await handleSlackBrief(briefText, projectDir, costTracker, briefQueue, {
            channelId: ceoChannel.channelId,
            threadTs: ts,
          });
          if (!result.success || (result.position && result.position > 1)) {
            await say({ text: result.message, thread_ts: ts });
          }
        }
        return;
      }

      // Smart classification: heuristic → AI → confirmation buttons
      const heuristic = classifyHeuristic(text);

      if (heuristic === "definite_chat") {
        await chatHandler.handleCEOChat(text, channelId, ts);
        return;
      }

      if (heuristic === "definite_brief") {
        const result = await handleSlackBrief(text, projectDir, costTracker, briefQueue, {
          channelId: ceoChannel.channelId,
          threadTs: ts,
        });
        if (!result.success || (result.position && result.position > 1)) {
          await say({ text: result.message, thread_ts: ts });
        }
        return;
      }

      // Ambiguous — use AI classifier
      const activeSession = costTracker.getActiveSDKSessionId();
      if (!activeSession) {
        await say({ text: "No active session. Run `aicib start` first.", thread_ts: ts });
        return;
      }

      const aiResult = await classifyWithAI(text, activeSession.sdkSessionId, sessionLock, costTracker, activeSession.sessionId);

      if (aiResult === "chat") {
        await chatHandler.handleCEOChat(text, channelId, ts);
      } else if (ts) {
        // AI says brief — show confirmation buttons
        await chatHandler.showBriefConfirmation(text, channelId, ts);
      } else {
        // No thread timestamp (shouldn't happen normally) — default to brief
        const result = await handleSlackBrief(text, projectDir, costTracker, briefQueue, {
          channelId: ceoChannel.channelId,
        });
        if (!result.success || (result.position && result.position > 1)) {
          await say({ text: result.message });
        }
      }
      return;
    }

    // --- Department channel routing ---
    const owner = channelOwners.get(channelId);
    if (!owner) return;

    // Respect chat_enabled toggle for department channels too
    if (!slackConfig.chat_enabled) return;

    // Check for @mentions that override the default channel owner
    const mention = parseMention(text, config, slackConfig);
    const targetRole = mention.mentionedRole || owner.headRole;
    const cleanText = mention.mentionedRole ? mention.cleanText : text;

    chatQueue.enqueue({
      text: cleanText,
      agentRole: targetRole,
      channelId,
      threadTs: ts,
    });
  });

  // --- Brief confirmation action handlers ---

  app.action("confirm_brief", async ({ action, ack, respond }) => {
    await ack();

    const actionRecord = action as unknown as Record<string, unknown>;
    const value = typeof actionRecord.value === "string" ? actionRecord.value : "{}";
    let parsed: { threadTs?: string };
    try {
      parsed = JSON.parse(value);
    } catch {
      await respond({ text: ":x: Failed to parse confirmation data.", replace_original: true });
      return;
    }

    const { threadTs } = parsed;
    if (!threadTs) {
      await respond({ text: ":x: Missing confirmation data.", replace_original: true });
      return;
    }

    // Check if this confirmation is still pending (not timed out)
    const pending = chatHandler.resolveConfirmation(threadTs);
    if (!pending) {
      await respond({
        text: ":hourglass: This was already handled. Send a new message or use /brief to submit a brief.",
        replace_original: true,
      });
      return;
    }

    await respond({ text: ":eyes: Briefing the team now...", replace_original: true });

    const result = await handleSlackBrief(pending.text, projectDir, costTracker, briefQueue, {
      channelId: pending.channelId,
      threadTs,
    });

    if (!result.success) {
      await respond({ text: `:x: ${result.message}`, replace_original: true });
    }
  });

  app.action("reject_brief", async ({ action, ack, respond }) => {
    await ack();

    const actionRecord = action as unknown as Record<string, unknown>;
    const value = typeof actionRecord.value === "string" ? actionRecord.value : "{}";
    let parsed: { threadTs?: string };
    try {
      parsed = JSON.parse(value);
    } catch {
      await respond({ text: ":speech_balloon: Treating as chat.", replace_original: true });
      return;
    }

    const { threadTs } = parsed;
    if (!threadTs) return;

    const pending = chatHandler.resolveConfirmation(threadTs);
    if (!pending) {
      // Timeout already handled this — don't double-chat
      await respond({ text: ":hourglass: Already handled.", replace_original: true });
      return;
    }

    await respond({ text: ":speech_balloon: Chatting...", replace_original: true });

    await chatHandler.handleCEOChat(
      pending.text,
      pending.channelId,
      threadTs
    ).catch(() => { /* best-effort */ });
  });

  // --- Slash command handling ---

  app.command("/aicib", async ({ command, ack, respond }) => {
    await ack();

    const parts = command.text.trim().split(/\s+/);
    const subcommand = parts[0] || "help";
    const args = parts.slice(1).join(" ");

    if (subcommand === "brief" && args) {
      // Brief via slash command
      const result = await handleSlackBrief(
        args,
        projectDir,
        costTracker,
        briefQueue,
        { channelId: command.channel_id }
      );
      await respond(result.message);
    } else if (subcommand === "stop") {
      // Stop is handled by signaling — tell user to use CLI
      await respond("Use `aicib stop` from the terminal to stop the session.");
    } else {
      const response = await handleSlashCommand(
        subcommand,
        args,
        projectDir,
        costTracker
      );
      await respond(response);
    }
  });

  // --- Start background log polling (for CLI-initiated briefs) ---

  const logPollTimer = startLogPolling(client, costTracker, channelMappings);

  // --- Write PID and start heartbeat ---

  setStateValue(db, SLACK_STATE_KEYS.DAEMON_PID, String(process.pid));
  setStateValue(db, SLACK_STATE_KEYS.CONNECTION_STATE, "connecting");

  const heartbeatTimer = setInterval(() => {
    try {
      setStateValue(db, SLACK_STATE_KEYS.DAEMON_HEARTBEAT, new Date().toISOString());
    } catch {
      // DB may be locked — non-fatal
    }
  }, 30_000);

  // --- Graceful shutdown ---

  const shutdown = async () => {
    clearInterval(heartbeatTimer);
    clearInterval(logPollTimer);
    chatHandler.cleanup();

    try {
      setStateValue(db, SLACK_STATE_KEYS.CONNECTION_STATE, "disconnected");
      setStateValue(db, SLACK_STATE_KEYS.DAEMON_PID, "");
    } catch { /* best-effort */ }

    try {
      await app.stop();
    } catch { /* best-effort */ }

    try { costTracker.close(); } catch { /* best-effort */ }
    try { db.close(); } catch { /* best-effort */ }

    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // --- Start the Bolt app ---

  try {
    await app.start();
    setStateValue(db, SLACK_STATE_KEYS.CONNECTION_STATE, "connected");
    setStateValue(db, SLACK_STATE_KEYS.DAEMON_HEARTBEAT, new Date().toISOString());

    // Post a startup message to the CEO channel
    if (ceoChannel) {
      const chatNote = slackConfig.chat_enabled
        ? " Chat with agents in any channel, or send directives here."
        : " Send messages here to brief the CEO.";
      await client.chat.postMessage({
        channel: ceoChannel.channelId,
        text: `:rocket: AICIB Slack bridge connected.${chatNote}`,
      }).catch((err) => { process.stderr.write(`Slack startup message failed: ${err}\n`); });
    }
  } catch (error) {
    process.stderr.write(`Failed to start Slack bot: ${error instanceof Error ? error.message : String(error)}\n`);
    setStateValue(db, SLACK_STATE_KEYS.CONNECTION_STATE, "error");
    chatHandler.cleanup();
    db.close();
    costTracker.close();
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Slack daemon fatal error: ${err}\n`);
  process.exit(1);
});
