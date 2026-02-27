/**
 * Engine barrel export + factory.
 *
 * All engine-related imports should come through this module:
 *   import { getEngine, type EngineMessage } from "./engine/index.js";
 */

// Re-export all types
export type {
  EngineMessage,
  EngineResultMessage,
  EngineSystemMessage,
  EngineModelUsage,
  EngineAgentDefinition,
  EngineQueryOptions,
} from "./types.js";

// Re-export interface
export type { AgentEngine } from "./engine-interface.js";

// Re-export adapter class
export { ClaudeSDKEngine } from "./sdk-adapter.js";

// --- Singleton engine factory ---

import type { AgentEngine } from "./engine-interface.js";
import { ClaudeSDKEngine } from "./sdk-adapter.js";

let currentEngine: AgentEngine | null = null;

/**
 * Get the active engine instance (singleton).
 * Defaults to ClaudeSDKEngine on first call.
 */
export function getEngine(): AgentEngine {
  if (!currentEngine) {
    currentEngine = new ClaudeSDKEngine();
  }
  return currentEngine;
}

/**
 * Replace the active engine (for testing or future engine swaps).
 */
export function setEngine(engine: AgentEngine): void {
  currentEngine = engine;
}

/**
 * Reset the engine to default (for test teardown).
 * Next call to getEngine() will create a fresh ClaudeSDKEngine.
 */
export function resetEngine(): void {
  currentEngine = null;
}
