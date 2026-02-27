import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../core/config.js";
import { loadAgentDefinitions } from "../core/agents.js";
import { getAgentsDir, createTeamState } from "../core/team.js";
import { CostTracker } from "../core/cost-tracker.js";
import {
  startCEOSession,
  recordRunCosts,
} from "../core/agent-runner.js";
import { formatMessageWithColor } from "../core/output-formatter.js";
import { buildOrgTree, renderOrgChart } from "../core/org-chart.js";
import { header, agentColor, formatUSD } from "./ui.js";

interface StartOptions {
  dir: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Starting team"));

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    console.error(chalk.yellow(`  Run 'aicib init' first.\n`));
    process.exit(1);
  }

  // Verify agent definitions exist
  const agentsDir = getAgentsDir(projectDir);
  // Metadata only — persona overlay not needed
  const agents = loadAgentDefinitions(agentsDir);

  if (agents.size === 0) {
    console.error(
      chalk.red("  Error: No agent definitions found in .claude/agents/")
    );
    console.error(chalk.yellow("  Run 'aicib init' to create them.\n"));
    process.exit(1);
  }

  // Check for existing active session BEFORE creating a new one
  {
    const checkTracker = new CostTracker(projectDir);
    const existingSession = checkTracker.getActiveSDKSessionId();
    if (existingSession) {
      console.log(
        chalk.red("\n  Error: Team already running!")
      );
      console.log(
        chalk.yellow(
          `\n  Active session: ${chalk.dim(existingSession.sdkSessionId)}`
        )
      );
      console.log(
        chalk.yellow(
          "  Use 'aicib brief' to send directives, or 'aicib stop' to end the session.\n"
        )
      );
      checkTracker.close();
      return;
    }
    checkTracker.close();
  }

  const spinner = ora("  Initializing team state...").start();

  try {
    const teamState = createTeamState(projectDir, config);

    // Set initial statuses
    for (const [role] of agents) {
      teamState.costTracker.setAgentStatus(role, "starting");
    }

    spinner.text = "  Starting CEO session via SDK...";

    // Print team info
    spinner.succeed("  Team configuration ready!\n");

    console.log(chalk.bold("  Team: ") + config.company.name);
    console.log(chalk.bold("  Session: ") + teamState.sessionId);

    // Display org chart
    try {
      const orgTree = buildOrgTree(projectDir, config);
      console.log();
      const chart = renderOrgChart(orgTree);
      for (const line of chart.split("\n")) {
        console.log(`    ${line}`);
      }
      console.log();
    } catch {
      // Fallback to plain agent list
      console.log(chalk.bold("  Agents:"));
      for (const [role, agent] of agents) {
        const agentConfig = config.agents[role];
        const model = agentConfig?.model || agent.frontmatter.model;
        const colorFn = agentColor(role);
        console.log(
          `    ${chalk.green("\u2192")} ${agent.frontmatter.title} (${colorFn(role)}) \u2014 ${model}`
        );
      }
    }

    console.log(
      chalk.bold("  Cost limits: ") +
        `$${config.settings.cost_limit_daily}/day, $${config.settings.cost_limit_monthly}/month`
    );

    console.log(chalk.bold("\n  Launching CEO...\n"));

    // Start the CEO session using the Agent SDK
    const result = await startCEOSession(projectDir, config, (msg) => {
      const formatted = formatMessageWithColor(msg);
      if (formatted) {
        console.log(`  ${formatted}`);
      }
    });

    // Save the SDK session ID so `brief` can resume it later
    teamState.costTracker.saveSDKSessionId(
      teamState.sessionId,
      result.sessionId,
      projectDir,
      config.company.name
    );

    // Record costs
    recordRunCosts(
      result,
      teamState.costTracker,
      teamState.sessionId,
      "ceo",
      config.agents.ceo?.model || "opus"
    );

    // Update agent statuses
    for (const [role] of agents) {
      teamState.costTracker.setAgentStatus(role, "idle");
    }

    console.log(chalk.green("\n  Team is ready!"));
    console.log(
      chalk.dim(
        `  SDK Session: ${result.sessionId}`
      )
    );
    console.log(
      chalk.dim(
        `  Cost: ${formatUSD(result.totalCostUsd)} | Turns: ${result.numTurns}`
      )
    );
    console.log(
      chalk.bold("\n  Use 'aicib brief \"your directive\"' to send directives.\n")
    );

    teamState.costTracker.close();
  } catch (error) {
    spinner.fail("  Failed to start team");
    console.error(
      chalk.red(
        `\n  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
    process.exit(1);
  }
}
