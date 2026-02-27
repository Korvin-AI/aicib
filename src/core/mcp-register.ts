/**
 * Hook registration for the MCP Integration Framework (#15).
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `integrations:` section in aicib.config.yaml
 * - Database table: mcp_integrations (tracks server status and usage)
 * - Context provider: mcp-integrations (injects MCP overview into CEO prompt)
 * - Message handler: mcp-usage-tracker (tracks MCP tool usage from agent messages)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  MCP_CONFIG_DEFAULTS,
  validateMCPConfig,
  formatMCPOverview,
  upsertMCPUsage,
  getMCPConfig,
} from "./mcp.js";

// ============================================
// CONFIG EXTENSION
// ============================================

registerConfigExtension({
  key: "integrations",
  defaults: { ...MCP_CONFIG_DEFAULTS },
  validate: validateMCPConfig,
});

// ============================================
// DATABASE TABLE
// ============================================

registerTable({
  name: "mcp_integrations",
  createSQL: `CREATE TABLE IF NOT EXISTS mcp_integrations (
    server_name TEXT PRIMARY KEY,
    status TEXT DEFAULT 'configured',
    last_used TEXT,
    use_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    added_at TEXT DEFAULT (datetime('now'))
  )`,
});

// ============================================
// CONTEXT PROVIDER
// ============================================

// Module-level projectDir set by the context provider, read by the message handler.
let lastProjectDir: string | null = null;

registerContextProvider("mcp-integrations", (config, projectDir) => {
  lastProjectDir = projectDir;

  const mcpConfig = getMCPConfig(config);
  if (!mcpConfig?.enabled) return "";

  return formatMCPOverview(config);
});

// ============================================
// MESSAGE HANDLER
// ============================================

registerMessageHandler("mcp-usage-tracker", (msg) => {
  // Track MCP tool usage from assistant messages.
  // Looks for tool_use blocks with names starting with "mcp__".
  if (msg.type !== "assistant") return;

  const content = msg.message?.content;
  if (!content) return;

  for (const block of content) {
    if (
      "type" in block &&
      (block as { type: string }).type === "tool_use" &&
      "name" in block &&
      typeof (block as { name: string }).name === "string"
    ) {
      const toolName = (block as { name: string }).name;
      if (toolName.startsWith("mcp__")) {
        // Extract server name: mcp__<server>__<tool> -> <server>
        const parts = toolName.split("__");
        if (parts.length >= 3) {
          const serverName = parts[1];
          // Update DB usage tracking (replaces console.warn-only observability)
          if (lastProjectDir) {
            upsertMCPUsage(lastProjectDir, serverName);
          }
        }
      }
    }
  }
});
