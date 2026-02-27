/**
 * Hook registration for the Communication Routing system (#37).
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `routing:` section in aicib.config.yaml
 * - Context provider: communication-routing (injects routing policy into CEO prompt)
 * - Message handler: routing-monitor (detects ROUTE:: markers, logs violations)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  ROUTING_CONFIG_DEFAULTS,
  validateRoutingConfig,
  evaluateRoute,
  formatRoutingContext,
  type RoutingConfig,
} from "./routing.js";
import { loadAgentDefinitions } from "./agents.js";
import { getAgentsDir } from "./team.js";

// ============================================
// CONFIG EXTENSION
// ============================================

registerConfigExtension({
  key: "routing",
  defaults: { ...ROUTING_CONFIG_DEFAULTS },
  validate: validateRoutingConfig,
});

// ============================================
// CONTEXT PROVIDER
// ============================================

// Module-level projectDir set by the context provider, read by the message handler.
let lastProjectDir: string | null = null;

registerContextProvider("communication-routing", (config, projectDir) => {
  lastProjectDir = projectDir;

  const routingConfig = config.extensions?.routing as
    | RoutingConfig
    | undefined;
  if (!routingConfig?.enabled) return "";

  return formatRoutingContext(routingConfig);
});

// ============================================
// MESSAGE HANDLER
// ============================================

registerMessageHandler("routing-monitor", (msg, config) => {
  const routingConfig = config.extensions?.routing as
    | RoutingConfig
    | undefined;
  if (!routingConfig?.enabled) return;

  if (msg.type !== "assistant") return;

  const content = msg.message?.content;
  if (!content) return;

  let text = "";
  for (const block of content) {
    if ("text" in block && block.text) {
      text += block.text + "\n";
    }
  }
  if (!text) return;
  if (!lastProjectDir) return;

  // Load agents to resolve departments
  let agentDepts: Map<string, string>;
  try {
    const agentsDir = getAgentsDir(lastProjectDir);
    const agents = loadAgentDefinitions(agentsDir);
    agentDepts = new Map<string, string>();
    for (const [role, agent] of agents) {
      agentDepts.set(role.toLowerCase(), agent.frontmatter.department || "");
    }
  } catch {
    return; // Can't resolve departments — skip routing checks
  }

  // Parse ROUTE::SEND markers
  const sendMatches = text.matchAll(
    /ROUTE::SEND\s+from=(\S+)\s+to=(\S+)(?:\s+message="([^"]*)")?/g
  );
  for (const match of sendMatches) {
    const fromRole = match[1].toLowerCase();
    const toRole = match[2].toLowerCase();
    const fromDept = agentDepts.get(fromRole) || "";
    const toDept = agentDepts.get(toRole) || "";

    const result = evaluateRoute(fromRole, fromDept, toRole, toDept, routingConfig);
    if (!result.allowed && routingConfig.log_violations) {
      console.warn(
        `[ROUTING VIOLATION] ${result.violation}`
      );
    }
    if (result.requiresCC.length > 0 && routingConfig.log_violations) {
      console.warn(
        `[ROUTING CC] ${fromRole} → ${toRole}: CC required for ${result.requiresCC.join(", ")}`
      );
    }
  }

  // Parse ROUTE::CC markers (informational logging)
  const ccMatches = text.matchAll(
    /ROUTE::CC\s+agent=(\S+)(?:\s+message="([^"]*)")?/g
  );
  for (const match of ccMatches) {
    if (routingConfig.log_violations) {
      console.warn(
        `[ROUTING CC] CC notification to ${match[1]}${match[2] ? `: ${match[2]}` : ""}`
      );
    }
  }

  // Natural language fallback patterns for violation detection
  const nlSendPatterns = text.matchAll(
    /(?:sending to|messaging|contacting)\s+([\w-]+)/gi
  );
  for (const match of nlSendPatterns) {
    const toRole = match[1].toLowerCase();
    const toDept = agentDepts.get(toRole) || "";
    // Assume message comes from "ceo" in NL context (since CEO is generating these)
    const fromDept = agentDepts.get("ceo") || "";

    if (fromDept && toDept && fromDept !== toDept) {
      const result = evaluateRoute("ceo", fromDept, toRole, toDept, routingConfig);
      if (!result.allowed && routingConfig.log_violations) {
        console.warn(
          `[ROUTING VIOLATION] ${result.violation}`
        );
      }
    }
  }
});
