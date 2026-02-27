/**
 * CLI commands for MCP Integration management: list, add, remove, status.
 */

import path from "node:path";
import chalk from "chalk";

import { loadConfig } from "../core/config.js";
import { header, createTable, formatTimeAgo } from "./ui.js";
import {
  BUILTIN_SERVER_CATALOG,
  getMCPServerStatus,
  getMCPConfig,
  addServerToConfig,
  removeServerFromConfig,
  type MCPServerDefinition,
} from "../core/mcp.js";

interface IntegrationOptions {
  dir: string;
}

// --- List command ---

export async function integrationsListCommand(
  options: IntegrationOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  console.log(header("MCP Integrations"));

  const mcpConfig = getMCPConfig(config);

  // Show configured servers
  const configuredServers = mcpConfig?.servers || {};
  const configuredNames = new Set(Object.keys(configuredServers));

  if (configuredNames.size > 0) {
    console.log(chalk.bold("  Configured Servers\n"));

    const table = createTable(
      ["Server", "Category", "Description", "Agents"],
      [18, 20, 36, 30]
    );

    for (const [name, server] of Object.entries(configuredServers)) {
      const builtin = BUILTIN_SERVER_CATALOG[name];
      const category = server.category || builtin?.category || "custom";
      const description =
        server.description || builtin?.description || "Custom server";

      // Find which agents use this server
      const agents: string[] = [];
      if (mcpConfig?.per_agent) {
        for (const [role, servers] of Object.entries(mcpConfig.per_agent)) {
          if (servers.includes(name)) agents.push(role);
        }
      }
      for (const [role, agentConfig] of Object.entries(config.agents)) {
        if (agentConfig.mcp_servers?.includes(name)) {
          if (!agents.includes(role)) agents.push(role);
        }
        if (agentConfig.workers) {
          for (const workerEntry of agentConfig.workers) {
            for (const [workerName, workerConfig] of Object.entries(workerEntry)) {
              if (workerConfig.mcp_servers?.includes(name)) {
                if (!agents.includes(workerName)) agents.push(workerName);
              }
            }
          }
        }
      }

      table.push([
        chalk.cyan(name),
        category,
        description,
        agents.length > 0 ? agents.join(", ") : chalk.dim("(unassigned)"),
      ]);
    }

    console.log(table.toString());
  } else {
    console.log(
      chalk.dim("  No servers configured yet. Add one with: aicib integrations add <server>\n")
    );
  }

  // Show available built-in servers not yet configured
  const availableNames = Object.keys(BUILTIN_SERVER_CATALOG).filter(
    (name) => !configuredNames.has(name)
  );

  if (availableNames.length > 0) {
    console.log(chalk.bold("\n  Available Built-in Servers\n"));

    const availTable = createTable(
      ["Server", "Category", "Description", "Required Env"],
      [18, 20, 36, 28]
    );

    for (const name of availableNames) {
      const entry = BUILTIN_SERVER_CATALOG[name];
      availTable.push([
        chalk.dim(name),
        entry.category,
        entry.description,
        entry.required_env.length > 0
          ? entry.required_env.join(", ")
          : chalk.green("(none)"),
      ]);
    }

    console.log(availTable.toString());
    console.log(
      chalk.dim("\n  Add with: aicib integrations add <server>\n")
    );
  }
}

// --- Add command ---

export async function integrationsAddCommand(
  serverName: string,
  options: IntegrationOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  console.log(header("Add MCP Integration"));

  const mcpConfig = getMCPConfig(config);

  // Check if already configured
  if (mcpConfig?.servers?.[serverName]) {
    console.log(
      chalk.yellow(
        `  Server "${serverName}" is already configured. Remove it first to reconfigure.\n`
      )
    );
    process.exit(1);
  }

  // Check built-in catalog
  const builtin = BUILTIN_SERVER_CATALOG[serverName];
  if (builtin) {
    console.log(`  Adding ${chalk.cyan(serverName)}: ${builtin.description}\n`);

    // Check required env vars
    if (builtin.required_env.length > 0) {
      const missing: string[] = [];
      for (const envVar of builtin.required_env) {
        if (process.env[envVar]) {
          console.log(chalk.green(`  ${envVar}: set`));
        } else {
          console.log(chalk.red(`  ${envVar}: not set`));
          missing.push(envVar);
        }
      }

      if (missing.length > 0) {
        console.log(
          chalk.yellow(
            `\n  Missing environment variables: ${missing.join(", ")}`
          )
        );
        console.log(
          chalk.yellow(
            `  Set them before using this integration (e.g., export ${missing[0]}=your-token)\n`
          )
        );
        console.log(
          chalk.dim(
            "  The server will be added to config but won't be active until env vars are set.\n"
          )
        );
      }
    }

    // Build server definition from catalog template
    const serverDef: MCPServerDefinition = {
      command: builtin.command,
      args: [...builtin.args],
      env: { ...builtin.env_template },
      description: builtin.description,
      category: builtin.category,
    };

    addServerToConfig(projectDir, serverName, serverDef, config);

    console.log(chalk.green(`\n  Server "${serverName}" added to config.\n`));

    if (builtin.default_roles.length > 0) {
      console.log(
        chalk.dim(
          `  Suggested agents: ${builtin.default_roles.join(", ")}`
        )
      );
      console.log(
        chalk.dim(
          `  Assign via: agents.<role>.mcp_servers: ["${serverName}"] in aicib.config.yaml\n`
        )
      );
    }
  } else {
    // Custom server -- provide instructions
    console.log(
      chalk.yellow(
        `  "${serverName}" is not in the built-in catalog.\n`
      )
    );
    console.log(
      "  To add a custom MCP server, edit aicib.config.yaml directly:"
    );
    console.log(chalk.dim(`
  integrations:
    servers:
      ${serverName}:
        command: "npx"
        args: ["-y", "@your/mcp-server"]
        env:
          API_KEY: "\${YOUR_API_KEY}"
        description: "Your custom server"
        category: "custom"
`));
    process.exit(1);
  }
}

// --- Remove command ---

export async function integrationsRemoveCommand(
  serverName: string,
  options: IntegrationOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  console.log(header("Remove MCP Integration"));

  const mcpConfig = getMCPConfig(config);

  if (!mcpConfig?.servers?.[serverName]) {
    console.log(
      chalk.yellow(`  Server "${serverName}" is not configured.\n`)
    );
    process.exit(1);
  }

  removeServerFromConfig(projectDir, serverName, config);

  console.log(
    chalk.green(
      `  Server "${serverName}" removed from config and all agent assignments.\n`
    )
  );
}

// --- Status command ---

export async function integrationsStatusCommand(
  options: IntegrationOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  console.log(header("MCP Integration Status"));

  const mcpConfig = getMCPConfig(config);

  const enabled = mcpConfig?.enabled ?? true;
  console.log(
    `  MCP Framework: ${enabled ? chalk.green("ENABLED") : chalk.red("DISABLED")}\n`
  );

  if (!enabled) {
    console.log(
      chalk.dim("  Enable with: integrations.enabled: true in aicib.config.yaml\n")
    );
    return;
  }

  // Show configured servers with their env var status
  const servers = mcpConfig?.servers || {};
  if (Object.keys(servers).length === 0) {
    console.log(
      chalk.dim("  No servers configured. Add one with: aicib integrations add <server>\n")
    );
    return;
  }

  const table = createTable(
    ["Server", "Status", "Uses", "Last Used", "Errors"],
    [18, 16, 10, 18, 10]
  );

  // Get runtime status from DB
  const statusRows = getMCPServerStatus(projectDir);
  const statusMap = new Map(statusRows.map((r) => [r.server_name, r]));

  for (const [name, server] of Object.entries(servers)) {
    const builtin = BUILTIN_SERVER_CATALOG[name];
    const envTemplate = server.env || builtin?.env_template || {};

    // Check env vars
    let envOk = true;
    const envVarPattern = /\$\{([^}]+)\}/g;
    for (const value of Object.values(envTemplate)) {
      let match: RegExpExecArray | null;
      while ((match = envVarPattern.exec(value)) !== null) {
        if (!process.env[match[1]]) {
          envOk = false;
          break;
        }
      }
      if (!envOk) break;
    }

    const status = statusMap.get(name);
    const statusText = !envOk
      ? chalk.red("missing env")
      : status?.status === "active"
        ? chalk.green("active")
        : chalk.cyan("configured");

    table.push([
      chalk.cyan(name),
      statusText,
      String(status?.use_count ?? 0),
      status?.last_used ? formatTimeAgo(status.last_used) : chalk.dim("never"),
      String(status?.error_count ?? 0),
    ]);
  }

  console.log(table.toString());

  // Composio status
  if (mcpConfig?.composio?.enabled) {
    console.log(
      chalk.bold("\n  Composio Gateway: ") + chalk.green("ENABLED")
    );
  }

  console.log();
}
