/**
 * Conversational chat handler for the Slack integration.
 *
 * Handles:
 * - Message classification (chat vs brief) via hybrid heuristic + AI
 * - CEO chat responses (reuses existing CEO session, no delegation)
 * - Department/agent chat responses (separate per-agent SDK sessions)
 * - @mention parsing and routing
 * - Brief confirmation with Slack Block Kit buttons + timeout
 * - SessionLock to prevent concurrent CEO session access
 * - Per-agent ChatQueue for parallel department responses
 */

import type { WebClient } from "@slack/web-api";
import type { CostTracker } from "../../core/cost-tracker.js";
import type { AicibConfig } from "../../core/config.js";
import type {
  EngineMessage,
  EngineSystemMessage,
  EngineResultMessage,
} from "../../core/engine/index.js";
import { getEngine } from "../../core/engine/index.js";
import { loadAgentDefinitions, getTemplatePath } from "../../core/agents.js";
import { getAgentsDir } from "../../core/team.js";
import { loadPreset, type PersonaOverlay } from "../../core/persona.js";
import { recordRunCosts, type SessionResult } from "../../core/agent-runner.js";
import { loadConfig } from "../../core/config.js";
import {
  formatForSlack,
  markdownToMrkdwn,
  formatRoleName,
} from "./message-formatter.js";
import type { SlackConfig } from "./types.js";
import { C_SUITE_ROLES, ROLE_EMOJI, DEPARTMENT_CHANNEL_MAP } from "./types.js";
import { getSlackDb } from "./state.js";
import type Database from "better-sqlite3";

// ─── SessionLock ─────────────────────────────────────────────────────────────
// Prevents concurrent resumeSession calls on the same CEO SDK session.
// Shared between BriefQueue (briefs) and ChatHandler (CEO chat).
// Non-reentrant: acquiring twice from the same async flow will deadlock.
// Current callers (BriefQueue, handleCEOChat, classifyWithAI) each acquire once at the top level.

export class SessionLock {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

// ─── ChatQueue ───────────────────────────────────────────────────────────────
// Per-agent queue so CTO and CFO can respond in parallel,
// but messages to the same agent are serialized.

interface QueuedChat {
  text: string;
  agentRole: string;
  channelId: string;
  threadTs?: string;
}

export class ChatQueue {
  private queues = new Map<string, QueuedChat[]>();
  private processing = new Set<string>();
  private handler: ChatHandler;

  constructor(handler: ChatHandler) {
    this.handler = handler;
  }

  enqueue(chat: QueuedChat): void {
    const role = chat.agentRole;
    if (!this.queues.has(role)) {
      this.queues.set(role, []);
    }
    this.queues.get(role)!.push(chat);
    this.processNext(role);
  }

  private async processNext(agentRole: string): Promise<void> {
    if (this.processing.has(agentRole)) return;
    const queue = this.queues.get(agentRole);
    if (!queue || queue.length === 0) return;

    this.processing.add(agentRole);
    const chat = queue.shift()!;

    try {
      await this.handler.handleChat(
        chat.text,
        chat.agentRole,
        chat.channelId,
        chat.threadTs
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`  Warning: Chat with ${chat.agentRole} failed: ${msg}`);
      try {
        await this.handler.postError(chat.channelId, msg, chat.threadTs);
      } catch { /* best-effort */ }
    } finally {
      this.processing.delete(agentRole);
      if (queue.length > 0) {
        this.processNext(agentRole);
      }
    }
  }
}

// ─── Classification ──────────────────────────────────────────────────────────

export type HeuristicResult = "definite_chat" | "definite_brief" | "ambiguous";

// Greeting/conversational prefixes (case-insensitive match at start)
const CHAT_PREFIXES = [
  "hey", "hi", "hello", "yo", "sup", "thanks", "thank you", "thx",
  "ok", "okay", "sure", "cool", "nice", "great", "awesome", "perfect",
  "lol", "haha", "heh", "yep", "yup", "nope", "no worries",
  "good morning", "good afternoon", "good evening", "gm",
];

// Action verbs that signal a work directive
const BRIEF_VERBS = [
  "build", "create", "write", "draft", "prepare", "develop", "implement",
  "analyze", "research", "design", "launch", "deploy", "set up", "setup",
  "fix", "update", "refactor", "optimize", "review", "assess", "evaluate",
  "generate", "produce", "compile", "schedule", "plan", "organize",
];

// Deadline language patterns
const DEADLINE_PATTERNS = [
  /by\s+(tomorrow|tonight|end\s+of\s+(day|week|month)|eod|eow|monday|tuesday|wednesday|thursday|friday)/i,
  /asap/i,
  /urgent(ly)?/i,
  /this\s+week/i,
  /deadline/i,
];

// Delegation language (even in questions)
const DELEGATION_PATTERNS = [
  /get\s+the\s+team\s+to/i,
  /have\s+(the\s+)?(cto|cfo|cmo|team)\s+(look|work|handle|do)/i,
  /assign\s+(to|this)/i,
  /delegate\s+(to|this)/i,
  /tell\s+(the\s+)?(cto|cfo|cmo|team)\s+to/i,
];

/**
 * Checks if `text` starts with `prefix` as a complete word
 * (not a substring of a longer word like "hi" in "hire").
 */
function startsWithWord(text: string, prefix: string): boolean {
  if (text === prefix) return true;
  if (!text.startsWith(prefix)) return false;
  const next = text[prefix.length];
  return next === " " || next === "," || next === "!" || next === "." || next === "?" || next === ";" || next === ":";
}

/**
 * Classifies a message as definite_chat, definite_brief, or ambiguous
 * using fast heuristics (no AI call).
 *
 * Order matters: brief signals (deadlines, delegation, action verbs) are
 * checked BEFORE conversational prefixes so "hire someone by tomorrow"
 * is correctly classified as a brief, not a chat (because "hi" prefix).
 */
export function classifyHeuristic(text: string): HeuristicResult {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;

  // Emoji-only or single-word responses → chat
  if (wordCount <= 2 && /^[\p{Emoji}\s]+$/u.test(trimmed)) return "definite_chat";

  // --- Brief signals first (these should always win over chat prefixes) ---

  // Long messages (>100 words) → likely a brief
  if (wordCount > 100) return "definite_brief";

  // Deadline language → definite brief
  if (DEADLINE_PATTERNS.some((p) => p.test(lower))) return "definite_brief";

  // Delegation language → definite brief
  if (DELEGATION_PATTERNS.some((p) => p.test(lower))) return "definite_brief";

  // Strong action verbs in imperative form (at start of sentence) → definite brief
  const firstWord = lower.split(/\s+/)[0];
  if (BRIEF_VERBS.includes(firstWord)) return "definite_brief";

  // --- Chat signals (only after brief signals are ruled out) ---

  // Short messages matching conversational prefixes (full-word match) → chat
  if (wordCount <= 15) {
    for (const prefix of CHAT_PREFIXES) {
      if (startsWithWord(lower, prefix)) return "definite_chat";
    }
  }

  // Very short messages ending with ? and no action verbs → chat
  if (wordCount <= 10 && trimmed.endsWith("?")) {
    const hasActionVerb = BRIEF_VERBS.some((v) => lower.includes(v));
    if (!hasActionVerb) return "definite_chat";
  }

  return "ambiguous";
}

/**
 * Classifies an ambiguous message using AI (Haiku model, ~$0.001 per call).
 * Resumes the CEO session so the model has conversation context.
 * Falls back to "chat" on any failure.
 */
export async function classifyWithAI(
  text: string,
  sdkSessionId: string,
  sessionLock: SessionLock,
  costTracker?: CostTracker,
  aicibSessionId?: string
): Promise<"chat" | "brief"> {
  try {
    await sessionLock.acquire();

    const classifyPrompt = `Classify this message from the human founder as either CHAT or BRIEF.

CHAT: casual conversation, opinions, questions, small talk, follow-ups, status checks, acknowledgments
BRIEF: work directives, requests for deliverables, tasks needing delegation, anything requiring planning/execution

Message: "${text.slice(0, 500)}"

Reply with exactly one word: CHAT or BRIEF`;

    let responseText = "";
    let classifyResult: SessionResult | null = null;
    const stream = getEngine().resumeSession(sdkSessionId, {
      prompt: classifyPrompt,
      model: "haiku",
      tools: [],
      permissionMode: "bypassPermissions",
      maxBudgetUsd: 0.01,
      maxTurns: 1,
    });

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        const content = msg.message?.content;
        if (content) {
          for (const block of content) {
            if ("text" in block && block.text) {
              responseText += block.text;
            }
          }
        }
      }
      if (msg.type === "result") {
        const resultMsg = msg as EngineResultMessage;
        classifyResult = {
          sessionId: resultMsg.session_id,
          totalCostUsd: resultMsg.total_cost_usd,
          inputTokens: resultMsg.usage.input_tokens,
          outputTokens: resultMsg.usage.output_tokens,
          numTurns: resultMsg.num_turns,
          durationMs: resultMsg.duration_ms,
          modelUsage: resultMsg.modelUsage,
        };
      }
    }

    // Record classification cost if tracking is available
    if (classifyResult && costTracker && aicibSessionId) {
      recordRunCosts(classifyResult, costTracker, aicibSessionId, "ceo-classifier", "haiku");
    }

    const result = responseText.trim().toUpperCase();
    return result === "BRIEF" ? "brief" : "chat";
  } catch (error) {
    console.warn(
      `  Warning: AI classification failed, defaulting to chat: ${error instanceof Error ? error.message : String(error)}`
    );
    return "chat";
  } finally {
    sessionLock.release();
  }
}

// ─── @Mention Parser ─────────────────────────────────────────────────────────

export interface MentionResult {
  mentionedRole: string | null;
  cleanText: string;
}

/**
 * Parses @mentions in message text and returns the target agent role.
 * Supports both hyphenated ("@backend-engineer") and display-name formats ("@Backend Engineer").
 * Case-insensitive.
 */
export function parseMention(
  text: string,
  config: AicibConfig,
  slackConfig: SlackConfig
): MentionResult {
  // Build lookup: lowercase display name → internal role
  const lookup = new Map<string, string>();

  // Standard roles from DEPARTMENT_CHANNEL_MAP
  for (const role of Object.keys(DEPARTMENT_CHANNEL_MAP)) {
    lookup.set(role.toLowerCase(), role);
    lookup.set(formatRoleName(role).toLowerCase(), role);
  }

  // Custom display names from config override lookup
  if (slackConfig.custom_display_names) {
    for (const [role, displayName] of Object.entries(slackConfig.custom_display_names)) {
      lookup.set(displayName.toLowerCase(), role);
    }
  }

  // Also add agent roles from config
  for (const role of Object.keys(config.agents)) {
    lookup.set(role.toLowerCase(), role);
    lookup.set(formatRoleName(role).toLowerCase(), role);
  }

  // Sort by display name length (longest first) to avoid partial matches
  const sortedNames = [...lookup.keys()].sort((a, b) => b.length - a.length);

  for (const name of sortedNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`@${escaped}(?=[\\s.,!?;:]|$)`, "i");
    const match = regex.exec(text);
    if (match) {
      const role = lookup.get(name)!;
      const cleanText = text.slice(0, match.index) + text.slice(match.index + match[0].length);
      return { mentionedRole: role, cleanText: cleanText.trim() };
    }
  }

  return { mentionedRole: null, cleanText: text };
}

// ─── Brief Confirmation ──────────────────────────────────────────────────────

interface PendingConfirmation {
  text: string;
  channelId: string;
  threadTs: string;
  confirmationTs: string;
  timer: NodeJS.Timeout;
}

// ─── ChatHandler ─────────────────────────────────────────────────────────────

export class ChatHandler {
  private projectDir: string;
  private costTracker: CostTracker;
  private client: WebClient;
  private slackConfig: SlackConfig;
  private sessionLock: SessionLock;
  private db: Database.Database;
  pendingConfirmations = new Map<string, PendingConfirmation>();

  constructor(
    projectDir: string,
    costTracker: CostTracker,
    client: WebClient,
    slackConfig: SlackConfig,
    sessionLock: SessionLock
  ) {
    this.projectDir = projectDir;
    this.costTracker = costTracker;
    this.client = client;
    this.slackConfig = slackConfig;
    this.sessionLock = sessionLock;
    this.db = getSlackDb(projectDir);
  }

  // ── CEO Chat ──────────────────────────────────────────────────────────

  /**
   * Handles a conversational message directed at the CEO.
   * Resumes the existing CEO session with no tools/agents to prevent delegation.
   */
  async handleCEOChat(
    text: string,
    channelId: string,
    threadTs?: string
  ): Promise<void> {
    const activeSession = this.costTracker.getActiveSDKSessionId();
    if (!activeSession) {
      await this.postError(channelId, "No active session. Run `aicib start` first.", threadTs);
      return;
    }

    const config = loadConfig(this.projectDir);
    const limitMsg = this.checkCostLimits(config);
    if (limitMsg) {
      await this.postError(channelId, limitMsg, threadTs);
      return;
    }

    await this.sessionLock.acquire();
    try {
      const chatPrompt = `The human founder sent a casual message in Slack. Reply conversationally as the CEO. Do NOT delegate to your team — this is a chat, not a work directive. Keep your reply concise (1-3 paragraphs max). Be helpful, personable, and in-character.

FOUNDER'S MESSAGE:
${text}`;

      const ceoModel = config.agents.ceo?.model || "opus";

      const stream = getEngine().resumeSession(activeSession.sdkSessionId, {
        prompt: chatPrompt,
        model: ceoModel,
        cwd: this.projectDir,
        tools: [],
        agents: {},
        permissionMode: "bypassPermissions",
        maxBudgetUsd: this.slackConfig.chat_max_budget_head,
        maxTurns: 3,
      });

      const result = await this.streamAndPost(stream, "ceo", channelId, threadTs);

      if (result) {
        recordRunCosts(
          result,
          this.costTracker,
          activeSession.sessionId,
          "ceo-chat",
          ceoModel
        );
      }
    } finally {
      this.sessionLock.release();
    }
  }

  // ── Department/Agent Chat ─────────────────────────────────────────────

  /**
   * Handles a conversational message directed at a specific agent.
   * Creates or resumes a dedicated per-agent SDK session.
   */
  async handleChat(
    text: string,
    agentRole: string,
    channelId: string,
    threadTs?: string
  ): Promise<void> {
    // CEO chat goes through the shared CEO session with SessionLock
    if (agentRole === "ceo") {
      return this.handleCEOChat(text, channelId, threadTs);
    }

    const activeSession = this.costTracker.getActiveSDKSessionId();
    if (!activeSession) {
      await this.postError(channelId, "No active session. Run `aicib start` first.", threadTs);
      return;
    }

    const config = loadConfig(this.projectDir);

    const agentConfig = config.agents[agentRole];
    if (agentConfig && agentConfig.enabled === false) {
      const displayName = this.getDisplayName(agentRole);
      await this.postError(
        channelId,
        `${displayName} is currently offline. Enable the agent in aicib.config.yaml.`,
        threadTs
      );
      return;
    }

    const limitMsg = this.checkCostLimits(config);
    if (limitMsg) {
      await this.postError(channelId, limitMsg, threadTs);
      return;
    }

    const isHead = C_SUITE_ROLES.has(agentRole);
    const tools: string[] | { type: "preset"; preset: "claude_code" } = isHead
      ? { type: "preset", preset: "claude_code" }
      : [];
    const maxTurns = isHead ? 50 : 10;
    const maxBudget = isHead
      ? this.slackConfig.chat_max_budget_head
      : this.slackConfig.chat_max_budget_worker;
    const agentModel = config.agents[agentRole]?.model || (isHead ? "opus" : "sonnet");

    const chatSession = this.getOrCreateChatSession(
      activeSession.sessionId,
      agentRole,
      channelId
    );

    if (chatSession.sdkSessionId) {
      // Resume existing agent session
      const chatPrompt = `The human founder sent a message in your department's Slack channel. Reply directly and helpfully. Keep your response concise for Slack.

FOUNDER'S MESSAGE:
${text}`;

      const stream = getEngine().resumeSession(chatSession.sdkSessionId, {
        prompt: chatPrompt,
        model: agentModel,
        cwd: this.projectDir,
        tools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: maxBudget,
        maxTurns,
      });

      let result;
      try {
        result = await this.streamAndPost(stream, agentRole, channelId, threadTs);
        if (result) {
          recordRunCosts(result, this.costTracker, activeSession.sessionId, `${agentRole}-chat`, agentModel);
        }
      } finally {
        this.updateChatSession(activeSession.sessionId, agentRole, chatSession.sdkSessionId);
      }
    } else {
      // First message — create a new agent session
      const systemPrompt = this.buildAgentChatPrompt(agentRole, config);
      const firstPrompt = `The human founder is chatting with you directly in your department's Slack channel. Reply helpfully and in character. Keep it concise for Slack.

FOUNDER'S MESSAGE:
${text}`;

      const stream = getEngine().startSession({
        prompt: firstPrompt,
        systemPrompt,
        model: agentModel,
        cwd: this.projectDir,
        tools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: maxBudget,
        maxTurns,
      });

      let newSessionId = "";
      const result = await this.streamAndPost(stream, agentRole, channelId, threadTs, (msg) => {
        if (msg.type === "system" && "subtype" in msg) {
          const sysMsg = msg as EngineSystemMessage;
          if (sysMsg.subtype === "init") {
            newSessionId = sysMsg.session_id;
          }
        }
      });

      const sessionIdToStore = newSessionId || result?.sessionId;
      if (sessionIdToStore) {
        this.updateChatSession(activeSession.sessionId, agentRole, sessionIdToStore);
      }

      if (result) {
        recordRunCosts(result, this.costTracker, activeSession.sessionId, `${agentRole}-chat`, agentModel);
      }
    }
  }

  // ── Brief Confirmation ────────────────────────────────────────────────

  /**
   * Shows a brief confirmation message with Yes/No buttons in Slack.
   * Auto-treats as chat after timeout.
   */
  async showBriefConfirmation(
    text: string,
    channelId: string,
    threadTs: string
  ): Promise<void> {
    const preview = text.length > 200 ? text.slice(0, 200) + "..." : text;

    const postResult = await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "That sounds like a task for the team. Want me to brief the department heads?",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:briefcase: That sounds like a task for the team. Want me to brief the department heads?\n\n> ${markdownToMrkdwn(preview)}`,
          },
        },
        {
          type: "actions",
          block_id: "brief_confirmation",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Yes, brief the team", emoji: true },
              style: "primary",
              action_id: "confirm_brief",
              value: JSON.stringify({ threadTs }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "No, let's chat", emoji: true },
              action_id: "reject_brief",
              value: JSON.stringify({ threadTs }),
            },
          ],
        },
      ],
      username: this.getDisplayName("ceo"),
      icon_emoji: ROLE_EMOJI.ceo,
    });

    const confirmationTs = postResult.ts;
    if (!confirmationTs) return;

    const timer = setTimeout(async () => {
      this.pendingConfirmations.delete(threadTs);
      try {
        await this.client.chat.update({
          channel: channelId,
          ts: confirmationTs,
          text: ":speech_balloon: No response — treating as a chat.",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":speech_balloon: No response — treating as a chat.",
              },
            },
          ],
        });
      } catch { /* best-effort */ }
      await this.handleCEOChat(text, channelId, threadTs).catch(() => {});
    }, this.slackConfig.confirmation_timeout_ms);

    this.pendingConfirmations.set(threadTs, {
      text,
      channelId,
      threadTs,
      confirmationTs,
      timer,
    });
  }

  /**
   * Resolves a brief confirmation (user clicked a button or timeout expired).
   * Returns the pending confirmation data and removes it from the map.
   */
  resolveConfirmation(threadTs: string): PendingConfirmation | undefined {
    const pending = this.pendingConfirmations.get(threadTs);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingConfirmations.delete(threadTs);
    }
    return pending;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  getDisplayName(role: string): string {
    if (this.slackConfig.custom_display_names?.[role]) {
      return this.slackConfig.custom_display_names[role];
    }
    return formatRoleName(role);
  }

  async postError(channelId: string, message: string, threadTs?: string): Promise<void> {
    await this.client.chat.postMessage({
      channel: channelId,
      text: `:warning: ${message}`,
      thread_ts: threadTs,
    }).catch((err) => {
      console.warn(`  Warning: Failed to post error to Slack: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  cleanup(): void {
    for (const [, pending] of this.pendingConfirmations) {
      clearTimeout(pending.timer);
    }
    this.pendingConfirmations.clear();
    try { this.db.close(); } catch { /* best-effort */ }
  }

  // ── Private ───────────────────────────────────────────────────────────

  private checkCostLimits(config: AicibConfig): string | null {
    const todayCost = this.costTracker.getTotalCostToday();
    if (config.settings.cost_limit_daily > 0 && todayCost >= config.settings.cost_limit_daily) {
      return `Daily cost limit reached ($${todayCost.toFixed(2)} / $${config.settings.cost_limit_daily}).`;
    }
    const monthCost = this.costTracker.getTotalCostThisMonth();
    if (config.settings.cost_limit_monthly > 0 && monthCost >= config.settings.cost_limit_monthly) {
      return `Monthly cost limit reached ($${monthCost.toFixed(2)} / $${config.settings.cost_limit_monthly}).`;
    }
    return null;
  }

  private async streamAndPost(
    stream: AsyncIterable<EngineMessage>,
    agentRole: string,
    channelId: string,
    threadTs?: string,
    onMessage?: (msg: EngineMessage) => void
  ): Promise<SessionResult | null> {
    let result: SessionResult | null = null;
    const displayName = this.getDisplayName(agentRole);
    const emoji = ROLE_EMOJI[agentRole] || ROLE_EMOJI.subagent;

    for await (const msg of stream) {
      if (onMessage) onMessage(msg);

      if (msg.type === "assistant") {
        const payload = formatForSlack(msg, agentRole);
        if (payload) {
          await this.client.chat.postMessage({
            channel: channelId,
            text: payload.text,
            blocks: payload.blocks,
            thread_ts: threadTs,
            unfurl_links: false,
            username: displayName,
            icon_emoji: emoji,
          }).catch((err) => {
            console.warn(`  Warning: Chat post failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }

      if (msg.type === "result") {
        const resultMsg = msg as EngineResultMessage;
        result = {
          sessionId: resultMsg.session_id,
          totalCostUsd: resultMsg.total_cost_usd,
          inputTokens: resultMsg.usage.input_tokens,
          outputTokens: resultMsg.usage.output_tokens,
          numTurns: resultMsg.num_turns,
          durationMs: resultMsg.duration_ms,
          modelUsage: resultMsg.modelUsage,
        };
      }
    }

    return result;
  }

  private buildAgentChatPrompt(agentRole: string, config: AicibConfig): string {
    const agentsDir = getAgentsDir(this.projectDir);
    const presetName = config.persona?.preset || "professional";
    const templateDir = getTemplatePath(config.company.template);

    let preset: PersonaOverlay | undefined;
    try {
      preset = loadPreset(templateDir, presetName);
    } catch { /* use base personality */ }

    let overridePreset: PersonaOverlay | undefined;
    if (config.persona?.overrides?.[agentRole]) {
      try {
        overridePreset = loadPreset(templateDir, config.persona.overrides[agentRole]);
      } catch { /* use global preset */ }
    }

    const agents = loadAgentDefinitions(agentsDir, overridePreset || preset, undefined);
    const agent = agents.get(agentRole);

    if (!agent) {
      return `You are ${formatRoleName(agentRole)} at ${config.company.name}. Reply helpfully and concisely.`;
    }

    const displayName = this.getDisplayName(agentRole);

    return `${agent.content}

## Chat Mode

You are responding directly to the human founder in Slack.
This is a conversational interaction — NOT a formal brief.

- Be helpful, direct, and in-character as ${displayName}
- You can use your tools to answer questions if needed
- Keep responses concise for Slack (1-3 paragraphs max)
- You do NOT need to delegate unless the task truly requires it
- You are at ${config.company.name}

## Working Directory
${this.projectDir}`;
  }

  private getOrCreateChatSession(
    aicibSessionId: string,
    agentRole: string,
    channelId: string
  ): { sdkSessionId: string | null } {
    const row = this.db
      .prepare(
        `SELECT sdk_session_id FROM slack_chat_sessions
         WHERE aicib_session_id = ? AND agent_role = ?`
      )
      .get(aicibSessionId, agentRole) as { sdk_session_id: string | null } | undefined;

    if (row) {
      return { sdkSessionId: row.sdk_session_id };
    }

    this.db
      .prepare(
        `INSERT INTO slack_chat_sessions (aicib_session_id, agent_role, channel_id)
         VALUES (?, ?, ?)`
      )
      .run(aicibSessionId, agentRole, channelId);

    return { sdkSessionId: null };
  }

  private updateChatSession(
    aicibSessionId: string,
    agentRole: string,
    sdkSessionId: string
  ): void {
    this.db
      .prepare(
        `UPDATE slack_chat_sessions
         SET sdk_session_id = ?, last_activity = datetime('now'), message_count = message_count + 1
         WHERE aicib_session_id = ? AND agent_role = ?`
      )
      .run(sdkSessionId, aicibSessionId, agentRole);
  }
}
