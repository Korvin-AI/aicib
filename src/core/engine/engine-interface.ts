/**
 * The universal adapter contract.
 *
 * Any engine backend (Claude SDK, LiteLLM, Ollama, raw API) must implement
 * this interface. AICIB's core code calls these methods — never the SDK directly.
 */

import type { EngineMessage, EngineQueryOptions } from "./types.js";

export interface AgentEngine {
  /**
   * Start a new session. Returns an async iterable of streamed messages.
   */
  startSession(options: EngineQueryOptions): AsyncIterable<EngineMessage>;

  /**
   * Resume an existing session by SDK session ID.
   */
  resumeSession(
    sessionId: string,
    options: EngineQueryOptions
  ): AsyncIterable<EngineMessage>;

  /**
   * Resolve a model name (short or full) to the canonical full model ID.
   * E.g. "opus" → "claude-opus-4-6"
   */
  resolveModelName(name: string): string;

  /**
   * List the short names this engine supports (e.g. ["opus", "sonnet", "haiku"]).
   */
  supportedShortNames(): string[];
}
