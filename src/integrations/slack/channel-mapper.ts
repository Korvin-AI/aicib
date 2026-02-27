/**
 * Routes SDK messages to the correct Slack channel based on agent role.
 *
 * Maintains an internal map of `toolUseId → agentRole` built from
 * task_notification messages — same pattern as output-formatter.ts:46-53.
 */

import type { WebClient } from "@slack/web-api";
import type Database from "better-sqlite3";
import type { EngineMessage, EngineSystemMessage } from "../../core/engine/index.js";
import type { SlackConfig, ChannelMapping } from "./types.js";
import { DEPARTMENT_CHANNEL_MAP, CHANNEL_SUFFIXES } from "./types.js";

// --- Tool use tracking ---

/**
 * Maps tool_use IDs to agent roles. Built incrementally from task_notification
 * messages so we know which department channel to route subagent messages to.
 */
const toolUseToRole = new Map<string, string>();

/**
 * Records a task_notification mapping. Called by the message bridge as
 * messages stream in.
 */
export function trackTaskNotification(message: EngineMessage): void {
  if (
    message.type === "system" &&
    "subtype" in message &&
    ((message as EngineSystemMessage).subtype as string) === "task_notification"
  ) {
    const taskMsg = message as EngineSystemMessage & {
      taskName?: string;
      agentName?: string;
      tool_use_id?: string;
    };

    const role = (taskMsg.agentName || taskMsg.taskName || "").toLowerCase();
    if (role && taskMsg.tool_use_id) {
      toolUseToRole.set(taskMsg.tool_use_id, role);
    }
  }
}

/**
 * Clears the tool use tracking map (called between sessions).
 */
export function clearToolUseTracking(): void {
  toolUseToRole.clear();
}

// --- Channel creation ---

/**
 * Creates department channels if they don't exist.
 * Returns a map of department suffix → channel info.
 */
export async function ensureChannels(
  client: WebClient,
  config: SlackConfig
): Promise<Map<string, ChannelMapping>> {
  const mappings = new Map<string, ChannelMapping>();

  for (const suffix of CHANNEL_SUFFIXES) {
    const channelName = `${config.channel_prefix}-${suffix}`;

    try {
      // Try to find existing channel
      const existing = await findChannelByName(client, channelName);

      if (existing) {
        mappings.set(suffix, {
          department: suffix,
          channelId: existing.id,
          channelName,
        });
        continue;
      }

      if (!config.auto_create_channels) {
        console.warn(`  Warning: Channel #${channelName} not found and auto_create_channels is disabled. Skipping.`);
        continue;
      }

      // Create the channel
      const result = await client.conversations.create({
        name: channelName,
        is_private: false,
      });

      if (result.channel?.id) {
        mappings.set(suffix, {
          department: suffix,
          channelId: result.channel.id,
          channelName,
        });

        // Set channel topic/purpose
        const purposes: Record<string, string> = {
          ceo: "CEO communications and directives for your AI company",
          engineering: "Engineering department updates from CTO and engineers",
          finance: "Finance department updates from CFO and analysts",
          marketing: "Marketing department updates from CMO and content team",
        };

        await client.conversations.setTopic({
          channel: result.channel.id,
          topic: purposes[suffix] || `AICIB ${suffix} department`,
        }).catch(() => { /* best-effort */ });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Channel name taken means it exists but we can't see it (possibly private)
      if (msg.includes("name_taken")) {
        console.warn(`  Warning: Channel #${channelName} exists but bot can't access it. Invite the bot to the channel.`);
      } else {
        console.warn(`  Warning: Failed to create/find #${channelName}: ${msg}`);
      }
    }
  }

  return mappings;
}

/**
 * Finds a Slack channel by name using the conversations.list API.
 */
async function findChannelByName(
  client: WebClient,
  name: string
): Promise<{ id: string; name: string } | null> {
  try {
    let cursor: string | undefined;
    do {
      const result = await client.conversations.list({
        types: "public_channel",
        limit: 200,
        cursor,
      });

      const match = result.channels?.find((ch) => ch.name === name);
      if (match && match.id) {
        return { id: match.id, name: match.name || name };
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch {
    // API error — return null to trigger creation
  }

  return null;
}

// --- Channel routing ---

/**
 * Determines which Slack channel an SDK message belongs in.
 *
 * Routing logic:
 * - CEO messages (no parent_tool_use_id) → CEO channel
 * - Subagent messages → department channel based on tool_use tracking
 * - System/result messages → CEO channel
 */
export function resolveChannel(
  message: EngineMessage,
  mappings: Map<string, ChannelMapping>
): ChannelMapping | null {
  // System and result messages always go to CEO channel
  if (message.type === "system" || message.type === "result") {
    return mappings.get("ceo") || null;
  }

  if (message.type === "assistant") {
    // CEO messages (no parent) → CEO channel
    if (!message.parent_tool_use_id) {
      return mappings.get("ceo") || null;
    }

    // Subagent message — look up the role from task tracking
    const role = toolUseToRole.get(message.parent_tool_use_id);
    if (role) {
      const suffix = DEPARTMENT_CHANNEL_MAP[role];
      if (suffix) {
        return mappings.get(suffix) || mappings.get("ceo") || null;
      }
    }

    // Unknown subagent — fall back to CEO channel
    return mappings.get("ceo") || null;
  }

  return null;
}

// --- SQLite persistence ---

/**
 * Loads saved channel mappings from the slack_channels table.
 */
export function loadChannelMappings(db: Database.Database): Map<string, ChannelMapping> {
  const mappings = new Map<string, ChannelMapping>();

  try {
    const rows = db
      .prepare("SELECT department, channel_id, channel_name FROM slack_channels")
      .all() as Array<{ department: string; channel_id: string; channel_name: string }>;

    for (const row of rows) {
      mappings.set(row.department, {
        department: row.department,
        channelId: row.channel_id,
        channelName: row.channel_name,
      });
    }
  } catch {
    // Table may not exist yet if CostTracker hasn't been initialized
  }

  return mappings;
}

/**
 * Saves channel mappings to the slack_channels table.
 */
export function saveChannelMappings(
  db: Database.Database,
  mappings: Map<string, ChannelMapping>
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO slack_channels (department, channel_id, channel_name) VALUES (?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    for (const mapping of mappings.values()) {
      stmt.run(mapping.department, mapping.channelId, mapping.channelName);
    }
  });

  transaction();
}
