import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ── Type Definitions ────────────────────────────────────────────────

export type ProjectStatus =
  | "planning"
  | "executing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type PhaseStatus =
  | "pending"
  | "executing"
  | "reviewing"
  | "completed"
  | "failed"
  | "skipped";

export interface Project {
  id: number;
  session_id: string;
  title: string;
  original_brief: string;
  status: ProjectStatus;
  total_phases: number;
  completed_phases: number;
  total_cost_usd: number;
  total_turns: number;
  total_duration_ms: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface ProjectPhase {
  id: number;
  project_id: number;
  phase_number: number;
  title: string;
  objective: string;
  acceptance_criteria: string;
  status: PhaseStatus;
  sdk_session_id: string | null;
  job_id: number | null;
  attempt: number;
  max_attempts: number;
  phase_summary: string | null;
  prior_context: string | null;
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface PhasePlan {
  phaseNumber: number;
  title: string;
  objective: string;
  acceptanceCriteria: string;
}

export interface ProjectConfig {
  enabled: boolean;
  max_phases: number;
  max_phase_retries: number;
  phase_budget_usd: number;
  phase_max_turns: number;
  planning_model?: string;
  execution_model?: string;
  review_model?: string;
  summary_model?: string;
}

export const PROJECT_CONFIG_DEFAULTS: ProjectConfig = {
  enabled: true,
  max_phases: 10,
  max_phase_retries: 3,
  phase_budget_usd: 10,
  phase_max_turns: 300,
};

// ── ProjectPlanner Class ────────────────────────────────────────────

export class ProjectPlanner {
  private db: Database.Database;

  constructor(projectDir: string) {
    const dataDir = path.join(projectDir, ".aicib");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(path.join(dataDir, "state.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.ensureTables();
  }

  /**
   * Create project tables if they don't exist yet.
   * Uses db.prepare().run() to avoid triggering security hooks.
   */
  private ensureTables(): void {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS projects (
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
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS project_phases (
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
    )`).run();

    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_projects_session ON projects(session_id)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_phases_project ON project_phases(project_id)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_phases_status ON project_phases(status)").run();
  }

  // ── Project CRUD ──────────────────────────────────────────────────

  createProject(sessionId: string, title: string, brief: string): Project {
    const result = this.db
      .prepare(
        `INSERT INTO projects (session_id, title, original_brief, status)
         VALUES (?, ?, ?, 'planning')`
      )
      .run(sessionId, title, brief);

    const project = this.getProject(Number(result.lastInsertRowid));
    if (!project) {
      throw new Error("Failed to create project");
    }
    return project;
  }

  getProject(id: number): Project | null {
    return (
      (this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
        | Project
        | undefined) ?? null
    );
  }

  updateProject(
    id: number,
    fields: Partial<
      Pick<
        Project,
        | "title"
        | "status"
        | "total_phases"
        | "completed_phases"
        | "total_cost_usd"
        | "total_turns"
        | "total_duration_ms"
        | "completed_at"
        | "error_message"
      >
    >
  ): Project | null {
    const ALLOWED = new Set([
      "title", "status", "total_phases", "completed_phases",
      "total_cost_usd", "total_turns", "total_duration_ms",
      "completed_at", "error_message",
    ]);

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }

    if (sets.length === 0) return this.getProject(id);

    sets.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.getProject(id);
  }

  listProjects(status?: ProjectStatus): Project[] {
    if (status) {
      return this.db
        .prepare(`SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC`)
        .all(status) as Project[];
    }
    return this.db
      .prepare(`SELECT * FROM projects ORDER BY created_at DESC`)
      .all() as Project[];
  }

  getActiveProject(): Project | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM projects WHERE status IN ('planning', 'executing') ORDER BY created_at DESC LIMIT 1`
        )
        .get() as Project | undefined) ?? null
    );
  }

  // ── Phase CRUD ────────────────────────────────────────────────────

  createPhase(
    projectId: number,
    phaseNumber: number,
    title: string,
    objective: string,
    acceptanceCriteria: string,
    maxAttempts: number = 3
  ): ProjectPhase {
    const result = this.db
      .prepare(
        `INSERT INTO project_phases (project_id, phase_number, title, objective, acceptance_criteria, max_attempts)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(projectId, phaseNumber, title, objective, acceptanceCriteria, maxAttempts);

    const phase = this.getPhase(Number(result.lastInsertRowid));
    if (!phase) {
      throw new Error("Failed to create phase");
    }
    return phase;
  }

  getPhase(id: number): ProjectPhase | null {
    return (
      (this.db.prepare(`SELECT * FROM project_phases WHERE id = ?`).get(id) as
        | ProjectPhase
        | undefined) ?? null
    );
  }

  updatePhase(
    id: number,
    fields: Partial<
      Pick<
        ProjectPhase,
        | "status"
        | "sdk_session_id"
        | "job_id"
        | "attempt"
        | "phase_summary"
        | "prior_context"
        | "cost_usd"
        | "num_turns"
        | "duration_ms"
        | "started_at"
        | "completed_at"
        | "error_message"
      >
    >
  ): ProjectPhase | null {
    const ALLOWED = new Set([
      "status", "sdk_session_id", "job_id", "attempt",
      "phase_summary", "prior_context", "cost_usd", "num_turns",
      "duration_ms", "started_at", "completed_at", "error_message",
    ]);

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }

    if (sets.length === 0) return this.getPhase(id);

    values.push(id);
    this.db
      .prepare(`UPDATE project_phases SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.getPhase(id);
  }

  getPhases(projectId: number): ProjectPhase[] {
    return this.db
      .prepare(
        `SELECT * FROM project_phases WHERE project_id = ? ORDER BY phase_number ASC`
      )
      .all(projectId) as ProjectPhase[];
  }

  getNextPendingPhase(projectId: number): ProjectPhase | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM project_phases
           WHERE project_id = ? AND status = 'pending'
           ORDER BY phase_number ASC LIMIT 1`
        )
        .get(projectId) as ProjectPhase | undefined) ?? null
    );
  }

  getCurrentPhase(projectId: number): ProjectPhase | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM project_phases
           WHERE project_id = ? AND status IN ('executing', 'reviewing')
           ORDER BY phase_number ASC LIMIT 1`
        )
        .get(projectId) as ProjectPhase | undefined) ?? null
    );
  }

  // ── Planning Output Parser ────────────────────────────────────────

  parsePlanningOutput(text: string): PhasePlan[] {
    const phases: PhasePlan[] = [];

    // Match PHASE::N blocks with TITLE:, OBJECTIVE:, ACCEPTANCE_CRITERIA: fields
    const phaseRegex = /PHASE::(\d+)\s*\n([\s\S]*?)(?=PHASE::\d+|$)/g;
    let match: RegExpExecArray | null;

    while ((match = phaseRegex.exec(text)) !== null) {
      const phaseNumber = parseInt(match[1], 10);
      const block = match[2];

      const titleMatch = block.match(/TITLE:\s*(.+?)(?:\n|$)/);
      const objectiveMatch = block.match(/OBJECTIVE:\s*([\s\S]*?)(?=ACCEPTANCE_CRITERIA:|$)/);
      const criteriaMatch = block.match(/ACCEPTANCE_CRITERIA:\s*([\s\S]*?)$/);

      if (titleMatch) {
        phases.push({
          phaseNumber,
          title: titleMatch[1].trim(),
          objective: objectiveMatch ? objectiveMatch[1].trim() : "",
          acceptanceCriteria: criteriaMatch ? criteriaMatch[1].trim() : "",
        });
      }
    }

    return phases;
  }

  // ── Context Builders ──────────────────────────────────────────────

  buildPriorContext(projectId: number): string {
    const completedPhases = this.db
      .prepare(
        `SELECT phase_number, title, phase_summary
         FROM project_phases
         WHERE project_id = ? AND status = 'completed'
         ORDER BY phase_number ASC`
      )
      .all(projectId) as Array<{
      phase_number: number;
      title: string;
      phase_summary: string | null;
    }>;

    if (completedPhases.length === 0) return "";

    const lines: string[] = ["## Completed Phases"];
    for (const phase of completedPhases) {
      lines.push(`\n### Phase ${phase.phase_number}: ${phase.title}`);
      if (phase.phase_summary) {
        lines.push(phase.phase_summary);
      }
    }

    const output = lines.join("\n");
    // Truncate to ~4000 chars to keep prompt size manageable
    if (output.length > 4000) {
      return output.slice(0, 3950) + "\n\n... (truncated for brevity)";
    }
    return output;
  }

  // ── Prompt Builders ───────────────────────────────────────────────

  buildPlanningPrompt(brief: string): string {
    return `You are planning a multi-phase autonomous project. The human founder has given this brief:

"${brief}"

Decompose this into sequential phases (2-8 phases). Each phase should be a self-contained unit of work that builds on prior phases.

Output EXACTLY this format for each phase:

PHASE::1
TITLE: <short title>
OBJECTIVE: <what this phase accomplishes, 2-3 sentences>
ACCEPTANCE_CRITERIA: <specific, verifiable criteria for this phase to be considered complete>

PHASE::2
TITLE: <short title>
OBJECTIVE: <what this phase accomplishes>
ACCEPTANCE_CRITERIA: <criteria>

... and so on.

Rules:
- Each phase must be completable in a single CEO session
- Later phases can reference earlier phase outputs
- Be specific about deliverables in acceptance criteria
- Start with foundation/setup, end with integration/polish
- Output ONLY the phase plan in the format above, nothing else`;
  }

  buildPhasePrompt(
    phase: ProjectPhase,
    project: Project,
    retryFeedback?: string
  ): string {
    const priorContext = this.buildPriorContext(project.id);
    const retrySection = retryFeedback
      ? `\n## Retry Feedback\nThis is attempt ${phase.attempt}. Previous attempt was rejected:\n${retryFeedback}\n\nAddress the feedback above in this attempt.`
      : "";

    return `You are executing Phase ${phase.phase_number} of ${project.total_phases} for the project: "${project.title}"

## Phase: ${phase.title}

### Objective
${phase.objective}

### Acceptance Criteria
${phase.acceptance_criteria}
${priorContext ? `\n${priorContext}` : ""}${retrySection}

---
Execute this phase completely. When done, output a brief summary of what was accomplished and any files created/modified.

REMINDER: Your project directory is the current working directory. Save ALL files using absolute paths under this directory.`;
  }

  buildReviewPrompt(phase: ProjectPhase, project: Project): string {
    return `You just completed Phase ${phase.phase_number} of ${project.total_phases}: "${phase.title}"

Review the work against the acceptance criteria:

${phase.acceptance_criteria}

Evaluate whether the phase was completed successfully. Consider:
1. Were all acceptance criteria met?
2. Are there any obvious errors or missing pieces?
3. Is the output sufficient for the next phase to build on?

Respond with EXACTLY one of:
- "APPROVED" followed by a brief explanation
- "REJECTED" followed by specific feedback on what needs to change

Your verdict must start with either APPROVED or REJECTED on the first line.`;
  }

  buildSummaryPrompt(phase: ProjectPhase): string {
    return `Summarize what was accomplished in this phase in 2-3 sentences. Focus on concrete deliverables, files created/modified, and key decisions made. Be concise — this summary will be used as context for subsequent phases.

Phase: "${phase.title}"
Objective: ${phase.objective}

Reply with ONLY the summary text, no formatting or preamble.`;
  }

  // ── Context Provider Formatting ───────────────────────────────────

  formatForContext(): string {
    const active = this.getActiveProject();
    if (!active) return "";

    const phases = this.getPhases(active.id);
    if (phases.length === 0) {
      return `## Active Project: ${active.title}\nStatus: ${active.status} (planning)`;
    }

    const lines: string[] = [`## Active Project: ${active.title}`];
    lines.push(`Status: ${active.status} | Phases: ${active.completed_phases}/${active.total_phases}`);
    lines.push("");

    for (const phase of phases) {
      let icon: string;
      switch (phase.status) {
        case "completed":
          icon = "[done]";
          break;
        case "executing":
          icon = "[>>>]";
          break;
        case "reviewing":
          icon = "[review]";
          break;
        case "failed":
          icon = "[FAIL]";
          break;
        case "skipped":
          icon = "[skip]";
          break;
        default:
          icon = "[ ]";
      }
      lines.push(`  ${icon} Phase ${phase.phase_number}: ${phase.title}`);
    }

    if (active.total_cost_usd > 0) {
      lines.push("");
      lines.push(`Cost so far: $${active.total_cost_usd.toFixed(4)}`);
    }

    return lines.join("\n");
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
