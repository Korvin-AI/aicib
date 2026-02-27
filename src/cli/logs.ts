import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { isProcessRunning } from "../core/background-manager.js";
import { header, agentColor, formatUSD } from "./ui.js";

interface LogsOptions {
  dir: string;
  job?: string;
  lines?: string;
}

export async function logsCommand(options: LogsOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  try {
    loadConfig(projectDir); // validate project exists
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  const costTracker = new CostTracker(projectDir);

  try {
    let jobId: number | undefined;

    if (options.job) {
      jobId = Number(options.job);
      if (Number.isNaN(jobId)) {
        console.error(chalk.red("  Error: --job must be a number.\n"));
        costTracker.close();
        process.exit(1);
      }
    } else {
      // Find the most recent background job
      const jobs = costTracker.listBackgroundJobs();
      if (jobs.length === 0) {
        console.log(
          chalk.yellow("\n  No session logs found.\n")
        );
        costTracker.close();
        return;
      }
      jobId = jobs[0].id;
    }

    const job = costTracker.getBackgroundJob(jobId!);
    if (!job) {
      console.error(chalk.red(`\n  Error: Job #${jobId} not found.\n`));
      costTracker.close();
      process.exit(1);
    }

    // Detect foreground jobs by [foreground] prefix
    const isForeground = job.directive.startsWith("[foreground] ");
    const displayDirective = isForeground
      ? job.directive.slice("[foreground] ".length)
      : job.directive;
    const modeLabel = isForeground ? "Foreground" : "Background";

    console.log(header(`${modeLabel} Job #${job.id}`));
    console.log(
      chalk.dim(
        `  Directive: "${displayDirective.slice(0, 80)}${displayDirective.length > 80 ? "..." : ""}"`
      )
    );

    // Show job status
    const statusColor =
      job.status === "completed"
        ? chalk.green
        : job.status === "running"
          ? chalk.yellow
          : chalk.red;

    let statusLabel = statusColor(job.status.toUpperCase());
    if (job.status === "running" && job.pid) {
      const alive = isProcessRunning(job.pid);
      if (!alive) {
        statusLabel = chalk.red("FAILED") + chalk.dim(" (process not found)");
      }
    }
    console.log(chalk.dim(`  Status: `) + statusLabel);
    console.log(chalk.dim(`  Started: ${job.started_at}`));
    if (job.completed_at) {
      console.log(chalk.dim(`  Completed: ${job.completed_at}`));
    }
    console.log();

    // Fetch and display logs
    let limit: number | undefined;
    if (options.lines) {
      const parsed = Number(options.lines);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        console.error(chalk.red("  Error: --lines must be a positive integer.\n"));
        costTracker.close();
        process.exit(1);
      }
      limit = parsed;
    }
    const logs = costTracker.getBackgroundLogs(job.id, limit);

    if (logs.length === 0) {
      console.log(chalk.dim("  No log entries yet.\n"));
    } else {
      for (const log of logs) {
        const time = chalk.dim(log.timestamp.split(" ")[1] || log.timestamp);
        const colorFn = agentColor(log.agent_role || "system");
        const role = log.agent_role
          ? colorFn(`[${log.agent_role}]`)
          : "";
        console.log(`  ${time} ${role} ${log.content}`);
      }
      console.log();
    }

    // Show summary footer
    if (job.status === "completed") {
      console.log(
        chalk.dim(
          `  Cost: ${formatUSD(job.total_cost_usd)} | Turns: ${job.num_turns} | Duration: ${(job.duration_ms / 1000).toFixed(1)}s\n`
        )
      );
    } else if (job.status === "failed" && job.error_message) {
      console.log(
        chalk.red(`  Error: ${job.error_message}\n`)
      );
    }

    costTracker.close();
  } catch (error) {
    console.error(
      chalk.red(
        `\n  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
    costTracker.close();
    process.exit(1);
  }
}
