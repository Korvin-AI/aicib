import path from "node:path";
import chalk from "chalk";
import { loadConfig, listAllAgents } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { getTeamStatusSummary } from "../core/team.js";
import { isProcessRunning } from "../core/background-manager.js";
import { buildOrgTree, renderOrgChart } from "../core/org-chart.js";
import {
  header,
  createTable,
  agentColor,
  formatTimeAgo,
  formatUSD,
} from "./ui.js";
import { TaskManager } from "../core/task-manager.js";

interface StatusOptions {
  dir: string;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
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

  console.log(header("Status"));

  try {
    const costTracker = new CostTracker(projectDir);
    const summary = getTeamStatusSummary(costTracker, config);
    console.log(summary);

    // Show active SDK session indicator
    const activeSDKSession = costTracker.getActiveSDKSessionId();
    if (activeSDKSession) {
      console.log(
        chalk.bold("  Session: ") +
          chalk.green("ACTIVE") +
          chalk.dim(` (${activeSDKSession.sdkSessionId})`)
      );
      console.log();

      // Show org chart
      try {
        const orgTree = buildOrgTree(projectDir, config);
        const chart = renderOrgChart(orgTree);
        for (const line of chart.split("\n")) {
          console.log(`    ${line}`);
        }
        console.log();
      } catch {
        // Org chart is best-effort
      }

      // Show background job status
      const activeJob = costTracker.getActiveBackgroundJob(
        activeSDKSession.sessionId
      );

      if (activeJob) {
        // Check if the worker process is actually still alive
        const alive = activeJob.pid ? isProcessRunning(activeJob.pid) : false;

        if (alive) {
          console.log(
            chalk.bold("  Background work: ") +
              chalk.yellow("IN PROGRESS")
          );
          console.log(
            chalk.dim(
              `    Directive: "${activeJob.directive.slice(0, 70)}${activeJob.directive.length > 70 ? "..." : ""}"`
            )
          );
          console.log(
            chalk.dim(
              `    Started: ${formatTimeAgo(activeJob.started_at)} | Job #${activeJob.id} | PID ${activeJob.pid}`
            )
          );
        } else {
          // Process died but DB still says running — mark as failed
          costTracker.updateBackgroundJob(activeJob.id, {
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: "Worker process not found (crashed or killed externally)",
          });
          console.log(
            chalk.bold("  Background work: ") +
              chalk.red("FAILED") +
              chalk.dim(" (worker process not found)")
          );
          console.log(
            chalk.dim(
              `    Directive: "${activeJob.directive.slice(0, 70)}${activeJob.directive.length > 70 ? "..." : ""}"`
            )
          );
        }
        console.log();
      } else {
        // Show most recent completed/failed job
        const recentJobs = costTracker.listBackgroundJobs(
          activeSDKSession.sessionId
        );
        const lastJob = recentJobs[0];

        if (lastJob) {
          if (lastJob.status === "completed") {
            console.log(
              chalk.bold("  Last background work: ") +
                chalk.green("COMPLETED")
            );
            console.log(
              chalk.dim(
                `    Directive: "${lastJob.directive.slice(0, 70)}${lastJob.directive.length > 70 ? "..." : ""}"`
              )
            );
            console.log(
              chalk.dim(
                `    Cost: ${formatUSD(lastJob.total_cost_usd)} | Turns: ${lastJob.num_turns} | ${formatTimeAgo(lastJob.completed_at!)}`
              )
            );
          } else if (lastJob.status === "failed") {
            console.log(
              chalk.bold("  Last background work: ") +
                chalk.red("FAILED")
            );
            console.log(
              chalk.dim(
                `    Directive: "${lastJob.directive.slice(0, 70)}${lastJob.directive.length > 70 ? "..." : ""}"`
              )
            );
            console.log(
              chalk.dim(
                `    Error: ${lastJob.error_message || "Unknown error"}`
              )
            );
          }
          console.log();
        }
      }
    }

    // Show configured agents in a table with runtime status
    const allAgents = listAllAgents(config);
    const runtimeStatuses = costTracker.getAgentStatuses();
    const statusMap = new Map(
      runtimeStatuses.map((s) => [s.agent_role, s])
    );

    const agentTable = createTable(
      ["Agent", "Model", "Status", "Task"],
      [22, 10, 12, 30]
    );

    for (const agent of allAgents) {
      const colorFn = agentColor(agent.role);
      let statusStr: string;

      if (!agent.enabled) {
        statusStr = chalk.red("disabled");
      } else {
        const runtime = statusMap.get(agent.role);
        if (runtime) {
          switch (runtime.status) {
            case "working":
              statusStr = chalk.yellow("working");
              break;
            case "error":
              statusStr = chalk.red("error");
              break;
            case "idle":
              statusStr = chalk.green("idle");
              break;
            default:
              statusStr = chalk.dim(runtime.status);
          }
        } else {
          statusStr = chalk.dim("stopped");
        }
      }

      const runtime = statusMap.get(agent.role);
      const taskStr =
        runtime?.current_task && runtime.status === "working"
          ? chalk.dim(
              runtime.current_task.length > 28
                ? runtime.current_task.slice(0, 28) + "..."
                : runtime.current_task
            )
          : "";

      agentTable.push([
        colorFn(agent.role),
        agent.model,
        statusStr,
        taskStr,
      ]);
    }

    console.log(agentTable.toString());
    console.log();

    // Task summary
    try {
      const taskManager = new TaskManager(projectDir);
      try {
        const taskSummary = taskManager.getTaskSummary();
        if (taskSummary.total > 0) {
          const reviewNote =
            taskSummary.in_review > 0
              ? chalk.yellow(` (${taskSummary.in_review} awaiting review)`)
              : "";
          console.log(
            chalk.bold("  Tasks: ") +
              chalk.dim(`${taskSummary.backlog} backlog`) +
              " | " +
              chalk.white(`${taskSummary.todo} todo`) +
              " | " +
              chalk.cyan(`${taskSummary.in_progress} active`) +
              " | " +
              chalk.yellow(`${taskSummary.in_review} review`) +
              " | " +
              chalk.green(`${taskSummary.done} done`) +
              reviewNote
          );
          console.log();
        }
      } finally {
        taskManager.close();
      }
    } catch {
      // Task system not initialized yet — skip silently
    }

    costTracker.close();
  } catch (error) {
    // If no state DB exists yet, just show config
    const allAgents = listAllAgents(config);
    console.log(`  Company: ${config.company.name}`);
    console.log(`  Template: ${config.company.template}\n`);

    const agentTable = createTable(
      ["Agent", "Model", "Status"],
      [22, 10, 10]
    );

    for (const agent of allAgents) {
      const colorFn = agentColor(agent.role);
      const enabledStr = agent.enabled
        ? chalk.green("enabled")
        : chalk.red("disabled");
      agentTable.push([
        colorFn(agent.role),
        agent.model,
        enabledStr,
      ]);
    }

    console.log(agentTable.toString());

    console.log(
      chalk.yellow("\n  No active session. Run 'aicib start' to launch.\n")
    );
  }
}
