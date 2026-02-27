/**
 * Hook registration for the Project (Long Autonomous Task Chains) system.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `projects:` section in aicib.config.yaml
 * - Database tables: projects, project_phases
 * - Context provider: project-status (injects active project progress into agent prompts)
 * - Message handler: project-actions (detects PROJECT:: markers in agent output)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  ProjectPlanner,
  PROJECT_CONFIG_DEFAULTS,
  type ProjectConfig,
} from "./project-planner.js";

// --- Config extension ---

registerConfigExtension({
  key: "projects",
  defaults: { ...PROJECT_CONFIG_DEFAULTS },
  validate: (raw: unknown) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;

      if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
        errors.push("projects.enabled must be a boolean");
      }

      if (obj.max_phases !== undefined) {
        if (typeof obj.max_phases !== "number" || obj.max_phases < 1 || obj.max_phases > 20) {
          errors.push("projects.max_phases must be a number between 1 and 20");
        }
      }

      if (obj.max_phase_retries !== undefined) {
        if (typeof obj.max_phase_retries !== "number" || obj.max_phase_retries < 0) {
          errors.push("projects.max_phase_retries must be a non-negative number");
        }
      }

      if (obj.phase_budget_usd !== undefined) {
        if (typeof obj.phase_budget_usd !== "number" || obj.phase_budget_usd < 0) {
          errors.push("projects.phase_budget_usd must be a non-negative number");
        }
      }

      if (obj.phase_max_turns !== undefined) {
        if (typeof obj.phase_max_turns !== "number" || obj.phase_max_turns < 1) {
          errors.push("projects.phase_max_turns must be a positive number");
        }
      }

      const modelFields = ["planning_model", "execution_model", "review_model", "summary_model"];
      for (const field of modelFields) {
        if (obj[field] !== undefined && typeof obj[field] !== "string") {
          errors.push(`projects.${field} must be a string`);
        }
      }
    }
    return errors;
  },
});

// --- Database tables ---

registerTable({
  name: "projects",
  createSQL: `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    original_brief TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning'
      CHECK(status IN ('planning','executing','paused','completed','failed','cancelled')),
    total_phases INTEGER NOT NULL DEFAULT 0,
    completed_phases INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    total_turns INTEGER NOT NULL DEFAULT 0,
    total_duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    error_message TEXT
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)",
    "CREATE INDEX IF NOT EXISTS idx_projects_session ON projects(session_id)",
  ],
});

registerTable({
  name: "project_phases",
  createSQL: `CREATE TABLE IF NOT EXISTS project_phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    phase_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','executing','reviewing','completed','failed','skipped')),
    sdk_session_id TEXT,
    job_id INTEGER,
    attempt INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    phase_summary TEXT,
    prior_context TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    num_turns INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    UNIQUE(project_id, phase_number),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_phases_project ON project_phases(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_phases_status ON project_phases(status)",
  ],
});

// --- Context provider ---

// Module-level projectDir set by the context provider, read by the message handler.
// Safe: AICIB runs one session per CLI process; background workers are separate processes.
let lastProjectDir: string | null = null;

registerContextProvider("project-status", async (_config, projectDir) => {
  lastProjectDir = projectDir;

  const projectsConfig = _config.extensions?.projects as ProjectConfig | undefined;
  if (projectsConfig && !projectsConfig.enabled) return "";

  let pp: ProjectPlanner | undefined;
  try {
    pp = new ProjectPlanner(projectDir);
    return pp.formatForContext();
  } catch {
    // Project system not initialized yet — skip silently
    return "";
  } finally {
    pp?.close();
  }
});

// --- Message handler ---

registerMessageHandler("project-actions", (msg, config) => {
  const projectsConfig = config.extensions?.projects as ProjectConfig | undefined;
  if (projectsConfig && !projectsConfig.enabled) return;

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

  // Detect PROJECT::PAUSE marker
  if (/PROJECT::PAUSE/i.test(text)) {
    let pp: ProjectPlanner | undefined;
    try {
      pp = new ProjectPlanner(lastProjectDir);
      const active = pp.getActiveProject();
      if (active) {
        pp.updateProject(active.id, { status: "paused" });
      }
    } catch {
      // best-effort
    } finally {
      pp?.close();
    }
  }

  // Detect PROJECT::SKIP_PHASE marker
  if (/PROJECT::SKIP_PHASE/i.test(text)) {
    let pp: ProjectPlanner | undefined;
    try {
      pp = new ProjectPlanner(lastProjectDir);
      const active = pp.getActiveProject();
      if (active) {
        const current = pp.getCurrentPhase(active.id);
        if (current) {
          pp.updatePhase(current.id, {
            status: "skipped",
            completed_at: new Date().toISOString(),
          });
        }
      }
    } catch {
      // best-effort
    } finally {
      pp?.close();
    }
  }
});
