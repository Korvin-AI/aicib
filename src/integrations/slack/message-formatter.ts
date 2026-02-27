/**
 * Converts SDK engine messages into Slack Block Kit payloads.
 *
 * Pure functions — no Slack API calls, fully testable without a Slack connection.
 */

import type { EngineMessage, EngineSystemMessage } from "../../core/engine/index.js";
import { ROLE_EMOJI, SLACK_BLOCK_TEXT_LIMIT, SLACK_MESSAGE_TOTAL_LIMIT } from "./types.js";

// --- Markdown → mrkdwn conversion ---

/**
 * Converts standard Markdown to Slack's mrkdwn format.
 *
 * Transformations:
 *   **bold**   → *bold*
 *   *italic*   → _italic_   (only single asterisk outside bold pairs)
 *   [text](url) → <url|text>
 *   Escape <, >, & (except Slack tokens like <@U123> and <#C123>)
 *   Code blocks preserved (Slack supports triple-backtick)
 */
export function markdownToMrkdwn(text: string): string {
  // Split into code blocks and non-code sections to avoid transforming code
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);

  const converted = parts.map((part, index) => {
    // Odd indices are code blocks — leave them alone
    if (index % 2 === 1) return part;

    let result = part;

    // Preserve Slack tokens (<@U123>, <#C456>, <!here>, <url|text>) before escaping
    const slackTokens: string[] = [];
    result = result.replace(/<([@#!][^>]+|https?:\/\/[^>]+)>/g, (match) => {
      slackTokens.push(match);
      return `\x00SLACK${slackTokens.length - 1}\x00`;
    });

    // Escape HTML entities
    result = result.replace(/&/g, "&amp;");
    result = result.replace(/</g, "&lt;");
    result = result.replace(/>/g, "&gt;");

    // Restore Slack tokens
    result = result.replace(/\x00SLACK(\d+)\x00/g, (_, idx) => slackTokens[Number(idx)]);

    // Convert Markdown links: [text](url) → <url|text>
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

    // Convert italic first: *text* → _text_ (won't match **bold**)
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");

    // Convert bold: **text** → *text*
    result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

    // Convert strikethrough: ~~text~~ → ~text~
    result = result.replace(/~~(.+?)~~/g, "~$1~");

    return result;
  });

  return converted.join("");
}

// --- Block Kit formatting ---

export interface SlackPayload {
  text: string; // fallback plain text
  blocks: SlackBlock[];
  thread_ts?: string;
  /** Agent role that produced this message (e.g. "ceo", "cto"). Used for display name. */
  role?: string;
}

/**
 * Formats an agent role string for display as a Slack username.
 * "ceo" → "CEO", "backend-engineer" → "Backend Engineer"
 *
 * If customNames is provided, checks for a user-defined display name first.
 */
export function formatRoleName(
  role: string,
  customNames?: Record<string, string>
): string {
  if (customNames?.[role]) return customNames[role];
  const acronyms = new Set(["ceo", "cto", "cfo", "cmo"]);
  if (acronyms.has(role)) return role.toUpperCase();
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
}

/**
 * Creates a rich header block for an agent message.
 * e.g. ":gear: CTO | Working on backend architecture"
 */
export function agentHeaderBlock(role: string, subtitle?: string): SlackBlock {
  const emoji = ROLE_EMOJI[role] || ROLE_EMOJI.subagent;
  const title = role.toUpperCase();
  const headerText = subtitle
    ? `${emoji} *${title}* | ${subtitle}`
    : `${emoji} *${title}*`;

  return {
    type: "section",
    text: { type: "mrkdwn", text: headerText },
  };
}

/**
 * Splits long text into multiple section blocks at paragraph boundaries.
 * Slack has a 3000-character limit per block text element.
 */
export function splitIntoBlocks(text: string, maxLen: number = SLACK_BLOCK_TEXT_LIMIT): SlackBlock[] {
  if (text.length <= maxLen) {
    return [{ type: "section", text: { type: "mrkdwn", text } }];
  }

  const blocks: SlackBlock[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: remaining } });
      break;
    }

    // Find a paragraph boundary near the limit
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen * 0.5) {
      // Fall back to line boundary
      splitAt = remaining.lastIndexOf("\n", maxLen);
    }
    if (splitAt === -1 || splitAt < maxLen * 0.3) {
      // Fall back to space
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt === -1) {
      // Hard cut
      splitAt = maxLen;
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: remaining.slice(0, splitAt) },
    });
    remaining = remaining.slice(splitAt).trimStart();
  }

  return blocks;
}

/**
 * Converts an SDK EngineMessage into a Slack Block Kit payload.
 * Returns null for messages that shouldn't be displayed in Slack
 * (tool progress, replays, etc.)
 */
export function formatForSlack(
  message: EngineMessage,
  agentRole?: string
): SlackPayload | null {
  if (message.type === "assistant") {
    const content = message.message?.content;
    if (!content) return null;

    const texts: string[] = [];
    for (const block of content) {
      if ("text" in block && block.text) {
        texts.push(block.text);
      }
      // Skip tool_use blocks — they're internal SDK plumbing
    }

    if (texts.length === 0) return null;

    const role = agentRole || (message.parent_tool_use_id ? "subagent" : "ceo");
    const rawText = texts.join("\n");

    // Enforce total message limit
    const trimmedText = rawText.length > SLACK_MESSAGE_TOTAL_LIMIT
      ? rawText.slice(0, SLACK_MESSAGE_TOTAL_LIMIT) + "\n\n...[truncated — see terminal for full output]"
      : rawText;

    const mrkdwnText = markdownToMrkdwn(trimmedText);
    const header = agentHeaderBlock(role);
    const bodyBlocks = splitIntoBlocks(mrkdwnText);

    return {
      text: `[${role.toUpperCase()}] ${rawText.slice(0, 200)}`,
      blocks: [header, ...bodyBlocks],
      role,
    };
  }

  if (message.type === "system" && "subtype" in message) {
    const sysMsg = message as EngineSystemMessage;

    if ((sysMsg.subtype as string) === "task_notification") {
      const taskMsg = sysMsg as EngineSystemMessage & {
        taskName?: string;
        taskStatus?: string;
        agentName?: string;
      };
      const agent = taskMsg.agentName || taskMsg.taskName || "subagent";
      const status = taskMsg.taskStatus || "update";
      const emoji = ROLE_EMOJI[agent.toLowerCase()] || ":robot_face:";
      const text = `${emoji} *${agent}*: ${status}`;

      return {
        text: `[TASK] ${agent}: ${status}`,
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text }],
          },
        ],
        role: agent.toLowerCase(),
      };
    }

    // Skip init, tool_progress, and other system messages
    return null;
  }

  if (message.type === "result") {
    // Suppress session-complete telemetry from Slack — it's internal data
    // that belongs in the terminal, not in conversation threads.
    return null;
  }

  return null;
}
