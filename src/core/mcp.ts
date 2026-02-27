/**
 * MCP Integration Framework — core module.
 *
 * Provides:
 * - Built-in catalog of well-known MCP servers
 * - Per-agent MCP server resolution
 * - Config validation
 * - Prompt context formatting
 * - Config management helpers (add/remove servers)
 */

import type { MCPServerConfig } from "./engine/types.js";
import type { AicibConfig, AgentConfig } from "./config.js";
import { saveConfig } from "./config.js";
import { CostTracker } from "./cost-tracker.js";

// ============================================
// TYPES
// ============================================

/** A full server definition as stored in `integrations.servers.<name>`. */
export interface MCPServerDefinition {
  command: string;
  args: string[];
  env?: Record<string, string>;
  url?: string;
  description?: string;
  category?: string;
}

/** Shape of a built-in catalog entry (template for well-known servers). */
export interface BuiltinServerEntry {
  command: string;
  args: string[];
  env_template: Record<string, string>;
  required_env: string[];
  description: string;
  category: string;
  default_roles: string[];
}

/** Composio gateway configuration. */
export interface ComposioConfig {
  enabled: boolean;
  api_key: string;
}

/** The `integrations:` config section shape. */
export interface MCPIntegrationsConfig {
  enabled: boolean;
  composio: ComposioConfig;
  servers: Record<string, MCPServerDefinition>;
  per_agent: Record<string, string[]>;
  default_servers: string[];
}

/** Runtime status for an MCP server (from DB). */
export interface MCPServerStatus {
  server_name: string;
  status: string;
  last_used: string | null;
  use_count: number;
  error_count: number;
  last_error: string | null;
  added_at: string;
}

// ============================================
// TYPE GUARD
// ============================================

/** Extract and narrow the MCP integrations config from an AicibConfig. */
export function getMCPConfig(config: AicibConfig): MCPIntegrationsConfig | undefined {
  const raw = config.extensions?.integrations;
  if (!raw || typeof raw !== "object") return undefined;
  return raw as MCPIntegrationsConfig;
}

// ============================================
// DEFAULTS
// ============================================

export const MCP_CONFIG_DEFAULTS: MCPIntegrationsConfig = {
  enabled: true,
  composio: { enabled: false, api_key: "" },
  servers: {},
  per_agent: {},
  default_servers: [],
};

// ============================================
// BUILT-IN SERVER CATALOG
// ============================================

export const BUILTIN_SERVER_CATALOG: Record<string, BuiltinServerEntry> = {
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env_template: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
    required_env: ["GITHUB_TOKEN"],
    description: "GitHub — code, issues, PRs, repos",
    category: "development",
    default_roles: ["cto", "backend-engineer", "frontend-engineer"],
  },
  linear: {
    command: "npx",
    args: ["-y", "@linear/mcp-server"],
    env_template: { LINEAR_API_KEY: "${LINEAR_API_KEY}" },
    required_env: ["LINEAR_API_KEY"],
    description: "Linear — project management, issues, cycles",
    category: "project-management",
    default_roles: ["cto", "ceo"],
  },
  notion: {
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env_template: {
      OPENAPI_MCP_HEADERS:
        '{"Authorization":"Bearer ${NOTION_TOKEN}","Notion-Version":"2022-06-28"}',
    },
    required_env: ["NOTION_TOKEN"],
    description: "Notion — docs, wikis, databases",
    category: "knowledge",
    default_roles: ["ceo", "cmo", "content-writer"],
  },
  playwright: {
    command: "npx",
    args: ["-y", "@playwright/mcp@0.0.68"],
    env_template: {},
    required_env: [],
    description: "Playwright — browser automation and testing",
    category: "automation",
    default_roles: ["frontend-engineer", "cmo"],
  },
  "slack-mcp": {
    command: "npx",
    args: ["-y", "@anthropic/slack-mcp-server"],
    env_template: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
    required_env: ["SLACK_BOT_TOKEN"],
    description: "Slack — messaging and team communication",
    category: "communication",
    default_roles: ["ceo", "cto"],
  },
  stripe: {
    command: "npx",
    args: ["-y", "@stripe/mcp-server"],
    env_template: { STRIPE_SECRET_KEY: "${STRIPE_SECRET_KEY}" },
    required_env: ["STRIPE_SECRET_KEY"],
    description: "Stripe — payments, subscriptions, invoices",
    category: "finance",
    default_roles: ["cfo"],
  },
};

// ============================================
// VALIDATION
// ============================================

export function validateMCPConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return errors;

  const obj = raw as Record<string, unknown>;

  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    errors.push("integrations.enabled must be a boolean");
  }

  if (obj.composio !== undefined) {
    if (typeof obj.composio !== "object" || obj.composio === null) {
      errors.push("integrations.composio must be an object");
    } else {
      const c = obj.composio as Record<string, unknown>;
      if (c.enabled !== undefined && typeof c.enabled !== "boolean") {
        errors.push("integrations.composio.enabled must be a boolean");
      }
      if (c.api_key !== undefined && typeof c.api_key !== "string") {
        errors.push("integrations.composio.api_key must be a string");
      }
    }
  }

  if (obj.servers !== undefined) {
    if (typeof obj.servers !== "object" || obj.servers === null || Array.isArray(obj.servers)) {
      errors.push("integrations.servers must be an object");
    } else {
      for (const [name, serverRaw] of Object.entries(
        obj.servers as Record<string, unknown>
      )) {
        if (!serverRaw || typeof serverRaw !== "object") {
          errors.push(`integrations.servers.${name} must be an object`);
          continue;
        }
        const server = serverRaw as Record<string, unknown>;
        if (!server.command || typeof server.command !== "string") {
          errors.push(`integrations.servers.${name}.command must be a non-empty string`);
        }
        if (!Array.isArray(server.args)) {
          errors.push(`integrations.servers.${name}.args must be an array`);
        }
      }
    }
  }

  if (obj.per_agent !== undefined) {
    if (typeof obj.per_agent !== "object" || obj.per_agent === null || Array.isArray(obj.per_agent)) {
      errors.push("integrations.per_agent must be an object");
    } else {
      for (const [role, servers] of Object.entries(
        obj.per_agent as Record<string, unknown>
      )) {
        if (!Array.isArray(servers)) {
          errors.push(`integrations.per_agent.${role} must be an array of server names`);
        }
      }
    }
  }

  if (obj.default_servers !== undefined && !Array.isArray(obj.default_servers)) {
    errors.push("integrations.default_servers must be an array");
  }

  // Validate that referenced server names exist in config or built-in catalog
  const knownServers = new Set([
    ...Object.keys((obj.servers as Record<string, unknown>) || {}),
    ...Object.keys(BUILTIN_SERVER_CATALOG),
  ]);

  if (obj.per_agent && typeof obj.per_agent === "object" && !Array.isArray(obj.per_agent)) {
    for (const [role, servers] of Object.entries(obj.per_agent as Record<string, unknown>)) {
      if (Array.isArray(servers)) {
        for (const name of servers) {
          if (typeof name === "string" && !knownServers.has(name)) {
            errors.push(`integrations.per_agent.${role} references unknown server "${name}"`);
          }
        }
      }
    }
  }

  if (Array.isArray(obj.default_servers)) {
    for (const name of obj.default_servers as unknown[]) {
      if (typeof name === "string" && !knownServers.has(name)) {
        errors.push(`integrations.default_servers references unknown server "${name}"`);
      }
    }
  }

  return errors;
}

// ============================================
// RESOLUTION
// ============================================

/**
 * Resolves `${ENV_VAR}` patterns in a string using `process.env`.
 * Returns the resolved string.
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return process.env[varName] || "";
  });
}

/**
 * Checks whether all required env vars for a server are available.
 * Returns the list of missing var names.
 */
function findMissingEnvVars(envTemplate: Record<string, string>): string[] {
  const missing: string[] = [];
  const envVarPattern = /\$\{([^}]+)\}/g;
  for (const value of Object.values(envTemplate)) {
    let match: RegExpExecArray | null;
    while ((match = envVarPattern.exec(value)) !== null) {
      if (!process.env[match[1]]) {
        missing.push(match[1]);
      }
    }
  }
  return [...new Set(missing)];
}

/**
 * Side-effect-free check: can a server name be resolved?
 * Returns true if the server is known and has all required env vars.
 * Does NOT emit warnings — use this for filtering/display logic.
 */
function canResolveServer(
  serverName: string,
  mcpConfig: MCPIntegrationsConfig
): boolean {
  const configServer = mcpConfig.servers[serverName];
  if (configServer) {
    if (configServer.env && findMissingEnvVars(configServer.env).length > 0) {
      return false;
    }
    return true;
  }
  const builtin = BUILTIN_SERVER_CATALOG[serverName];
  if (builtin) {
    return findMissingEnvVars(builtin.env_template).length === 0;
  }
  return false;
}

/**
 * Resolves a server name to an MCPServerConfig.
 * Looks up in config servers first, then falls back to the built-in catalog.
 * Returns null if the server can't be resolved (missing env vars, unknown name).
 * Emits console.warn for skipped servers — call only from resolution entry points.
 */
function resolveServer(
  serverName: string,
  mcpConfig: MCPIntegrationsConfig
): MCPServerConfig | null {
  // Check explicit config first
  const configServer = mcpConfig.servers[serverName];
  if (configServer) {
    // Check for missing env vars FIRST
    if (configServer.env) {
      const missing = findMissingEnvVars(configServer.env);
      if (missing.length > 0) {
        console.warn(
          `  Warning: MCP server "${serverName}" skipped — missing env vars: ${missing.join(", ")}`
        );
        return null;
      }
    }

    // THEN resolve env values
    const env: Record<string, string> = {};
    if (configServer.env) {
      for (const [k, v] of Object.entries(configServer.env)) {
        env[k] = resolveEnvVars(v);
      }
    }

    return {
      command: configServer.command,
      args: [...configServer.args],
      env: Object.keys(env).length > 0 ? env : undefined,
      url: configServer.url,
    };
  }

  // Fall back to built-in catalog
  const builtin = BUILTIN_SERVER_CATALOG[serverName];
  if (builtin) {
    const missing = findMissingEnvVars(builtin.env_template);
    if (missing.length > 0) {
      console.warn(
        `  Warning: MCP server "${serverName}" skipped — missing env vars: ${missing.join(", ")}`
      );
      return null;
    }

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(builtin.env_template)) {
      env[k] = resolveEnvVars(v);
    }

    return {
      command: builtin.command,
      args: [...builtin.args],
      env: Object.keys(env).length > 0 ? env : undefined,
    };
  }

  // Unknown server
  console.warn(
    `  Warning: MCP server "${serverName}" not found in config or built-in catalog — skipping`
  );
  return null;
}

/**
 * Collects the list of server names a given agent role should have access to.
 * Sources (in priority order):
 *  1. `integrations.per_agent.<role>` (explicit per-agent assignment)
 *  2. `agents.<role>.mcp_servers` (inline agent config)
 *  3. `integrations.default_servers` (fallback defaults)
 */
function collectServerNamesForRole(
  role: string,
  config: AicibConfig
): string[] {
  const mcpConfig = getMCPConfig(config);
  const names = new Set<string>();

  // Source 1: per_agent map in integrations config
  if (mcpConfig?.per_agent?.[role]) {
    for (const name of mcpConfig.per_agent[role]) {
      names.add(name);
    }
  }

  // Source 2: inline mcp_servers on the agent config
  const agentConfig: AgentConfig | undefined = config.agents[role];
  if (agentConfig?.mcp_servers) {
    for (const name of agentConfig.mcp_servers) {
      names.add(name);
    }
  }

  // Also check workers (nested under parent agents)
  for (const agent of Object.values(config.agents)) {
    if (agent.workers) {
      for (const workerEntry of agent.workers) {
        for (const [workerName, workerConfig] of Object.entries(workerEntry)) {
          if (workerName === role && workerConfig.mcp_servers) {
            for (const name of workerConfig.mcp_servers) {
              names.add(name);
            }
          }
        }
      }
    }
  }

  // Source 3: default servers (if no explicit assignment found)
  if (names.size === 0 && mcpConfig?.default_servers) {
    for (const name of mcpConfig.default_servers) {
      names.add(name);
    }
  }

  return [...names];
}

/**
 * Resolves which MCP servers a given agent role should have.
 * Returns a map of server name -> MCPServerConfig ready for the engine.
 */
export function resolveMCPServersForRole(
  role: string,
  config: AicibConfig
): Record<string, MCPServerConfig> {
  const mcpConfig = getMCPConfig(config);
  if (!mcpConfig?.enabled) return {};

  const serverNames = collectServerNamesForRole(role, config);
  const result: Record<string, MCPServerConfig> = {};

  for (const name of serverNames) {
    const resolved = resolveServer(name, mcpConfig);
    if (resolved) {
      result[name] = resolved;
    }
  }

  return result;
}

/**
 * Resolves the union of ALL agents' MCP servers (for session-level injection).
 */
export function resolveAllMCPServers(
  config: AicibConfig
): Record<string, MCPServerConfig> {
  const mcpConfig = getMCPConfig(config);
  if (!mcpConfig?.enabled) return {};

  // Collect all unique server names across all agents
  const allNames = new Set<string>();

  // From per_agent
  if (mcpConfig.per_agent) {
    for (const servers of Object.values(mcpConfig.per_agent)) {
      for (const name of servers) {
        allNames.add(name);
      }
    }
  }

  // From inline agent configs
  for (const [, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.enabled === false) continue;
    if (agentConfig.mcp_servers) {
      for (const name of agentConfig.mcp_servers) {
        allNames.add(name);
      }
    }
    // Workers
    if (agentConfig.workers) {
      for (const workerEntry of agentConfig.workers) {
        for (const [, workerConfig] of Object.entries(workerEntry)) {
          if (workerConfig.mcp_servers) {
            for (const name of workerConfig.mcp_servers) {
              allNames.add(name);
            }
          }
        }
      }
    }
  }

  // From default servers
  if (mcpConfig.default_servers) {
    for (const name of mcpConfig.default_servers) {
      allNames.add(name);
    }
  }

  const result: Record<string, MCPServerConfig> = {};
  for (const name of allNames) {
    const resolved = resolveServer(name, mcpConfig);
    if (resolved) {
      result[name] = resolved;
    }
  }

  return result;
}

// ============================================
// CONTEXT FORMATTING
// ============================================

/**
 * Builds the MCP prompt context block for a given list of server names.
 * Uses the config + catalog for descriptions. Does not resolve or warn.
 */
export function formatMCPContextFromNames(
  serverNames: string[],
  mcpConfig: MCPIntegrationsConfig
): string {
  if (serverNames.length === 0) return "";

  const lines: string[] = ["## Your MCP Tools (External Integrations)", ""];
  lines.push(
    "You have access to the following external tools via MCP servers."
  );
  lines.push(
    "Use them by calling tools prefixed with `mcp__<server>__` (e.g., `mcp__github__list_issues`)."
  );
  lines.push("");

  for (const name of serverNames) {
    const configServer = mcpConfig.servers[name];
    const builtin = BUILTIN_SERVER_CATALOG[name];
    const description =
      configServer?.description || builtin?.description || name;
    const category = configServer?.category || builtin?.category || "general";
    lines.push(`- **${name}** (${category}): ${description}`);
  }

  return lines.join("\n");
}

/**
 * Generates prompt text listing available MCP tools for a specific agent role.
 * Injected into agent prompts so they know which external tools they can use.
 */
export function formatMCPContextForRole(
  role: string,
  config: AicibConfig
): string {
  const mcpConfig = getMCPConfig(config);
  if (!mcpConfig?.enabled) return "";

  const serverNames = collectServerNamesForRole(role, config);
  if (serverNames.length === 0) return "";

  // Only list servers that actually resolve (have required env vars, etc.)
  // Uses canResolveServer (no warnings) — warnings are emitted once at resolution time.
  const resolvedNames = serverNames.filter(name => canResolveServer(name, mcpConfig));

  return formatMCPContextFromNames(resolvedNames, mcpConfig);
}

/**
 * Generates an overview of all MCP integrations for the CEO prompt.
 * Shows which agents have which integrations.
 */
export function formatMCPOverview(config: AicibConfig): string {
  const mcpConfig = getMCPConfig(config);
  if (!mcpConfig?.enabled) return "";

  // Collect all agent->servers mappings
  const agentServers = new Map<string, string[]>();

  // From per_agent
  if (mcpConfig.per_agent) {
    for (const [role, servers] of Object.entries(mcpConfig.per_agent)) {
      agentServers.set(role, [...(agentServers.get(role) || []), ...servers]);
    }
  }

  // From inline agent configs
  for (const [role, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.mcp_servers) {
      const existing = agentServers.get(role) || [];
      agentServers.set(role, [...existing, ...agentConfig.mcp_servers]);
    }
    // Workers
    if (agentConfig.workers) {
      for (const workerEntry of agentConfig.workers) {
        for (const [workerName, workerConfig] of Object.entries(workerEntry)) {
          if (workerConfig.mcp_servers) {
            const existing = agentServers.get(workerName) || [];
            agentServers.set(workerName, [
              ...existing,
              ...workerConfig.mcp_servers,
            ]);
          }
        }
      }
    }
  }

  if (agentServers.size === 0) return "";

  const lines: string[] = [
    "## MCP Integrations (External Tools)",
    "",
    "Your team has access to external tools via MCP servers:",
    "",
  ];

  for (const [role, servers] of agentServers) {
    const unique = [...new Set(servers)];
    lines.push(`- **${role}**: ${unique.join(", ")}`);
  }

  lines.push("");
  lines.push(
    "When delegating tasks that require external tools, assign them to agents with the relevant integrations."
  );

  return lines.join("\n");
}

// ============================================
// CONFIG MANAGEMENT
// ============================================

/**
 * Reads MCP server status from the state database.
 */
export function getMCPServerStatus(projectDir: string): MCPServerStatus[] {
  let tracker: CostTracker | undefined;
  try {
    tracker = new CostTracker(projectDir);
    return tracker.queryRegisteredTable<MCPServerStatus>(
      "SELECT * FROM mcp_integrations ORDER BY server_name"
    );
  } catch {
    return [];
  } finally {
    tracker?.close();
  }
}

/**
 * Upserts MCP usage tracking for a server.
 * Called from the message handler when an MCP tool call is detected.
 */
export function upsertMCPUsage(projectDir: string, serverName: string): void {
  let tracker: CostTracker | undefined;
  try {
    tracker = new CostTracker(projectDir);
    tracker.runOnRegisteredTable(
      `INSERT INTO mcp_integrations (server_name, status, last_used, use_count)
       VALUES (?, 'active', datetime('now'), 1)
       ON CONFLICT(server_name) DO UPDATE SET
         status = 'active',
         last_used = datetime('now'),
         use_count = use_count + 1`,
      serverName
    );
  } catch (e) { console.warn(`  [MCP] Usage tracking failed: ${e instanceof Error ? e.message : String(e)}`); }
  finally { tracker?.close(); }
}

/**
 * Adds a server to the integrations config in YAML.
 */
export function addServerToConfig(
  projectDir: string,
  serverName: string,
  serverDef: MCPServerDefinition,
  config: AicibConfig
): void {
  const mcpConfig = config.extensions.integrations as MCPIntegrationsConfig;

  if (!mcpConfig.servers) mcpConfig.servers = {};
  mcpConfig.servers[serverName] = serverDef;
  mcpConfig.enabled = true;

  config.extensions.integrations = mcpConfig;
  saveConfig(projectDir, config);
}

/**
 * Removes a server from the integrations config in YAML.
 */
export function removeServerFromConfig(
  projectDir: string,
  serverName: string,
  config: AicibConfig
): void {
  const mcpConfig = getMCPConfig(config);
  if (!mcpConfig) return;

  // Remove from servers
  if (mcpConfig.servers) {
    delete mcpConfig.servers[serverName];
  }

  // Remove from per_agent
  if (mcpConfig.per_agent) {
    for (const [role, servers] of Object.entries(mcpConfig.per_agent)) {
      mcpConfig.per_agent[role] = servers.filter((s) => s !== serverName);
      if (mcpConfig.per_agent[role].length === 0) {
        delete mcpConfig.per_agent[role];
      }
    }
  }

  // Remove from default_servers
  if (mcpConfig.default_servers) {
    mcpConfig.default_servers = mcpConfig.default_servers.filter(
      (s) => s !== serverName
    );
  }

  // Remove from inline agent configs (agents.<role>.mcp_servers and worker-level mcp_servers)
  for (const agentConfig of Object.values(config.agents)) {
    if (agentConfig.mcp_servers) {
      agentConfig.mcp_servers = agentConfig.mcp_servers.filter(s => s !== serverName);
    }
    if (agentConfig.workers) {
      for (const workerEntry of agentConfig.workers) {
        for (const workerConfig of Object.values(workerEntry)) {
          if (workerConfig.mcp_servers) {
            workerConfig.mcp_servers = workerConfig.mcp_servers.filter(s => s !== serverName);
          }
        }
      }
    }
  }

  config.extensions.integrations = mcpConfig;
  saveConfig(projectDir, config);
}
