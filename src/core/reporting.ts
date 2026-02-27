import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ── Type Definitions ────────────────────────────────────────────────

export type ReportType =
  | "daily_briefing"
  | "weekly_department"
  | "monthly_financial"
  | "sprint_review"
  | "marketing_report"
  | "custom";

export type ReportStatus = "pending" | "generating" | "completed" | "failed";
export type DeliveryMethod = "slack" | "file" | "both";

export interface ReportingConfig {
  enabled: boolean;
  max_context_reports: number;
  default_delivery: DeliveryMethod;
  reports_dir: string;
  auto_schedule: boolean;
}

export const REPORTING_CONFIG_DEFAULTS: ReportingConfig = {
  enabled: true,
  max_context_reports: 5,
  default_delivery: "file",
  reports_dir: ".aicib/reports",
  auto_schedule: true,
};

export const VALID_REPORT_TYPES: ReportType[] = [
  "daily_briefing",
  "weekly_department",
  "monthly_financial",
  "sprint_review",
  "marketing_report",
  "custom",
];

export const VALID_REPORT_STATUSES: ReportStatus[] = [
  "pending",
  "generating",
  "completed",
  "failed",
];

export const VALID_DELIVERY_METHODS: DeliveryMethod[] = ["slack", "file", "both"];

// ── Report Template ─────────────────────────────────────────────────

export interface ReportTemplate {
  type: ReportType;
  title: string;
  description: string;
  responsible_agent: string;
  metrics: string[];
  default_cron: string;
}

// ── Report Record ───────────────────────────────────────────────────

export interface Report {
  id: number;
  report_type: ReportType;
  title: string;
  author_agent: string;
  content: string;
  metrics_snapshot: string; // JSON
  status: ReportStatus;
  delivery_method: DeliveryMethod;
  schedule_id: number | null;
  created_at: string;
  completed_at: string | null;
}

// ── Report Metrics ──────────────────────────────────────────────────

export interface ReportMetrics {
  costs: {
    today_usd: number;
    month_usd: number;
    by_agent: Array<{ role: string; total_cost_usd: number }>;
    history: Array<{ date: string; total_cost_usd: number }>;
  };
  tasks: {
    total: number;
    by_status: Record<string, number>;
    recently_completed: Array<{ id: number; title: string; assigned_to: string }>;
  };
  reviews: Array<{
    agent_role: string;
    overall_score: number;
    recommendation: string;
    created_at: string;
  }>;
  journal: Array<{
    id: number;
    directive: string;
    summary: string;
    created_at: string;
  }>;
}

// ── Create Report Input ─────────────────────────────────────────────

export interface CreateReportInput {
  report_type: ReportType;
  title: string;
  author_agent?: string;
  content?: string;
  metrics_snapshot?: string;
  delivery_method?: DeliveryMethod;
  schedule_id?: number;
}

// ── ReportManager Class ─────────────────────────────────────────────

export class ReportManager {
  private db: Database.Database;

  constructor(projectDir: string) {
    const dataDir = path.join(projectDir, ".aicib");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(path.join(dataDir, "state.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
  }

  // ── Built-in Templates ────────────────────────────────────────────

  getBuiltinTemplates(): ReportTemplate[] {
    return [
      {
        type: "daily_briefing",
        title: "CEO Daily Briefing",
        description: "Morning summary of overnight activity, costs, task progress, and key metrics",
        responsible_agent: "ceo",
        metrics: ["costs.today_usd", "tasks.by_status", "tasks.recently_completed"],
        default_cron: "0 9 * * 1-5",
      },
      {
        type: "weekly_department",
        title: "Weekly Department Performance",
        description: "Cross-department performance review with task completion rates and cost efficiency",
        responsible_agent: "ceo",
        metrics: ["costs.by_agent", "tasks.by_status", "reviews"],
        default_cron: "0 10 * * 1",
      },
      {
        type: "monthly_financial",
        title: "Monthly Financial Report",
        description: "Detailed cost analysis, budget utilization, and spending trends",
        responsible_agent: "cfo",
        metrics: ["costs.month_usd", "costs.by_agent", "costs.history"],
        default_cron: "0 9 1 * *",
      },
      {
        type: "sprint_review",
        title: "Sprint Review",
        description: "Engineering sprint summary with completed tasks, velocity, and quality metrics",
        responsible_agent: "cto",
        metrics: ["tasks.recently_completed", "tasks.by_status", "reviews"],
        default_cron: "0 14 * * 5",
      },
      {
        type: "marketing_report",
        title: "Weekly Marketing Report",
        description: "Marketing department activity, campaign progress, and content output",
        responsible_agent: "cmo",
        metrics: ["tasks.by_status", "costs.by_agent"],
        default_cron: "0 10 * * 1",
      },
    ];
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  createReport(input: CreateReportInput): Report {
    const result = this.db
      .prepare(
        `INSERT INTO reports (report_type, title, author_agent, content, metrics_snapshot, delivery_method, schedule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.report_type,
        input.title,
        input.author_agent ?? "ceo",
        input.content ?? "",
        input.metrics_snapshot ?? "{}",
        input.delivery_method ?? "file",
        input.schedule_id ?? null
      );

    return this.db
      .prepare("SELECT * FROM reports WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as Report;
  }

  updateReport(
    id: number,
    fields: Partial<Pick<Report, "content" | "status" | "completed_at" | "metrics_snapshot">>
  ): Report | null {
    const existing = this.getReport(id);
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.content !== undefined) {
      sets.push("content = ?");
      values.push(fields.content);
    }
    if (fields.status !== undefined) {
      sets.push("status = ?");
      values.push(fields.status);
    }
    if (fields.completed_at !== undefined) {
      sets.push("completed_at = ?");
      values.push(fields.completed_at);
    }
    if (fields.metrics_snapshot !== undefined) {
      sets.push("metrics_snapshot = ?");
      values.push(fields.metrics_snapshot);
    }

    if (sets.length === 0) return existing;

    values.push(id);
    this.db.prepare(`UPDATE reports SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    return this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Report;
  }

  getReport(id: number): Report | null {
    return (
      this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Report | undefined
    ) ?? null;
  }

  listReports(filter?: {
    report_type?: ReportType;
    status?: ReportStatus;
    limit?: number;
  }): Report[] {
    let sql = "SELECT * FROM reports WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.report_type) {
      sql += " AND report_type = ?";
      params.push(filter.report_type);
    }
    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }

    sql += " ORDER BY created_at DESC";

    if (filter?.limit !== undefined && filter.limit > 0) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    return this.db.prepare(sql).all(...params) as Report[];
  }

  getLatestReport(type: ReportType): Report | null {
    return (
      this.db
        .prepare("SELECT * FROM reports WHERE report_type = ? ORDER BY created_at DESC LIMIT 1")
        .get(type) as Report | undefined
    ) ?? null;
  }

  // ── Metrics Collection ────────────────────────────────────────────

  collectMetrics(projectDir: string): ReportMetrics {
    const dbPath = path.join(projectDir, ".aicib", "state.db");
    let metricsDb: Database.Database | undefined;

    try {
      metricsDb = new Database(dbPath, { readonly: true });
      metricsDb.pragma("busy_timeout = 3000");

      // Costs
      const todayCost = (metricsDb
        .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM cost_entries WHERE date(timestamp) = date('now')")
        .get() as { total: number }).total;

      const monthCost = (metricsDb
        .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM cost_entries WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')")
        .get() as { total: number }).total;

      let byAgent: Array<{ role: string; total_cost_usd: number }> = [];
      try {
        byAgent = metricsDb
          .prepare("SELECT agent_role as role, SUM(estimated_cost_usd) as total_cost_usd FROM cost_entries GROUP BY agent_role ORDER BY total_cost_usd DESC LIMIT 20")
          .all() as Array<{ role: string; total_cost_usd: number }>;
      } catch { /* table may not exist */ }

      let costHistory: Array<{ date: string; total_cost_usd: number }> = [];
      try {
        costHistory = metricsDb
          .prepare("SELECT date(timestamp) as date, SUM(estimated_cost_usd) as total_cost_usd FROM cost_entries WHERE timestamp >= datetime('now', '-7 days') GROUP BY date(timestamp) ORDER BY date DESC")
          .all() as Array<{ date: string; total_cost_usd: number }>;
      } catch { /* table may not exist */ }

      // Tasks
      let totalTasks = 0;
      const byStatus: Record<string, number> = {};
      let recentlyCompleted: Array<{ id: number; title: string; assigned_to: string }> = [];

      try {
        const taskCounts = metricsDb
          .prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status")
          .all() as Array<{ status: string; count: number }>;
        for (const row of taskCounts) {
          byStatus[row.status] = row.count;
          totalTasks += row.count;
        }

        recentlyCompleted = metricsDb
          .prepare("SELECT id, title, assigned_to FROM tasks WHERE status = 'done' ORDER BY updated_at DESC LIMIT 10")
          .all() as Array<{ id: number; title: string; assigned_to: string }>;
      } catch { /* tasks table may not exist */ }

      // Reviews
      let reviews: ReportMetrics["reviews"] = [];
      try {
        reviews = metricsDb
          .prepare("SELECT agent_role, overall_score, recommendation, created_at FROM hr_reviews ORDER BY created_at DESC LIMIT 10")
          .all() as ReportMetrics["reviews"];
      } catch { /* table may not exist */ }

      // Journal
      let journal: ReportMetrics["journal"] = [];
      try {
        journal = metricsDb
          .prepare("SELECT id, directive, summary, created_at FROM ceo_journal ORDER BY created_at DESC LIMIT 5")
          .all() as ReportMetrics["journal"];
      } catch { /* table may not exist */ }

      return {
        costs: {
          today_usd: todayCost,
          month_usd: monthCost,
          by_agent: byAgent,
          history: costHistory,
        },
        tasks: {
          total: totalTasks,
          by_status: byStatus,
          recently_completed: recentlyCompleted,
        },
        reviews,
        journal,
      };
    } finally {
      metricsDb?.close();
    }
  }

  // ── Report Directive Builder ──────────────────────────────────────

  buildReportDirective(template: ReportTemplate, metrics: ReportMetrics, reportId: number): string {
    const lines: string[] = [];

    lines.push(`Generate a ${template.title}.`);
    lines.push(`Report type: ${template.type}`);
    lines.push("");
    lines.push("## Current Metrics");
    lines.push("");

    // Costs
    lines.push(`- Today's spending: $${metrics.costs.today_usd.toFixed(4)}`);
    lines.push(`- Month-to-date: $${metrics.costs.month_usd.toFixed(4)}`);

    if (metrics.costs.by_agent.length > 0) {
      lines.push("- Cost by agent:");
      for (const agent of metrics.costs.by_agent.slice(0, 5)) {
        lines.push(`  - ${agent.role}: $${agent.total_cost_usd.toFixed(4)}`);
      }
    }

    // Tasks
    lines.push(`- Total tasks: ${metrics.tasks.total}`);
    if (Object.keys(metrics.tasks.by_status).length > 0) {
      const statusParts = Object.entries(metrics.tasks.by_status)
        .map(([s, c]) => `${s}: ${c}`)
        .join(", ");
      lines.push(`- Tasks by status: ${statusParts}`);
    }

    if (metrics.tasks.recently_completed.length > 0) {
      lines.push("- Recently completed tasks:");
      for (const task of metrics.tasks.recently_completed.slice(0, 5)) {
        lines.push(`  - #${task.id} "${task.title}" (${task.assigned_to})`);
      }
    }

    // Reviews
    if (metrics.reviews.length > 0) {
      lines.push("- Recent reviews:");
      for (const review of metrics.reviews.slice(0, 5)) {
        lines.push(`  - ${review.agent_role}: ${review.overall_score}/100 (${review.recommendation})`);
      }
    }

    // Journal
    if (metrics.journal.length > 0) {
      lines.push("- Recent journal entries:");
      for (const entry of metrics.journal.slice(0, 3)) {
        const summary = entry.summary.length > 80
          ? entry.summary.slice(0, 77) + "..."
          : entry.summary;
        lines.push(`  - ${summary}`);
      }
    }

    lines.push("");
    lines.push("Write a concise, actionable report based on these metrics.");
    lines.push(`When done, emit: REPORT::COMPLETE id=${reportId}`);

    return lines.join("\n");
  }

  // ── Context Formatting ────────────────────────────────────────────

  formatForContext(maxReports: number = 5): string {
    const reports = this.listReports({ limit: maxReports });

    if (reports.length === 0) {
      const lines: string[] = [];
      lines.push("## Reporting");
      lines.push("No reports generated yet. Available types: daily_briefing, weekly_department, monthly_financial, sprint_review, marketing_report, custom");
      lines.push("");
      lines.push("## Report Actions");
      lines.push('REPORT::GENERATE type=<type> [title="..."]');
      lines.push("REPORT::COMPLETE id=<N>");
      lines.push('REPORT::SCHEDULE type=<type> cron="<expr>"');
      return lines.join("\n");
    }

    const lines: string[] = [];
    lines.push("## Recent Reports");

    for (const report of reports) {
      const status = report.status === "completed" ? "done" : report.status;
      const contentPreview = report.content.length > 100
        ? report.content.slice(0, 97) + "..."
        : report.content || "(no content)";
      lines.push(`- [${report.report_type}] #${report.id} "${report.title}" — ${status} (${report.created_at})`);
      if (report.status === "completed" && report.content) {
        lines.push(`  ${contentPreview}`);
      }
    }

    lines.push("");
    lines.push("## Report Actions");
    lines.push('REPORT::GENERATE type=<type> [title="..."]');
    lines.push("REPORT::COMPLETE id=<N>");
    lines.push('REPORT::SCHEDULE type=<type> cron="<expr>"');

    // Token safety
    const output = lines.join("\n");
    if (output.length > 3000) {
      return [
        "## Reporting (truncated)",
        `${reports.length} recent report(s). Use \`aicib report\` for full details.`,
        "",
        "## Report Actions",
        'REPORT::GENERATE type=<type> [title="..."]',
        "REPORT::COMPLETE id=<N>",
        'REPORT::SCHEDULE type=<type> cron="<expr>"',
      ].join("\n");
    }

    return output;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
