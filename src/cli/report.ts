/**
 * CLI commands for the Reporting Suite: dashboard, generate, list, show, templates, schedule.
 *
 * Pattern follows src/cli/schedule.ts.
 */

import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";

import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { header, createTable, formatTimeAgo, formatUSD, agentColor } from "./ui.js";
import {
  ReportManager,
  VALID_REPORT_TYPES,
  VALID_REPORT_STATUSES,
  VALID_DELIVERY_METHODS,
  type ReportingConfig,
  type ReportType,
  type ReportStatus,
  type DeliveryMethod,
} from "../core/reporting.js";
import { ScheduleManager } from "../core/scheduler.js";
import { startBackgroundBrief } from "../core/background-manager.js";

// --- Helpers ---

interface ReportOptions {
  dir: string;
}

function getReportManager(dir: string): ReportManager {
  const projectDir = path.resolve(dir);
  loadConfig(projectDir); // ensure config is loaded (validates)
  return new ReportManager(projectDir);
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function formatStatus(status: string): string {
  switch (status) {
    case "completed": return chalk.green("completed");
    case "generating": return chalk.yellow("generating");
    case "pending": return chalk.dim("pending");
    case "failed": return chalk.red("failed");
    default: return chalk.dim(status);
  }
}

// ── Dashboard (default `aicib report`) ──────────────────────────

export async function reportDashboardCommand(options: ReportOptions): Promise<void> {
  const rm = getReportManager(options.dir);

  try {
    console.log(header("Reporting Dashboard"));

    // Recent reports
    const reports = rm.listReports({ limit: 10 });
    if (reports.length > 0) {
      console.log(chalk.bold("  Recent Reports:"));
      const table = createTable(
        ["ID", "Type", "Title", "Status", "Author", "Created"],
        [6, 20, 28, 12, 10, 12]
      );

      for (const report of reports) {
        table.push([
          String(report.id),
          report.report_type,
          truncate(report.title, 26),
          formatStatus(report.status),
          agentColor(report.author_agent)(truncate(report.author_agent, 8)),
          chalk.dim(formatTimeAgo(report.created_at)),
        ]);
      }

      console.log(table.toString());
      console.log();
    } else {
      console.log(chalk.dim("  No reports generated yet.\n"));
    }

    // Scheduled reports
    const projectDir = path.resolve(options.dir);
    let sm: ScheduleManager | undefined;
    try {
      sm = new ScheduleManager(projectDir);
      const schedules = sm.listSchedules({ enabled: true });
      const reportSchedules = schedules.filter((s) => s.name.startsWith("Report:"));
      if (reportSchedules.length > 0) {
        console.log(chalk.bold("  Scheduled Reports:"));
        for (const s of reportSchedules) {
          const nextRun = s.next_run_at || "not scheduled";
          console.log(`    ${chalk.dim(`#${s.id}`)} ${s.name} — cron: ${s.cron_expression || "N/A"} — next: ${nextRun}`);
        }
        console.log();
      }
    } catch { /* scheduler may not be initialized */ } finally {
      sm?.close();
    }

    // Stats
    const completed = rm.listReports({ status: "completed" }).length;
    const pending = rm.listReports({ status: "pending" }).length;
    const templates = rm.getBuiltinTemplates();

    console.log(chalk.bold("  Summary:"));
    console.log(`    Completed reports: ${completed}`);
    console.log(`    Pending reports: ${pending}`);
    console.log(`    Available templates: ${templates.length}`);
    console.log();
  } finally {
    rm.close();
  }
}

// ── Generate ────────────────────────────────────────────────────

interface GenerateOptions extends ReportOptions {
  delivery?: string;
}

export async function reportGenerateCommand(
  type: string,
  options: GenerateOptions
): Promise<void> {
  if (!VALID_REPORT_TYPES.includes(type as ReportType)) {
    console.error(chalk.red(`  Error: Invalid report type "${type}". Valid: ${VALID_REPORT_TYPES.join(", ")}`));
    process.exit(1);
  }

  const rm = getReportManager(options.dir);

  try {
    const projectDir = path.resolve(options.dir);
    const templates = rm.getBuiltinTemplates();
    const template = templates.find((t) => t.type === type);
    const title = template?.title || `${type} report`;
    const authorAgent = template?.responsible_agent || "ceo";
    if (options.delivery && !VALID_DELIVERY_METHODS.includes(options.delivery as DeliveryMethod)) {
      console.error(chalk.red(`  Error: Invalid delivery method "${options.delivery}". Valid: ${VALID_DELIVERY_METHODS.join(", ")}`));
      rm.close();
      process.exit(1);
    }
    const delivery = (options.delivery as DeliveryMethod) || "file";

    // Collect metrics
    console.log(chalk.dim("  Collecting metrics..."));
    const metrics = rm.collectMetrics(projectDir);

    // Create report record
    const report = rm.createReport({
      report_type: type as ReportType,
      title,
      author_agent: authorAgent,
      metrics_snapshot: JSON.stringify(metrics),
      delivery_method: delivery,
    });

    console.log(header("Report Created"));
    console.log(`  ${chalk.green("\u2713")} Report #${report.id}: ${report.title}`);
    console.log(`  ${chalk.green("\u2713")} Type: ${report.report_type}`);
    console.log(`  ${chalk.green("\u2713")} Author: ${agentColor(authorAgent)(authorAgent)}`);
    console.log(`  ${chalk.green("\u2713")} Delivery: ${delivery}`);
    console.log(`  ${chalk.green("\u2713")} Status: ${formatStatus(report.status)}`);

    // Build directive and spawn background brief if template exists
    if (template) {
      const directive = rm.buildReportDirective(template, metrics, report.id);
      const config = loadConfig(projectDir);
      const costTracker = new CostTracker(projectDir);

      try {
        const activeSession = costTracker.getActiveSDKSessionId();
        if (activeSession) {
          const { jobId } = startBackgroundBrief(
            directive,
            projectDir,
            config,
            activeSession.sdkSessionId,
            activeSession.sessionId,
            costTracker
          );
          rm.updateReport(report.id, { status: "generating" });
          console.log(`  ${chalk.green("\u2713")} Background job #${jobId} spawned for ${authorAgent}`);
        } else {
          console.error(chalk.red("  Error: No active session found."));
          console.error(chalk.yellow("  Run 'aicib start' first, then generate the report.\n"));
          rm.updateReport(report.id, { status: "failed" });
          process.exit(1);
        }
      } finally {
        costTracker.close();
      }
    }

    console.log();
  } finally {
    rm.close();
  }
}

// ── List ────────────────────────────────────────────────────────

interface ListOptions extends ReportOptions {
  type?: string;
  status?: string;
  limit?: string;
}

export async function reportListCommand(options: ListOptions): Promise<void> {
  const rm = getReportManager(options.dir);

  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 20;

    let reportType: ReportType | undefined;
    if (options.type) {
      if (!VALID_REPORT_TYPES.includes(options.type as ReportType)) {
        console.error(chalk.red(`  Error: Invalid report type "${options.type}". Valid: ${VALID_REPORT_TYPES.join(", ")}`));
        rm.close();
        process.exit(1);
      }
      reportType = options.type as ReportType;
    }

    let status: ReportStatus | undefined;
    if (options.status) {
      if (!VALID_REPORT_STATUSES.includes(options.status as ReportStatus)) {
        console.error(chalk.red(`  Error: Invalid status "${options.status}". Valid: ${VALID_REPORT_STATUSES.join(", ")}`));
        rm.close();
        process.exit(1);
      }
      status = options.status as ReportStatus;
    }

    const filterParts: string[] = [];
    if (reportType) filterParts.push(`type=${reportType}`);
    if (status) filterParts.push(`status=${status}`);
    const filterStr = filterParts.length > 0 ? ` (${filterParts.join(", ")})` : "";

    console.log(header(`Reports${filterStr}`));

    const reports = rm.listReports({ report_type: reportType, status, limit });

    if (reports.length === 0) {
      console.log(chalk.dim("  No reports found.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Type", "Title", "Status", "Author", "Created"],
      [6, 20, 28, 12, 10, 12]
    );

    for (const report of reports) {
      table.push([
        String(report.id),
        report.report_type,
        truncate(report.title, 26),
        formatStatus(report.status),
        agentColor(report.author_agent)(truncate(report.author_agent, 8)),
        chalk.dim(formatTimeAgo(report.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  Showing ${reports.length} report(s).\n`));
  } finally {
    rm.close();
  }
}

// ── Show ────────────────────────────────────────────────────────

export async function reportShowCommand(
  id: string,
  options: ReportOptions
): Promise<void> {
  const rm = getReportManager(options.dir);

  try {
    const reportId = parseInt(id, 10);
    if (Number.isNaN(reportId)) {
      console.error(chalk.red("  Error: Report ID must be a number.\n"));
      rm.close();
      process.exit(1);
    }

    const report = rm.getReport(reportId);
    if (!report) {
      console.error(chalk.red(`  Error: Report #${reportId} not found.\n`));
      rm.close();
      process.exit(1);
    }

    console.log(header(`Report #${report.id}`));
    console.log(`  Title:    ${report.title}`);
    console.log(`  Type:     ${report.report_type}`);
    console.log(`  Status:   ${formatStatus(report.status)}`);
    console.log(`  Author:   ${agentColor(report.author_agent)(report.author_agent)}`);
    console.log(`  Delivery: ${report.delivery_method}`);
    console.log(`  Created:  ${report.created_at}`);
    if (report.completed_at) {
      console.log(`  Completed: ${report.completed_at}`);
    }
    if (report.schedule_id) {
      console.log(`  Schedule: #${report.schedule_id}`);
    }

    if (report.content) {
      console.log();
      console.log(chalk.bold("  Content:"));
      console.log();
      // Indent content lines
      for (const line of report.content.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    // Metrics snapshot
    try {
      const metrics = JSON.parse(report.metrics_snapshot);
      if (metrics && Object.keys(metrics).length > 0 && metrics.costs) {
        console.log();
        console.log(chalk.bold("  Metrics Snapshot:"));
        if (metrics.costs.today_usd !== undefined) {
          console.log(`    Today's cost: ${formatUSD(metrics.costs.today_usd)}`);
        }
        if (metrics.costs.month_usd !== undefined) {
          console.log(`    Month cost:   ${formatUSD(metrics.costs.month_usd)}`);
        }
        if (metrics.tasks?.total !== undefined) {
          console.log(`    Total tasks:  ${metrics.tasks.total}`);
        }
      }
    } catch { /* invalid JSON — skip */ }

    console.log();
  } finally {
    rm.close();
  }
}

// ── Templates ───────────────────────────────────────────────────

export async function reportTemplatesCommand(options: ReportOptions): Promise<void> {
  const rm = getReportManager(options.dir);

  try {
    console.log(header("Report Templates"));

    const templates = rm.getBuiltinTemplates();
    const table = createTable(
      ["Type", "Title", "Agent", "Default Cron", "Description"],
      [20, 28, 8, 16, 40]
    );

    for (const t of templates) {
      table.push([
        t.type,
        t.title,
        agentColor(t.responsible_agent)(t.responsible_agent),
        chalk.dim(t.default_cron),
        truncate(t.description, 38),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  ${templates.length} built-in template(s) available.\n`));
    console.log(chalk.dim("  Generate: aicib report generate <type>"));
    console.log(chalk.dim("  Schedule: aicib report schedule <type> --cron \"<expr>\"\n"));
  } finally {
    rm.close();
  }
}

// ── Schedule ────────────────────────────────────────────────────

interface ScheduleReportOptions extends ReportOptions {
  cron?: string;
}

export async function reportScheduleCommand(
  type: string,
  options: ScheduleReportOptions
): Promise<void> {
  if (!VALID_REPORT_TYPES.includes(type as ReportType)) {
    console.error(chalk.red(`  Error: Invalid report type "${type}". Valid: ${VALID_REPORT_TYPES.join(", ")}`));
    process.exit(1);
  }

  const rm = getReportManager(options.dir);

  try {
    const templates = rm.getBuiltinTemplates();
    const template = templates.find((t) => t.type === type);
    const name = template?.title || `${type} report`;
    const agent = template?.responsible_agent || "ceo";

    let cron = options.cron;

    // Interactive fallback
    if (!cron) {
      const defaultCron = template?.default_cron || "0 9 * * 1-5";

      const answers = await inquirer.prompt([
        {
          type: "input",
          name: "cron",
          message: `Cron expression for ${type}:`,
          default: defaultCron,
        },
      ]);
      cron = answers.cron;
    }

    if (!cron) {
      console.error(chalk.red("  Error: Cron expression is required.\n"));
      return;
    }

    const projectDir = path.resolve(options.dir);
    let sm: ScheduleManager | undefined;
    try {
      sm = new ScheduleManager(projectDir);
      const schedule = sm.createSchedule({
        name: `Report: ${name}`,
        cron_expression: cron,
        directive: `Generate a ${type} report. REPORT::GENERATE type=${type}`,
        agent_target: agent,
      });

      console.log(header("Report Scheduled"));
      console.log(`  ${chalk.green("\u2713")} Schedule #${schedule.id}: Report: ${name}`);
      console.log(`  ${chalk.green("\u2713")} Cron: ${cron}`);
      console.log(`  ${chalk.green("\u2713")} Agent: ${agentColor(agent)(agent)}`);
      if (schedule.next_run_at) {
        console.log(`  ${chalk.green("\u2713")} Next run: ${schedule.next_run_at}`);
      }
      console.log();
    } catch (e) {
      console.error(chalk.red(`  Error creating schedule: ${e instanceof Error ? e.message : String(e)}\n`));
    } finally {
      sm?.close();
    }
  } finally {
    rm.close();
  }
}
