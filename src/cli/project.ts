import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { ProjectPlanner, type Project, type ProjectPhase } from "../core/project-planner.js";
import { killBackgroundJob, isProcessRunning } from "../core/background-manager.js";
import { header, formatUSD, formatTimeAgo, createTable } from "./ui.js";

// ── Helpers ───────────────────────────────────────────────────────

function getProjectPlanner(dir: string): ProjectPlanner {
  const projectDir = path.resolve(dir);

  try {
    loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  return new ProjectPlanner(projectDir);
}

function formatProjectStatus(status: string): string {
  switch (status) {
    case "planning":
      return chalk.blue("planning");
    case "executing":
      return chalk.cyan("executing");
    case "paused":
      return chalk.yellow("paused");
    case "completed":
      return chalk.green("completed");
    case "failed":
      return chalk.red("failed");
    case "cancelled":
      return chalk.red("cancelled");
    default:
      return chalk.dim(status);
  }
}

function formatPhaseStatus(status: string): string {
  switch (status) {
    case "pending":
      return chalk.dim("pending");
    case "executing":
      return chalk.cyan("executing");
    case "reviewing":
      return chalk.yellow("reviewing");
    case "completed":
      return chalk.green("completed");
    case "failed":
      return chalk.red("failed");
    case "skipped":
      return chalk.dim("skipped");
    default:
      return chalk.dim(status);
  }
}

function phaseIcon(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green("\u2713");
    case "executing":
      return chalk.cyan("\u25B6");
    case "reviewing":
      return chalk.yellow("\u25CF");
    case "failed":
      return chalk.red("\u2717");
    case "skipped":
      return chalk.dim("\u2013");
    default:
      return chalk.dim("\u25CB");
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = secs / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  const hours = mins / 60;
  return `${hours.toFixed(1)}h`;
}

// ── Commands ──────────────────────────────────────────────────────

interface ProjectOptions {
  dir: string;
}

/**
 * `aicib project status` — shows active project with phase progress.
 */
export async function projectStatusCommand(
  options: ProjectOptions
): Promise<void> {
  const pp = getProjectPlanner(options.dir);

  try {
    console.log(header("Project Status"));

    const active = pp.getActiveProject();
    if (!active) {
      // Show most recent project instead
      const all = pp.listProjects();
      if (all.length === 0) {
        console.log(chalk.dim("  No projects found."));
        console.log(
          chalk.dim(
            '  Start one with: aicib brief -p "your project brief"\n'
          )
        );
        return;
      }

      // Show the most recent project
      showProjectDetail(pp, all[0]);
      return;
    }

    showProjectDetail(pp, active);
  } finally {
    pp.close();
  }
}

function showProjectDetail(pp: ProjectPlanner, project: Project): void {
  console.log(chalk.bold(`  ${project.title}`));
  console.log(chalk.dim("  " + "\u2500".repeat(60)));

  console.log(
    `  Status:    ${formatProjectStatus(project.status)}` +
      `     Phases: ${project.completed_phases}/${project.total_phases}`
  );
  console.log(
    `  Cost:      ${formatUSD(project.total_cost_usd)}` +
      `     Turns:  ${project.total_turns}`
  );
  if (project.total_duration_ms > 0) {
    console.log(`  Duration:  ${formatDuration(project.total_duration_ms)}`);
  }
  console.log(`  Created:   ${formatTimeAgo(project.created_at)}`);
  if (project.completed_at) {
    console.log(`  Completed: ${formatTimeAgo(project.completed_at)}`);
  }
  if (project.error_message) {
    console.log(chalk.red(`  Error:     ${project.error_message}`));
  }

  // Phase list
  const phases = pp.getPhases(project.id);
  if (phases.length > 0) {
    console.log();
    console.log(chalk.bold("  Phases:"));

    for (const phase of phases) {
      const icon = phaseIcon(phase.status);
      const costStr = phase.cost_usd > 0 ? ` ${formatUSD(phase.cost_usd)}` : "";
      const durationStr = phase.duration_ms > 0 ? ` ${formatDuration(phase.duration_ms)}` : "";
      const attemptStr = phase.attempt > 1 ? chalk.yellow(` (attempt ${phase.attempt})`) : "";

      console.log(
        `    ${icon} Phase ${phase.phase_number}: ${truncate(phase.title, 40)} ${formatPhaseStatus(phase.status)}${attemptStr}${chalk.dim(costStr)}${chalk.dim(durationStr)}`
      );
    }
  }

  console.log();
}

/**
 * `aicib project list` — lists all projects with status.
 */
export async function projectListCommand(
  options: ProjectOptions
): Promise<void> {
  const pp = getProjectPlanner(options.dir);

  try {
    console.log(header("Projects"));

    const projects = pp.listProjects();
    if (projects.length === 0) {
      console.log(chalk.dim("  No projects found."));
      console.log(
        chalk.dim(
          '  Start one with: aicib brief -p "your project brief"\n'
        )
      );
      return;
    }

    const table = createTable(
      ["ID", "Title", "Status", "Phases", "Cost", "Created"],
      [5, 32, 12, 8, 10, 10]
    );

    for (const project of projects) {
      const phaseStr = `${project.completed_phases}/${project.total_phases}`;
      table.push([
        String(project.id),
        truncate(project.title, 30),
        formatProjectStatus(project.status),
        phaseStr,
        formatUSD(project.total_cost_usd),
        chalk.dim(formatTimeAgo(project.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log();
  } finally {
    pp.close();
  }
}

/**
 * `aicib project cancel` — cancels the active project and kills the worker.
 */
export async function projectCancelCommand(
  options: ProjectOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);
  const pp = getProjectPlanner(options.dir);
  const costTracker = new CostTracker(projectDir);

  try {
    console.log(header("Cancel Project"));

    const active = pp.getActiveProject();
    if (!active) {
      console.log(chalk.dim("  No active project to cancel.\n"));
      return;
    }

    console.log(`  Cancelling: "${truncate(active.title, 50)}"`);

    // Mark project as cancelled
    pp.updateProject(active.id, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_message: "Cancelled by user",
    });

    // Kill background worker if running — use the project's session_id (the one
    // that created the job), not the current CLI session which may have changed.
    const runningJob = costTracker.getActiveBackgroundJob(active.session_id);
    if (runningJob && runningJob.pid && isProcessRunning(runningJob.pid)) {
      killBackgroundJob(runningJob, costTracker, "Project cancelled by user");
      console.log(chalk.dim(`  Killed worker process (PID ${runningJob.pid})`));
    }

    // Set CEO status to idle
    costTracker.setAgentStatus("ceo", "idle");

    console.log(chalk.green(`  ${chalk.bold("\u2713")} Project #${active.id} cancelled.\n`));
  } finally {
    pp.close();
    costTracker.close();
  }
}
