import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AutonomyLevel } from "./autonomy-matrix.js";

// ── Type Definitions ────────────────────────────────────────────────

export type HREventType =
  | "hired"
  | "onboard_advance"
  | "onboard_complete"
  | "review_started"
  | "review_completed"
  | "promoted"
  | "demoted"
  | "improvement_started"
  | "improvement_updated"
  | "improvement_resolved"
  | "state_changed"
  | "fired";

export type OnboardingPhase = 1 | 2 | 3 | 4;
export type RampSpeed = "instant" | "standard" | "extended";
export type ReviewType = "periodic" | "promotion" | "improvement" | "probation";
export type Recommendation = "maintain" | "promote" | "demote" | "improve" | "terminate";
export type PlanStatus = "active" | "completed" | "failed" | "cancelled";
export type PlanOutcome = "return_to_normal" | "reassign" | "reconfigure" | "terminate";
export type AgentHRState = "active" | "idle" | "paused" | "hibernated" | "stopped" | "archived";

export const VALID_HR_EVENT_TYPES: HREventType[] = [
  "hired", "onboard_advance", "onboard_complete",
  "review_started", "review_completed",
  "promoted", "demoted",
  "improvement_started", "improvement_updated", "improvement_resolved",
  "state_changed", "fired",
];

export const VALID_RAMP_SPEEDS: RampSpeed[] = ["instant", "standard", "extended"];
export const VALID_REVIEW_TYPES: ReviewType[] = ["periodic", "promotion", "improvement", "probation"];
export const VALID_RECOMMENDATIONS: Recommendation[] = ["maintain", "promote", "demote", "improve", "terminate"];
export const VALID_PLAN_STATUSES: PlanStatus[] = ["active", "completed", "failed", "cancelled"];
export const VALID_PLAN_OUTCOMES: PlanOutcome[] = ["return_to_normal", "reassign", "reconfigure", "terminate"];
export const VALID_AGENT_HR_STATES: AgentHRState[] = ["active", "idle", "paused", "hibernated", "stopped", "archived"];

export const ONBOARDING_PHASES: Record<OnboardingPhase, { name: string; autonomy: AutonomyLevel }> = {
  1: { name: "Research", autonomy: "restricted" },
  2: { name: "Mentored Introduction", autonomy: "guided" },
  3: { name: "Supervised Work", autonomy: "standard" },
  4: { name: "Full Autonomy", autonomy: "autonomous" },
};

// ── Config ──────────────────────────────────────────────────────────

export interface HRConfig {
  enabled: boolean;
  review_cadence: string;
  onboarding_ramp: RampSpeed;
  max_context_events: number;
  auto_onboard: boolean;
}

export const HR_CONFIG_DEFAULTS: HRConfig = {
  enabled: true,
  review_cadence: "monthly",
  onboarding_ramp: "standard",
  max_context_events: 10,
  auto_onboard: true,
};

// ── Interfaces ──────────────────────────────────────────────────────

export interface HREvent {
  id: number;
  agent_role: string;
  event_type: HREventType;
  details: string;
  performed_by: string;
  session_id: string | null;
  created_at: string;
}

export interface OnboardingRecord {
  agent_role: string;
  current_phase: OnboardingPhase;
  phase_started_at: string;
  mentor: string | null;
  ramp_speed: RampSpeed;
  completed_at: string | null;
  created_at: string;
}

export interface ReviewRecord {
  id: number;
  agent_role: string;
  reviewer: string;
  review_type: ReviewType;
  task_score: number | null;
  quality_score: number | null;
  efficiency_score: number | null;
  collaboration_score: number | null;
  overall_score: number;
  summary: string;
  recommendation: Recommendation;
  created_at: string;
}

export interface CreateReviewInput {
  agentRole: string;
  reviewer: string;
  reviewType?: ReviewType;
  taskScore?: number;
  qualityScore?: number;
  efficiencyScore?: number;
  collaborationScore?: number;
  summary?: string;
  recommendation?: Recommendation;
}

export interface ImprovementPlan {
  id: number;
  agent_role: string;
  created_by: string;
  goals: string;
  deadline: string | null;
  status: PlanStatus;
  outcome: PlanOutcome | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

// ── Score weights ───────────────────────────────────────────────────

const SCORE_WEIGHTS = {
  task: 0.3,
  quality: 0.3,
  efficiency: 0.2,
  collaboration: 0.2,
};

// Cadence to days mapping
const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
};

// ── HRManager Class ─────────────────────────────────────────────────

export class HRManager {
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

  private ensureTables(): void {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS hr_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK(event_type IN ('hired','onboard_advance','onboard_complete',
          'review_started','review_completed','promoted','demoted',
          'improvement_started','improvement_updated','improvement_resolved',
          'state_changed','fired')),
      details TEXT NOT NULL DEFAULT '{}',
      performed_by TEXT NOT NULL DEFAULT 'system',
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS hr_onboarding (
      agent_role TEXT PRIMARY KEY,
      current_phase INTEGER NOT NULL DEFAULT 1 CHECK(current_phase BETWEEN 1 AND 4),
      phase_started_at TEXT NOT NULL DEFAULT (datetime('now')),
      mentor TEXT,
      ramp_speed TEXT NOT NULL DEFAULT 'standard'
        CHECK(ramp_speed IN ('instant','standard','extended')),
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS hr_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      review_type TEXT NOT NULL DEFAULT 'periodic'
        CHECK(review_type IN ('periodic','promotion','improvement','probation')),
      task_score REAL,
      quality_score REAL,
      efficiency_score REAL,
      collaboration_score REAL,
      overall_score REAL NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      recommendation TEXT NOT NULL DEFAULT 'maintain'
        CHECK(recommendation IN ('maintain','promote','demote','improve','terminate')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS hr_improvement_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      created_by TEXT NOT NULL,
      goals TEXT NOT NULL DEFAULT '[]',
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','completed','failed','cancelled')),
      outcome TEXT
        CHECK(outcome IS NULL OR outcome IN ('return_to_normal','reassign','reconfigure','terminate')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    )`).run();

    // Indexes
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_events_agent ON hr_events(agent_role)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_events_type ON hr_events(event_type)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_events_created ON hr_events(created_at)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_reviews_agent ON hr_reviews(agent_role)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_reviews_created ON hr_reviews(created_at)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_plans_agent ON hr_improvement_plans(agent_role)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_plans_status ON hr_improvement_plans(status)").run();
  }

  // ── Event Logging ──────────────────────────────────────────────────

  private logEvent(
    agentRole: string,
    eventType: HREventType,
    details: Record<string, unknown> = {},
    performedBy: string = "system",
    sessionId?: string
  ): HREvent {
    const result = this.db
      .prepare(
        `INSERT INTO hr_events (agent_role, event_type, details, performed_by, session_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        agentRole,
        eventType,
        JSON.stringify(details),
        performedBy,
        sessionId ?? null
      );

    return this.db
      .prepare("SELECT * FROM hr_events WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as HREvent;
  }

  getEvents(agentRole?: string, eventType?: HREventType, limit: number = 50): HREvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (agentRole) {
      conditions.push("agent_role = ?");
      params.push(agentRole);
    }
    if (eventType) {
      conditions.push("event_type = ?");
      params.push(eventType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    return this.db
      .prepare(`SELECT * FROM hr_events ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as HREvent[];
  }

  // ── Onboarding ─────────────────────────────────────────────────────

  startOnboarding(
    agentRole: string,
    mentor?: string,
    rampSpeed: RampSpeed = "standard"
  ): OnboardingRecord {
    // Idempotent: return existing record if already onboarding
    const existing = this.getOnboarding(agentRole);
    if (existing) return existing;

    const isInstant = rampSpeed === "instant";
    const phase: OnboardingPhase = isInstant ? 4 : 1;

    this.db
      .prepare(
        `INSERT INTO hr_onboarding (agent_role, current_phase, mentor, ramp_speed, completed_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        agentRole,
        phase,
        mentor ?? null,
        rampSpeed,
        isInstant ? new Date().toISOString().replace("T", " ").slice(0, 19) : null
      );

    this.logEvent(agentRole, isInstant ? "onboard_complete" : "onboard_advance", {
      phase,
      phase_name: ONBOARDING_PHASES[phase].name,
      ramp_speed: rampSpeed,
      mentor: mentor ?? null,
    });

    return this.getOnboarding(agentRole)!;
  }

  advanceOnboarding(agentRole: string, performedBy: string = "system"): OnboardingRecord | null {
    const record = this.getOnboarding(agentRole);
    if (!record || record.completed_at) return null;

    if (record.current_phase >= 4) {
      return this.completeOnboarding(agentRole, performedBy);
    }

    const nextPhase = (record.current_phase + 1) as OnboardingPhase;

    this.db
      .prepare(
        `UPDATE hr_onboarding SET current_phase = ?, phase_started_at = datetime('now') WHERE agent_role = ?`
      )
      .run(nextPhase, agentRole);

    this.logEvent(agentRole, "onboard_advance", {
      from_phase: record.current_phase,
      to_phase: nextPhase,
      phase_name: ONBOARDING_PHASES[nextPhase].name,
    }, performedBy);

    // If we just advanced to phase 4, auto-complete
    if (nextPhase === 4) {
      return this.completeOnboarding(agentRole, performedBy);
    }

    return this.getOnboarding(agentRole);
  }

  completeOnboarding(agentRole: string, performedBy: string = "system"): OnboardingRecord | null {
    const record = this.getOnboarding(agentRole);
    if (!record || record.completed_at) return null;

    this.db
      .prepare(
        `UPDATE hr_onboarding SET completed_at = datetime('now'), current_phase = 4 WHERE agent_role = ?`
      )
      .run(agentRole);

    this.logEvent(agentRole, "onboard_complete", {
      phase: 4,
      phase_name: ONBOARDING_PHASES[4].name,
    }, performedBy);

    return this.getOnboarding(agentRole);
  }

  getOnboarding(agentRole: string): OnboardingRecord | null {
    return (
      this.db
        .prepare("SELECT * FROM hr_onboarding WHERE agent_role = ?")
        .get(agentRole) as OnboardingRecord | undefined
    ) ?? null;
  }

  listOnboarding(): OnboardingRecord[] {
    return this.db
      .prepare("SELECT * FROM hr_onboarding ORDER BY created_at DESC")
      .all() as OnboardingRecord[];
  }

  // ── Hiring ─────────────────────────────────────────────────────────

  recordHire(
    agentRole: string,
    department: string,
    hiredBy: string = "human-founder",
    rampSpeed?: RampSpeed,
    mentor?: string
  ): HREvent {
    const event = this.logEvent(agentRole, "hired", { department, hired_by: hiredBy, mentor: mentor ?? null }, hiredBy);

    // Auto-start onboarding if configured (check defaults — config is external)
    if (rampSpeed !== undefined || HR_CONFIG_DEFAULTS.auto_onboard) {
      this.startOnboarding(agentRole, mentor, rampSpeed ?? HR_CONFIG_DEFAULTS.onboarding_ramp);
    }

    return event;
  }

  // ── Performance Reviews ────────────────────────────────────────────

  createReview(input: CreateReviewInput): ReviewRecord {
    const clamp = (v: number | undefined): number | null => {
      if (v === undefined || v === null) return null;
      return Math.max(0, Math.min(100, v));
    };

    const taskScore = clamp(input.taskScore);
    const qualityScore = clamp(input.qualityScore);
    const efficiencyScore = clamp(input.efficiencyScore);
    const collaborationScore = clamp(input.collaborationScore);

    // Weighted average, excluding nulls
    let totalWeight = 0;
    let weightedSum = 0;

    if (taskScore !== null) {
      weightedSum += taskScore * SCORE_WEIGHTS.task;
      totalWeight += SCORE_WEIGHTS.task;
    }
    if (qualityScore !== null) {
      weightedSum += qualityScore * SCORE_WEIGHTS.quality;
      totalWeight += SCORE_WEIGHTS.quality;
    }
    if (efficiencyScore !== null) {
      weightedSum += efficiencyScore * SCORE_WEIGHTS.efficiency;
      totalWeight += SCORE_WEIGHTS.efficiency;
    }
    if (collaborationScore !== null) {
      weightedSum += collaborationScore * SCORE_WEIGHTS.collaboration;
      totalWeight += SCORE_WEIGHTS.collaboration;
    }

    const overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;

    this.logEvent(input.agentRole, "review_started", {
      review_type: input.reviewType ?? "periodic",
      reviewer: input.reviewer,
    }, input.reviewer);

    const result = this.db
      .prepare(
        `INSERT INTO hr_reviews (agent_role, reviewer, review_type, task_score, quality_score, efficiency_score, collaboration_score, overall_score, summary, recommendation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.agentRole,
        input.reviewer,
        input.reviewType ?? "periodic",
        taskScore,
        qualityScore,
        efficiencyScore,
        collaborationScore,
        overallScore,
        input.summary ?? "",
        input.recommendation ?? "maintain"
      );

    this.logEvent(input.agentRole, "review_completed", {
      review_id: Number(result.lastInsertRowid),
      overall_score: overallScore,
      recommendation: input.recommendation ?? "maintain",
    }, input.reviewer);

    return this.db
      .prepare("SELECT * FROM hr_reviews WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as ReviewRecord;
  }

  getLatestReview(agentRole: string): ReviewRecord | null {
    return (
      this.db
        .prepare("SELECT * FROM hr_reviews WHERE agent_role = ? ORDER BY created_at DESC LIMIT 1")
        .get(agentRole) as ReviewRecord | undefined
    ) ?? null;
  }

  getReviews(agentRole: string, limit: number = 10): ReviewRecord[] {
    return this.db
      .prepare("SELECT * FROM hr_reviews WHERE agent_role = ? ORDER BY created_at DESC LIMIT ?")
      .all(agentRole, limit) as ReviewRecord[];
  }

  getAgentsDueForReview(cadence: string): string[] {
    const days = CADENCE_DAYS[cadence];
    if (!days) return [];

    // Get all distinct agents from hr_events (hired agents)
    const agents = this.db
      .prepare("SELECT DISTINCT agent_role FROM hr_events WHERE event_type = 'hired'")
      .all() as Array<{ agent_role: string }>;

    const due: string[] = [];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    for (const { agent_role } of agents) {
      // Exclude fired/archived/stopped agents
      const state = this.getAgentState(agent_role);
      if (state === "archived" || state === "stopped") continue;

      // Check if agent was fired (separate event type, not a state)
      const firedEvents = this.getEvents(agent_role, "fired", 1);
      if (firedEvents.length > 0) continue;

      const latest = this.getLatestReview(agent_role);
      if (!latest) {
        due.push(agent_role);
      } else {
        const reviewDate = new Date(latest.created_at).getTime();
        if (reviewDate < cutoff) {
          due.push(agent_role);
        }
      }
    }

    return due;
  }

  // ── Promotions & Demotions ─────────────────────────────────────────

  recordPromotion(
    agentRole: string,
    fromLevel: string,
    toLevel: string,
    reason?: string,
    performedBy: string = "system"
  ): HREvent {
    return this.logEvent(agentRole, "promoted", {
      from_level: fromLevel,
      to_level: toLevel,
      reason: reason ?? null,
    }, performedBy);
  }

  recordDemotion(
    agentRole: string,
    fromLevel: string,
    toLevel: string,
    reason?: string,
    performedBy: string = "system"
  ): HREvent {
    return this.logEvent(agentRole, "demoted", {
      from_level: fromLevel,
      to_level: toLevel,
      reason: reason ?? null,
    }, performedBy);
  }

  // ── Improvement Plans ──────────────────────────────────────────────

  createImprovementPlan(input: {
    agentRole: string;
    createdBy: string;
    goals: string[];
    deadline?: string;
    notes?: string;
  }): ImprovementPlan {
    // Reject if agent already has an active plan
    const existing = this.getActivePlan(input.agentRole);
    if (existing) {
      throw new Error(`Agent "${input.agentRole}" already has an active improvement plan (ID: ${existing.id})`);
    }

    const result = this.db
      .prepare(
        `INSERT INTO hr_improvement_plans (agent_role, created_by, goals, deadline, notes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.agentRole,
        input.createdBy,
        JSON.stringify(input.goals),
        input.deadline ?? null,
        input.notes ?? null
      );

    this.logEvent(input.agentRole, "improvement_started", {
      plan_id: Number(result.lastInsertRowid),
      goals: input.goals,
      deadline: input.deadline ?? null,
    }, input.createdBy);

    return this.db
      .prepare("SELECT * FROM hr_improvement_plans WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as ImprovementPlan;
  }

  updateImprovementPlan(
    id: number,
    update: { status?: PlanStatus; outcome?: PlanOutcome; notes?: string }
  ): ImprovementPlan | null {
    const existing = this.db
      .prepare("SELECT * FROM hr_improvement_plans WHERE id = ?")
      .get(id) as ImprovementPlan | undefined;

    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (update.status) {
      sets.push("status = ?");
      values.push(update.status);

      if (update.status !== "active") {
        sets.push("resolved_at = datetime('now')");
      }
    }

    if (update.outcome) {
      sets.push("outcome = ?");
      values.push(update.outcome);
    }

    if (update.notes !== undefined) {
      sets.push("notes = ?");
      values.push(update.notes);
    }

    if (sets.length === 0) return existing;

    values.push(id);
    this.db.prepare(`UPDATE hr_improvement_plans SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    const eventType: HREventType = update.status && update.status !== "active"
      ? "improvement_resolved"
      : "improvement_updated";

    this.logEvent(existing.agent_role, eventType, {
      plan_id: id,
      status: update.status ?? existing.status,
      outcome: update.outcome ?? existing.outcome,
    });

    return this.db
      .prepare("SELECT * FROM hr_improvement_plans WHERE id = ?")
      .get(id) as ImprovementPlan;
  }

  getActivePlan(agentRole: string): ImprovementPlan | null {
    return (
      this.db
        .prepare("SELECT * FROM hr_improvement_plans WHERE agent_role = ? AND status = 'active' LIMIT 1")
        .get(agentRole) as ImprovementPlan | undefined
    ) ?? null;
  }

  getPlans(agentRole: string): ImprovementPlan[] {
    return this.db
      .prepare("SELECT * FROM hr_improvement_plans WHERE agent_role = ? ORDER BY created_at DESC")
      .all(agentRole) as ImprovementPlan[];
  }

  // ── Lifecycle State ────────────────────────────────────────────────

  recordStateChange(
    agentRole: string,
    newState: AgentHRState,
    reason?: string,
    performedBy: string = "system"
  ): HREvent {
    return this.logEvent(agentRole, "state_changed", {
      new_state: newState,
      reason: reason ?? null,
    }, performedBy);
  }

  getAgentState(agentRole: string): AgentHRState | null {
    const event = this.db
      .prepare(
        `SELECT details FROM hr_events
         WHERE agent_role = ? AND event_type = 'state_changed'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(agentRole) as { details: string } | undefined;

    if (!event) return null;

    try {
      const details = JSON.parse(event.details);
      return details.new_state ?? null;
    } catch {
      return null;
    }
  }

  // ── Firing ─────────────────────────────────────────────────────────

  recordFiring(
    agentRole: string,
    reason?: string,
    performedBy: string = "system"
  ): HREvent {
    return this.logEvent(agentRole, "fired", {
      reason: reason ?? null,
    }, performedBy);
  }

  // ── Context Formatting ─────────────────────────────────────────────

  formatForContext(agentRole?: string, maxEvents: number = 10): string {
    const lines: string[] = [];

    // Onboarding status
    const onboarding = agentRole
      ? [this.getOnboarding(agentRole)].filter(Boolean) as OnboardingRecord[]
      : this.listOnboarding().filter((o) => !o.completed_at);

    if (onboarding.length > 0) {
      lines.push("## HR — Onboarding");
      for (const o of onboarding) {
        const phase = ONBOARDING_PHASES[o.current_phase as OnboardingPhase];
        if (o.completed_at) {
          lines.push(`- **${o.agent_role}**: Onboarding complete`);
        } else {
          lines.push(`- **${o.agent_role}**: Phase ${o.current_phase}/4 — ${phase.name} (autonomy: ${phase.autonomy})`);
        }
      }
    }

    // Active improvement plans
    const plans = agentRole
      ? [this.getActivePlan(agentRole)].filter(Boolean) as ImprovementPlan[]
      : this.db
          .prepare("SELECT * FROM hr_improvement_plans WHERE status = 'active' ORDER BY created_at DESC")
          .all() as ImprovementPlan[];

    if (plans.length > 0) {
      lines.push("");
      lines.push("## HR — Active Improvement Plans");
      for (const plan of plans) {
        let goalsArr: string[];
        try {
          goalsArr = JSON.parse(plan.goals);
        } catch {
          goalsArr = [plan.goals];
        }
        const goalsStr = goalsArr.slice(0, 3).join(", ");
        const deadlineStr = plan.deadline ? ` (deadline: ${plan.deadline})` : "";
        lines.push(`- **${plan.agent_role}**: ${goalsStr}${deadlineStr}`);
      }
    }

    // Recent events
    const events = this.getEvents(agentRole, undefined, maxEvents);
    if (events.length > 0) {
      lines.push("");
      lines.push("## HR — Recent Events");
      for (const event of events) {
        lines.push(`- [${event.event_type}] ${event.agent_role} — ${event.created_at}`);
      }
    }

    // HR action markers
    if (!agentRole || agentRole === "ceo") {
      lines.push("");
      lines.push("## HR Actions");
      lines.push("HR::HIRE role=<r> department=<d> [mentor=<m>]");
      lines.push("HR::ONBOARD_ADVANCE role=<r>");
      lines.push('HR::REVIEW role=<r> task=N quality=N efficiency=N collab=N summary="..." rec=<rec>');
      lines.push('HR::PROMOTE role=<r> from=<level> to=<level> reason="..."');
      lines.push('HR::DEMOTE role=<r> from=<level> to=<level> reason="..."');
      lines.push('HR::IMPROVE role=<r> goals="g1;g2" [deadline=DATE]');
      lines.push('HR::STATE role=<r> state=<s> [reason="..."]');
      lines.push('HR::FIRE role=<r> [reason="..."]');
    }

    // Token safety
    const output = lines.join("\n");
    if (output.length > 3000) {
      const trimmed = ["## HR (truncated)"];
      if (onboarding.length > 0) {
        trimmed.push(`${onboarding.length} agent(s) in onboarding`);
      }
      if (plans.length > 0) {
        trimmed.push(`${plans.length} active improvement plan(s)`);
      }
      trimmed.push(`Use \`aicib hr\` to see full HR dashboard.`);
      return trimmed.join("\n");
    }

    return output;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
