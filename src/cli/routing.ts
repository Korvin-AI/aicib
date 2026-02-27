/**
 * CLI command: `aicib routing`
 *
 * Displays the current communication routing configuration:
 * mode, log_violations flag, custom rules, department roster,
 * and the active communication policy text.
 */

import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { loadAgentDefinitions } from "../core/agents.js";
import { getAgentsDir } from "../core/team.js";
import {
  ROUTING_CONFIG_DEFAULTS,
  formatRoutingContext,
  type RoutingConfig,
} from "../core/routing.js";
import { header, createTable } from "./ui.js";

interface RoutingOptions {
  dir: string;
}

export async function routingCommand(options: RoutingOptions): Promise<void> {
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

  const routingConfig = (config.extensions?.routing as RoutingConfig | undefined) ??
    ROUTING_CONFIG_DEFAULTS;

  console.log(header("Communication Routing"));

  // Status overview
  const statusTable = createTable(["Setting", "Value"], [30, 40]);
  statusTable.push(
    [
      "Enabled",
      routingConfig.enabled
        ? chalk.green("yes")
        : chalk.red("no"),
    ],
    ["Mode", chalk.cyan(routingConfig.mode)],
    [
      "Log Violations",
      routingConfig.log_violations
        ? chalk.green("yes")
        : chalk.dim("no"),
    ],
    ["Custom Rules", String(routingConfig.custom_rules.length)],
  );
  console.log(statusTable.toString());

  // Custom rules detail
  if (routingConfig.custom_rules.length > 0) {
    console.log(chalk.bold("\n  Custom Rules:\n"));
    const rulesTable = createTable(
      ["From Dept", "To Dept", "Mode"],
      [25, 25, 25]
    );
    for (const rule of routingConfig.custom_rules) {
      rulesTable.push([
        rule.from_department,
        rule.to_department,
        chalk.cyan(rule.mode),
      ]);
    }
    console.log(rulesTable.toString());
  }

  // Department roster
  try {
    const agentsDir = getAgentsDir(projectDir);
    const agents = loadAgentDefinitions(agentsDir);

    const depts = new Map<string, string[]>();
    for (const [role, agent] of agents) {
      const dept = agent.frontmatter.department || "general";
      if (!depts.has(dept)) depts.set(dept, []);
      depts.get(dept)!.push(role);
    }

    console.log(chalk.bold("\n  Department Roster:\n"));
    const deptTable = createTable(["Department", "Agents"], [20, 50]);
    for (const [dept, roles] of depts) {
      deptTable.push([chalk.cyan(dept), roles.join(", ")]);
    }
    console.log(deptTable.toString());
  } catch {
    console.log(chalk.dim("\n  No agents loaded — run `aicib init` first.\n"));
  }

  // Active policy text
  if (routingConfig.enabled) {
    console.log(chalk.bold("\n  Active Communication Policy:\n"));
    const policyText = formatRoutingContext(routingConfig);
    // Indent each line for CLI display
    for (const line of policyText.split("\n")) {
      console.log(`  ${chalk.dim(line)}`);
    }
  }

  console.log("");
}
