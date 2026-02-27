import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { killBackgroundJob } from "../core/background-manager.js";
import {
  header,
  createTable,
  agentColor,
  formatUSD,
} from "./ui.js";

interface StopOptions {
  dir: string;
}

export async function stopCommand(options: StopOptions): Promise<void> {
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

  console.log(header("Stopping team"));

  const spinner = ora("  Shutting down...").start();

  try {
    const costTracker = new CostTracker(projectDir);
    const activeSession = costTracker.getActiveSession();

    if (!activeSession) {
      spinner.info("  No active session found.\n");
      costTracker.close();
      return;
    }

    // Kill ALL running background jobs (not just the current session's)
    const runningJobs = costTracker.getAllRunningBackgroundJobs();
    for (const job of runningJobs) {
      spinner.text = `  Stopping background job #${job.id}...`;
      killBackgroundJob(job, costTracker, "Stopped by user");
    }

    // Mark all agents as stopped
    spinner.text = "  Marking agents as stopped...";
    const statuses = costTracker.getAgentStatuses();
    for (const agent of statuses) {
      costTracker.setAgentStatus(agent.agent_role, "stopped");
    }

    // End ALL active sessions (prevents stale sessions from being resumed)
    costTracker.endAllActiveSessions();

    spinner.succeed("  Team stopped successfully.\n");

    console.log(`  Session ${chalk.dim(activeSession)} ended.`);
    console.log(
      chalk.green("  All agents marked as stopped.\n")
    );

    // Show final cost summary in a table
    const costs = costTracker.getCostByAgent(activeSession);
    if (costs.length > 0) {
      const table = createTable(
        ["Agent", "Cost (USD)"],
        [22, 14]
      );

      let total = 0;
      for (const cost of costs) {
        const colorFn = agentColor(cost.role);
        table.push([
          colorFn(cost.role),
          formatUSD(cost.total_cost_usd),
        ]);
        total += cost.total_cost_usd;
      }

      table.push([
        chalk.bold("Total"),
        chalk.bold(formatUSD(total)),
      ]);

      console.log(table.toString());
      console.log();
    }

    costTracker.close();
  } catch (error) {
    spinner.fail("  Failed to stop team");
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
    process.exit(1);
  }
}
