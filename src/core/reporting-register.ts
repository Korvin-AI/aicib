/**
 * Hook registration for the Reporting Suite.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `reporting:` section in aicib.config.yaml
 * - Database table: reports
 * - Context provider: reporting-status (injects recent reports + markers into agent prompts)
 * - Message handler: report-actions (detects REPORT:: markers in agent output)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  ReportManager,
  REPORTING_CONFIG_DEFAULTS,
  VALID_REPORT_TYPES,
  VALID_DELIVERY_METHODS,
  type ReportingConfig,
  type ReportType,
  type DeliveryMethod,
} from "./reporting.js";
import { ScheduleManager } from "./scheduler.js";

// --- Config extension ---

registerConfigExtension({
  key: "reporting",
  defaults: { ...REPORTING_CONFIG_DEFAULTS },
  validate: (raw: unknown) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;

      if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
        errors.push("reporting.enabled must be a boolean");
      }

      if (obj.max_context_reports !== undefined) {
        if (typeof obj.max_context_reports !== "number" || obj.max_context_reports < 0) {
          errors.push("reporting.max_context_reports must be a non-negative number");
        }
      }

      if (obj.default_delivery !== undefined) {
        if (!VALID_DELIVERY_METHODS.includes(obj.default_delivery as DeliveryMethod)) {
          errors.push(`reporting.default_delivery must be one of: ${VALID_DELIVERY_METHODS.join(", ")}`);
        }
      }

      if (obj.reports_dir !== undefined && typeof obj.reports_dir !== "string") {
        errors.push("reporting.reports_dir must be a string");
      }

      if (obj.auto_schedule !== undefined && typeof obj.auto_schedule !== "boolean") {
        errors.push("reporting.auto_schedule must be a boolean");
      }
    }
    return errors;
  },
});

// --- Database table ---

registerTable({
  name: "reports",
  createSQL: `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL
      CHECK(report_type IN ('daily_briefing','weekly_department','monthly_financial','sprint_review','marketing_report','custom')),
    title TEXT NOT NULL,
    author_agent TEXT NOT NULL DEFAULT 'ceo',
    content TEXT NOT NULL DEFAULT '',
    metrics_snapshot TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','generating','completed','failed')),
    delivery_method TEXT NOT NULL DEFAULT 'file'
      CHECK(delivery_method IN ('slack','file','both')),
    schedule_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type)",
    "CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)",
    "CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at)",
  ],
});

// --- Context provider ---

// Module-level projectDir set by the context provider, read by the message handler.
let lastProjectDir: string | null = null;

registerContextProvider("reporting-status", async (_config, projectDir) => {
  lastProjectDir = projectDir;

  const reportingConfig = _config.extensions?.reporting as ReportingConfig | undefined;
  if (reportingConfig && !reportingConfig.enabled) return "";

  const maxReports = reportingConfig?.max_context_reports ?? 5;

  let rm: ReportManager | undefined;
  try {
    rm = new ReportManager(projectDir);
    return rm.formatForContext(maxReports);
  } catch {
    return "";
  } finally {
    rm?.close();
  }
});

// --- Message handler ---

interface PendingReportAction {
  type: "generate" | "complete" | "schedule";
  data: Record<string, string>;
}

let pendingActions: PendingReportAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAction(action: PendingReportAction): void {
  pendingActions.push(action);
  if (!flushTimer) {
    flushTimer = setTimeout(() => flushPendingActions(), 500);
  }
}

function flushPendingActions(): void {
  flushTimer = null;
  if (pendingActions.length === 0 || !lastProjectDir) return;

  const actions = pendingActions;
  pendingActions = [];

  let rm: ReportManager | undefined;
  try {
    rm = new ReportManager(lastProjectDir);

    for (const action of actions) {
      try {
        switch (action.type) {
          case "generate": {
            const { reportType, title } = action.data;
            if (!reportType?.trim()) break;

            if (!VALID_REPORT_TYPES.includes(reportType as ReportType)) break;

            // Find template for this type
            const templates = rm.getBuiltinTemplates();
            const template = templates.find((t) => t.type === reportType);
            const reportTitle = title || template?.title || `${reportType} report`;
            const authorAgent = template?.responsible_agent || "ceo";

            // Collect metrics and create report
            const metrics = rm.collectMetrics(lastProjectDir!);

            rm.createReport({
              report_type: reportType as ReportType,
              title: reportTitle,
              author_agent: authorAgent,
              metrics_snapshot: JSON.stringify(metrics),
              delivery_method: "file",
            });
            break;
          }
          case "complete": {
            const id = parseInt(action.data.id, 10);
            if (Number.isNaN(id)) break;

            // Strip the REPORT::COMPLETE marker from captured content
            let content = action.data.content || "";
            content = content.replace(/REPORT::COMPLETE\s+id=\d+/g, "").trim();

            rm.updateReport(id, {
              status: "completed",
              completed_at: new Date().toISOString().replace("T", " ").slice(0, 19),
              content,
            });
            break;
          }
          case "schedule": {
            const { reportType, cron } = action.data;
            if (!reportType?.trim() || !cron?.trim()) break;
            if (!VALID_REPORT_TYPES.includes(reportType as ReportType)) break;

            const templates = rm.getBuiltinTemplates();
            const template = templates.find((t) => t.type === reportType);
            const name = template?.title || `${reportType} report`;
            const agent = template?.responsible_agent || "ceo";

            let sm: ScheduleManager | undefined;
            try {
              sm = new ScheduleManager(lastProjectDir!);
              sm.createSchedule({
                name: `Report: ${name}`,
                cron_expression: cron,
                directive: `Generate a ${reportType} report. REPORT::GENERATE type=${reportType}`,
                agent_target: agent,
              });
            } catch (e) {
              console.warn("Report schedule creation failed:", e);
            } finally {
              sm?.close();
            }
            break;
          }
        }
      } catch (e) {
        console.warn("Report action failed:", e);
      }
    }
  } catch (e) {
    console.warn("Report flush DB error:", e);
  } finally {
    rm?.close();
  }
}

registerMessageHandler("report-actions", (msg, config) => {
  const reportingConfig = config.extensions?.reporting as ReportingConfig | undefined;
  if (reportingConfig && !reportingConfig.enabled) return;

  if (msg.type !== "assistant") return;

  const content = msg.message?.content;
  if (!content) return;

  let text = "";
  for (const block of content) {
    if ("text" in block && block.text) {
      text += block.text + "\n";
    }
  }
  if (!text) return;

  if (!lastProjectDir) return;

  // --- Parse structured REPORT:: markers ---

  // REPORT::GENERATE type=<type> [title="..."]
  const generateMatches = text.matchAll(
    /REPORT::GENERATE\s+type=(\S+)(?:\s+title="([^"]*)")?/g
  );
  for (const match of generateMatches) {
    queueAction({
      type: "generate",
      data: { reportType: match[1], title: match[2] || "" },
    });
  }

  // REPORT::COMPLETE id=<N>
  const completeMatches = text.matchAll(/REPORT::COMPLETE\s+id=(\d+)/g);
  for (const match of completeMatches) {
    queueAction({ type: "complete", data: { id: match[1], content: text } });
  }

  // REPORT::SCHEDULE type=<type> cron="<expr>"
  const scheduleMatches = text.matchAll(
    /REPORT::SCHEDULE\s+type=(\S+)\s+cron="([^"]+)"/g
  );
  for (const match of scheduleMatches) {
    queueAction({
      type: "schedule",
      data: { reportType: match[1], cron: match[2] },
    });
  }
});
