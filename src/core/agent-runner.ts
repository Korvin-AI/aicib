import {
  getEngine,
  type EngineMessage,
  type EngineResultMessage,
  type EngineSystemMessage,
  type EngineModelUsage,
  type EngineAgentDefinition,
} from "./engine/index.js";
import { getModelTier } from "./model-router.js";
import { loadAgentDefinitions, getTemplatePath } from "./agents.js";
import { getAgentsDir } from "./team.js";
import { CostTracker } from "./cost-tracker.js";
import type { AicibConfig } from "./config.js";
import type { PersonaOverlay, AgentPersonaConfig } from "./persona.js";
import { loadPreset } from "./persona.js";
import { resolveAllMCPServers, resolveMCPServersForRole, formatMCPContextFromNames, getMCPConfig } from "./mcp.js";
import chalk from "chalk";

// Tools from soul.md that don't exist in the SDK — filter these out
const EXCLUDED_TOOLS = new Set(["SendMessage", "TeamCreate"]);

// --- Hook System ---
// Context providers and message handlers allow future features to plug into
// agent-runner without editing this file.

/**
 * A function that returns context text to inject into the CEO/agent prompts.
 * Called during startCEOSession (system prompt) and sendBrief (brief prompt).
 */
export type ContextProvider = (
  config: AicibConfig,
  projectDir: string
) => string | Promise<string>;

interface ContextProviderEntry {
  name: string;
  provider: ContextProvider;
}

const contextProviders: ContextProviderEntry[] = [];

/**
 * Register a context provider that adds information to CEO/agent prompts.
 * Call at module load time. The returned string is appended to the prompt.
 *
 * Example:
 *   registerContextProvider('task-status', async (config, projectDir) => {
 *     const tasks = await loadActiveTasks(projectDir);
 *     return `## Active Tasks\n${tasks.map(t => `- ${t.title}`).join('\n')}`;
 *   });
 */
export function registerContextProvider(
  name: string,
  provider: ContextProvider
): void {
  if (contextProviders.some((e) => e.name === name)) {
    throw new Error(`Context provider "${name}" is already registered`);
  }
  contextProviders.push({ name, provider });
}

/**
 * A function that processes each SDK message as it streams in.
 * Used by features like Slack to tap into agent communication.
 */
export type MessageHandler = (msg: EngineMessage, config: AicibConfig) => void;

interface MessageHandlerEntry {
  name: string;
  handler: MessageHandler;
}

const messageHandlers: MessageHandlerEntry[] = [];

/**
 * Register a message handler that receives every SDK message.
 * Handlers run after the caller's onMessage callback.
 *
 * Example:
 *   registerMessageHandler('slack-bridge', (msg, config) => {
 *     if (msg.type === 'assistant') forwardToSlack(msg);
 *   });
 */
export function registerMessageHandler(
  name: string,
  handler: MessageHandler
): void {
  if (messageHandlers.some((e) => e.name === name)) {
    throw new Error(`Message handler "${name}" is already registered`);
  }
  messageHandlers.push({ name, handler });
}

/** Gather context from all registered providers. */
async function gatherExtensionContext(
  config: AicibConfig,
  projectDir: string
): Promise<string> {
  let context = "";
  for (const entry of contextProviders) {
    try {
      const result = await entry.provider(config, projectDir);
      if (result && result.trim()) {
        context += `\n\n${result}`;
      }
    } catch (err) {
      console.warn(
        `  Warning: Context provider "${entry.name}" failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return context;
}

/** Notify all registered message handlers. */
function notifyMessageHandlers(msg: EngineMessage, config: AicibConfig): void {
  for (const entry of messageHandlers) {
    try {
      entry.handler(msg, config);
    } catch (err) {
      console.warn(
        `  Warning: Message handler "${entry.name}" failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * Loads the persona preset and per-agent overrides from config.
 * Returns { preset, overrides } ready to pass to loadAgentDefinitions.
 */
function loadPersonaFromConfig(
  config: AicibConfig
): {
  preset?: PersonaOverlay;
  overrides?: Map<string, PersonaOverlay>;
  agentPersonas?: Record<string, AgentPersonaConfig>;
  templateDir: string;
} {
  const presetName = config.persona?.preset || "professional";
  const templateDir = getTemplatePath(config.company.template);

  let preset: PersonaOverlay | undefined;
  try {
    preset = loadPreset(templateDir, presetName);
  } catch (err) {
    // Preset file missing or invalid — warn but don't block execution.
    // This keeps backward compatibility with old templates that lack presets.
    const detail = err instanceof Error ? err.message : String(err);
    if (presetName !== "professional") {
      // Only warn if user explicitly chose a non-default preset
      console.warn(
        `  Warning: Persona preset "${presetName}" could not be loaded (${detail}). Agents will run without personality overlay.`
      );
    } else {
      console.warn(chalk.dim("  Note: No persona preset loaded. Agents running with base personalities only."));
    }
  }

  let overrides: Map<string, PersonaOverlay> | undefined;
  if (config.persona?.overrides) {
    overrides = new Map();
    for (const [role, overridePresetName] of Object.entries(config.persona.overrides)) {
      try {
        overrides.set(role, loadPreset(templateDir, overridePresetName));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(
          `  Warning: Persona override for "${role}" ("${overridePresetName}") could not be loaded (${detail}). Skipping.`
        );
      }
    }
  }

  const agentPersonas = config.persona?.agents;

  return { preset, overrides, agentPersonas, templateDir };
}

export interface SessionResult {
  sessionId: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  durationMs: number;
  modelUsage?: Record<string, EngineModelUsage>;
}

/**
 * Reads all soul.md files, filters to C-suite only (reports_to === "ceo"),
 * and converts each into SDK's AgentDefinition format.
 */
export function buildSubagentMap(
  projectDir: string,
  config: AicibConfig,
  // preloaded avoids double-parsing when caller already loaded persona data
  preloaded?: {
    preset?: PersonaOverlay;
    overrides?: Map<string, PersonaOverlay>;
    agentPersonas?: Record<string, AgentPersonaConfig>;
    templateDir?: string;
  }
): Record<string, EngineAgentDefinition> {
  const agentsDir = getAgentsDir(projectDir);
  const loaded = preloaded || loadPersonaFromConfig(config);
  const { preset, overrides, agentPersonas, templateDir } = loaded;
  const agents = loadAgentDefinitions(agentsDir, preset, overrides, agentPersonas, templateDir);

  // Warn for override keys that don't match any loaded agent role (catches typos in config)
  if (overrides && overrides.size > 0) {
    const agentRoles = new Set(agents.keys());
    for (const key of overrides.keys()) {
      if (!agentRoles.has(key)) {
        console.warn(
          `  Warning: Persona override key "${key}" does not match any agent role. Check spelling in config.`
        );
      }
    }
  }

  const subagents: Record<string, EngineAgentDefinition> = {};

  for (const [role, agent] of agents) {
    // Only include C-suite (reports_to === "ceo"), skip CEO itself and workers
    if (agent.frontmatter.reports_to !== "ceo") continue;

    // Check if this agent is enabled in config
    const agentConfig = config.agents[role];
    if (agentConfig && agentConfig.enabled === false) continue;

    // Filter out tools that don't exist in the SDK
    const tools = (agent.frontmatter.tools || []).filter(
      (t) => !EXCLUDED_TOOLS.has(t)
    );

    // Model from config overrides soul.md default
    const model = agentConfig?.model || agent.frontmatter.model;

    // Use display name from persona studio if configured
    const displayName = agentPersonas?.[role]?.display_name;
    const titlePart = displayName
      ? `${displayName} — ${agent.frontmatter.title}`
      : agent.frontmatter.title;

    // Resolve per-agent MCP servers once — used for both SDK enforcement and prompt context
    const resolvedMCPMap = resolveMCPServersForRole(role, config);
    const roleMCPServers = Object.keys(resolvedMCPMap);

    // Build MCP tool context from already-resolved server names (no double resolution)
    const mcpConfig = getMCPConfig(config);
    const mcpContext = mcpConfig ? formatMCPContextFromNames(roleMCPServers, mcpConfig) : "";
    const fullPrompt = mcpContext
      ? `${agent.content}\n\n${mcpContext}`
      : agent.content;

    subagents[role] = {
      description: `${titlePart} — head of ${agent.frontmatter.department} department. ${agent.frontmatter.spawns?.length ? `Manages: ${agent.frontmatter.spawns.join(", ")}` : ""}`,
      prompt: fullPrompt,
      tools,
      model,
      maxTurns: 200,
      ...(roleMCPServers.length > 0 ? { mcpServers: roleMCPServers } : {}),
    };
  }

  return subagents;
}

/**
 * Creates a new CEO session with subagents. Streams messages via onMessage.
 * Returns session ID, cost, and usage data.
 */
export async function startCEOSession(
  projectDir: string,
  config: AicibConfig,
  onMessage?: (msg: EngineMessage) => void
): Promise<SessionResult> {
  const agentsDir = getAgentsDir(projectDir);
  const personaData = loadPersonaFromConfig(config);
  const agents = loadAgentDefinitions(
    agentsDir, personaData.preset, personaData.overrides,
    personaData.agentPersonas, personaData.templateDir
  );
  const ceoAgent = agents.get("ceo");

  if (!ceoAgent) {
    throw new Error("CEO agent definition not found. Run 'aicib init' first.");
  }

  const subagents = buildSubagentMap(projectDir, config, personaData);
  const ceoModel = config.agents.ceo?.model || ceoAgent.frontmatter.model;

  // Build the team description for the CEO's system prompt
  const teamDescription = Object.entries(subagents)
    .map(([role, def]) => `- **${role}**: ${def.description}`)
    .join("\n");

  // Load recent journal entries for CEO memory
  let journalBlock = "";
  let journalTracker: CostTracker | undefined;
  try {
    journalTracker = new CostTracker(projectDir);
    const entries = journalTracker.getRecentJournalEntries(10);
    if (entries.length > 0) {
      const formatted = journalTracker.formatJournalForContext(entries);
      // Token safety: if too long (~6000 chars ≈ 3000 tokens), trim to 5 entries
      if (formatted.length > 6000) {
        const trimmed = journalTracker.formatJournalForContext(entries.slice(0, 5));
        journalBlock = `\n\n${trimmed}`;
      } else {
        journalBlock = `\n\n${formatted}`;
      }
    }
  } catch (error) {
    // Journal loading is best-effort — warn but don't block session startup
    console.warn("  Warning: Failed to load journal entries:", error instanceof Error ? error.message : String(error));
  } finally {
    journalTracker?.close();
  }

  // Gather context from registered extension providers
  const extensionContext = await gatherExtensionContext(config, projectDir);

  const ceoAppendPrompt = `${ceoAgent.content}

## Your Team (Available via Task tool)

You have the following department heads. Delegate work to them using the Task tool:
${teamDescription}
${journalBlock}${extensionContext}

## Company: ${config.company.name}
## Cost Limits: $${config.settings.cost_limit_daily}/day, $${config.settings.cost_limit_monthly}/month

IMPORTANT: You MUST delegate work to your department heads using the Task tool. Do NOT do implementation work (writing code, creating files, etc.) directly. Your job is to coordinate, plan, and delegate.

## Working Directory
Your project directory is: ${projectDir}
When delegating tasks to department heads, ALWAYS instruct them to save files using absolute paths under this directory. For example, use "${projectDir}/reports/file.md" instead of "reports/file.md". This ensures all output lands in the correct location.`;

  const startPrompt = `You are the CEO of ${config.company.name}. Your team is now active.

Briefly introduce yourself, confirm your team structure (list each department head and what they handle), and state that you are ready for directives from the human founder.

Keep it concise — 3-5 sentences max.`;

  let sessionId = "";
  let result: SessionResult = {
    sessionId: "",
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    numTurns: 0,
    durationMs: 0,
  };

  // Resolve MCP servers for the session (union of all agents' servers)
  const mcpServers = resolveAllMCPServers(config);
  const hasMCPServers = Object.keys(mcpServers).length > 0;

  const queryStream = getEngine().startSession({
    prompt: startPrompt,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: ceoAppendPrompt,
    },
    model: ceoModel,
    cwd: projectDir,
    tools: { type: "preset", preset: "claude_code" },
    agents: subagents,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxBudgetUsd: config.settings.cost_limit_daily,
    maxTurns: 500,
    ...(hasMCPServers ? { mcpServers } : {}),
  });

  for await (const message of queryStream) {
    // Capture session ID from system init message
    if (message.type === "system" && "subtype" in message) {
      const sysMsg = message as EngineSystemMessage;
      if (sysMsg.subtype === "init") {
        sessionId = sysMsg.session_id;
      }
    }

    if (onMessage) {
      onMessage(message);
    }
    notifyMessageHandlers(message, config);

    // Capture result data from the final message
    if (message.type === "result") {
      const resultMsg = message as EngineResultMessage;
      result = {
        sessionId: sessionId || resultMsg.session_id,
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

/**
 * Resumes an existing CEO session and sends a brief/directive.
 */
export async function sendBrief(
  sdkSessionId: string,
  directive: string,
  projectDir: string,
  config: AicibConfig,
  onMessage?: (msg: EngineMessage) => void
): Promise<SessionResult> {
  const agentsDir = getAgentsDir(projectDir);
  const personaData = loadPersonaFromConfig(config);
  const agents = loadAgentDefinitions(
    agentsDir, personaData.preset, personaData.overrides,
    personaData.agentPersonas, personaData.templateDir
  );
  const ceoAgent = agents.get("ceo");

  if (!ceoAgent) {
    throw new Error("CEO agent definition not found.");
  }

  const subagents = buildSubagentMap(projectDir, config, personaData);
  const ceoModel = config.agents.ceo?.model || ceoAgent.frontmatter.model;

  // Gather context from registered extension providers
  const extensionContext = await gatherExtensionContext(config, projectDir);

  const briefPrompt = `DIRECTIVE FROM HUMAN FOUNDER:

${directive}
${extensionContext ? `\n## Current Context\n${extensionContext}\n` : ""}
---
Process this directive according to your CEO role. Decompose into department-level objectives and delegate to your team using the Task tool. Report back with your plan before executing.

REMINDER: Your project directory is ${projectDir}. When delegating to department heads, instruct them to save ALL files using absolute paths under this directory.`;

  let sessionId = sdkSessionId;
  let result: SessionResult = {
    sessionId: sdkSessionId,
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    numTurns: 0,
    durationMs: 0,
  };

  // Resolve MCP servers for the session (union of all agents' servers)
  const mcpServers = resolveAllMCPServers(config);
  const hasMCPServers = Object.keys(mcpServers).length > 0;

  const queryStream = getEngine().resumeSession(sdkSessionId, {
    prompt: briefPrompt,
    model: ceoModel,
    cwd: projectDir,
    tools: { type: "preset", preset: "claude_code" },
    agents: subagents,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxBudgetUsd: config.settings.cost_limit_daily,
    maxTurns: 500,
    ...(hasMCPServers ? { mcpServers } : {}),
  });

  for await (const message of queryStream) {
    if (
      message.type === "system" &&
      "subtype" in message &&
      (message as EngineSystemMessage).subtype === "init"
    ) {
      sessionId = message.session_id;
    }

    if (onMessage) {
      onMessage(message);
    }
    notifyMessageHandlers(message, config);

    if (message.type === "result") {
      const resultMsg = message as EngineResultMessage;
      result = {
        sessionId: sessionId || resultMsg.session_id,
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

/**
 * Generates a journal entry by sending a summarization prompt to the resumed
 * CEO session. Uses Haiku model to keep cost under $0.01 per summary.
 */
export async function generateJournalEntry(
  sdkSessionId: string,
  directive: string,
  result: SessionResult,
  projectDir: string,
  costTracker: CostTracker,
  sessionId: string
): Promise<void> {
  const summaryPrompt = `Generate a concise journal entry (3-5 sentences) covering: what was requested, how you delegated, key decisions, what was produced, and context for future sessions. Reply with ONLY the summary text, no formatting or preamble.`;

  let summaryText = "";

  try {
    const queryStream = getEngine().resumeSession(sdkSessionId, {
      prompt: summaryPrompt,
      model: "haiku",
      cwd: projectDir,
      tools: [],
      permissionMode: "bypassPermissions",
      maxBudgetUsd: 0.05,
    });

    for await (const message of queryStream) {
      if (message.type === "assistant") {
        const content = message.message?.content;
        if (content) {
          for (const block of content) {
            if ("text" in block && block.text) {
              summaryText += block.text;
            }
          }
        }
      }
    }

    if (summaryText.trim()) {
      costTracker.createJournalEntry({
        sessionId,
        directive,
        summary: summaryText.trim(),
        totalCostUsd: result.totalCostUsd,
        numTurns: result.numTurns,
        durationMs: result.durationMs,
      });
    }
  } catch (error) {
    // Journal generation is best-effort — don't break the main flow
    console.warn("  Warning: Journal entry generation failed:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Records run costs from a SessionResult into the cost tracker database.
 * If modelUsage is available, records one entry per model (e.g., ceo-opus, ceo-sonnet).
 * Falls back to a single entry if modelUsage is empty or undefined.
 */
export function recordRunCosts(
  result: SessionResult,
  costTracker: CostTracker,
  sessionId: string,
  agentRole: string = "ceo",
  model: string = "opus"
): void {
  // Per-model breakdown when SDK provides modelUsage
  if (result.modelUsage && Object.keys(result.modelUsage).length > 0) {
    for (const [modelId, usage] of Object.entries(result.modelUsage)) {
      const tier = getModelTier(modelId);
      const label = `${agentRole}-${tier}`;

      // Prefer SDK-reported actual cost when available.
      // We use > 0 rather than >= 0 because costUSD === 0 typically means the
      // SDK didn't report cost for this model, not that the call was free.
      // Falling back to estimated pricing is safer than recording $0.
      if (usage.costUSD > 0) {
        costTracker.recordCostWithActual(
          label,
          sessionId,
          modelId,
          usage.inputTokens,
          usage.outputTokens,
          usage.costUSD
        );
      } else {
        costTracker.recordCost(
          label,
          sessionId,
          modelId,
          usage.inputTokens,
          usage.outputTokens
        );
      }
    }
    return;
  }

  // Fallback: single entry
  costTracker.recordCost(
    agentRole,
    sessionId,
    model,
    result.inputTokens,
    result.outputTokens
  );
}

/**
 * Formats an SDK message for terminal display. Returns null for messages
 * that shouldn't be displayed (tool progress, replays, etc.)
 */
export function formatMessagePlain(message: EngineMessage): string | null {
  if (message.type === "assistant") {
    const content = message.message?.content;
    if (!content) return null;

    const texts: string[] = [];
    for (const block of content) {
      if ("text" in block && block.text) {
        texts.push(block.text);
      } else if ("name" in block) {
        texts.push(`[Tool: ${(block as { name: string }).name}]`);
      }
    }
    if (texts.length > 0) {
      const prefix = message.parent_tool_use_id ? "[SUBAGENT]" : "[CEO]";
      return `${prefix} ${texts.join("\n")}`;
    }
  }

  if (message.type === "system" && "subtype" in message) {
    const sysMsg = message as EngineSystemMessage;
    if (sysMsg.subtype === "init") {
      return `[SYSTEM] Session: ${sysMsg.session_id} | Model: ${sysMsg.model}`;
    }
    if ((sysMsg.subtype as string) === "task_notification") {
      const taskMsg = sysMsg as EngineSystemMessage & {
        taskName?: string;
        taskStatus?: string;
        agentName?: string;
      };
      const agent = taskMsg.agentName || taskMsg.taskName || "subagent";
      const status = taskMsg.taskStatus || "update";
      return `[TASK] ${agent}: ${status}`;
    }
  }

  if (message.type === "result") {
    const resultMsg = message as EngineResultMessage;
    return `[RESULT] Cost: $${resultMsg.total_cost_usd.toFixed(4)} | Turns: ${resultMsg.num_turns} | Duration: ${(resultMsg.duration_ms / 1000).toFixed(1)}s`;
  }

  return null;
}
