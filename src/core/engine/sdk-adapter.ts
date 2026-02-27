/**
 * Claude SDK engine adapter.
 *
 * Implements the AgentEngine interface by wrapping the SDK's query() function.
 * This is the only file that calls `query()` from the SDK package.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEngine } from "./engine-interface.js";
import type {
  EngineMessage,
  EngineQueryOptions,
  EngineAgentDefinition,
  SDKAgentDefinition,
} from "./types.js";
import {
  resolveModelId,
  toSDKShortName,
  supportedShortNames as getShortNames,
} from "../model-router.js";

/**
 * Convert our flexible EngineAgentDefinition → SDK's AgentDefinition.
 * The SDK requires model to be 'opus'|'sonnet'|'haiku'|'inherit'.
 */
function toSDKAgents(
  agents: Record<string, EngineAgentDefinition>
): Record<string, SDKAgentDefinition> {
  const result: Record<string, SDKAgentDefinition> = {};
  for (const [name, agent] of Object.entries(agents)) {
    result[name] = {
      description: agent.description,
      prompt: agent.prompt,
      tools: agent.tools,
      disallowedTools: agent.disallowedTools,
      model: agent.model ? toSDKShortName(agent.model) : undefined,
      maxTurns: agent.maxTurns,
      ...(agent.mcpServers?.length ? { mcpServers: agent.mcpServers } : {}),
    };
  }
  return result;
}

export class ClaudeSDKEngine implements AgentEngine {
  startSession(options: EngineQueryOptions): AsyncIterable<EngineMessage> {
    return query({
      prompt: options.prompt,
      options: {
        systemPrompt: options.systemPrompt,
        model: options.model,
        cwd: options.cwd,
        tools: options.tools,
        agents: options.agents ? toSDKAgents(options.agents) : undefined,
        permissionMode: options.permissionMode,
        allowDangerouslySkipPermissions:
          options.allowDangerouslySkipPermissions,
        maxBudgetUsd: options.maxBudgetUsd,
        maxTurns: options.maxTurns,
        mcpServers: options.mcpServers,
        allowedTools: options.allowedTools,
      },
    });
  }

  resumeSession(
    sessionId: string,
    options: EngineQueryOptions
  ): AsyncIterable<EngineMessage> {
    return query({
      prompt: options.prompt,
      options: {
        resume: sessionId,
        model: options.model,
        cwd: options.cwd,
        tools: options.tools,
        agents: options.agents ? toSDKAgents(options.agents) : undefined,
        permissionMode: options.permissionMode,
        allowDangerouslySkipPermissions:
          options.allowDangerouslySkipPermissions,
        maxBudgetUsd: options.maxBudgetUsd,
        maxTurns: options.maxTurns,
        mcpServers: options.mcpServers,
        allowedTools: options.allowedTools,
      },
    });
  }

  resolveModelName(name: string): string {
    return resolveModelId(name);
  }

  supportedShortNames(): string[] {
    return getShortNames();
  }
}
