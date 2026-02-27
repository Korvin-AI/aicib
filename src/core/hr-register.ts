/**
 * Hook registration for the HR system.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `hr:` section in aicib.config.yaml
 * - Database tables: hr_events, hr_onboarding, hr_reviews, hr_improvement_plans
 * - Context provider: hr-context (injects HR info into agent prompts)
 * - Message handler: hr-actions (detects HR:: markers in agent output)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  HRManager,
  HR_CONFIG_DEFAULTS,
  VALID_RAMP_SPEEDS,
  VALID_RECOMMENDATIONS,
  VALID_AGENT_HR_STATES,
  type HRConfig,
  type RampSpeed,
  type Recommendation,
  type AgentHRState,
} from "./hr.js";

// --- Config extension ---

registerConfigExtension({
  key: "hr",
  defaults: { ...HR_CONFIG_DEFAULTS },
  validate: (raw: unknown) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;

      if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
        errors.push("hr.enabled must be a boolean");
      }

      if (obj.review_cadence !== undefined) {
        const valid = ["weekly", "biweekly", "monthly", "quarterly"];
        if (!valid.includes(obj.review_cadence as string)) {
          errors.push(`hr.review_cadence must be one of: ${valid.join(", ")}`);
        }
      }

      if (obj.onboarding_ramp !== undefined) {
        if (!VALID_RAMP_SPEEDS.includes(obj.onboarding_ramp as RampSpeed)) {
          errors.push(`hr.onboarding_ramp must be one of: ${VALID_RAMP_SPEEDS.join(", ")}`);
        }
      }

      if (obj.max_context_events !== undefined) {
        if (typeof obj.max_context_events !== "number" || obj.max_context_events < 0) {
          errors.push("hr.max_context_events must be a non-negative number");
        }
      }

      if (obj.auto_onboard !== undefined && typeof obj.auto_onboard !== "boolean") {
        errors.push("hr.auto_onboard must be a boolean");
      }
    }
    return errors;
  },
});

// --- Database tables ---

registerTable({
  name: "hr_events",
  createSQL: `CREATE TABLE IF NOT EXISTS hr_events (
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
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_hr_events_agent ON hr_events(agent_role)",
    "CREATE INDEX IF NOT EXISTS idx_hr_events_type ON hr_events(event_type)",
    "CREATE INDEX IF NOT EXISTS idx_hr_events_created ON hr_events(created_at)",
  ],
});

registerTable({
  name: "hr_onboarding",
  createSQL: `CREATE TABLE IF NOT EXISTS hr_onboarding (
    agent_role TEXT PRIMARY KEY,
    current_phase INTEGER NOT NULL DEFAULT 1 CHECK(current_phase BETWEEN 1 AND 4),
    phase_started_at TEXT NOT NULL DEFAULT (datetime('now')),
    mentor TEXT,
    ramp_speed TEXT NOT NULL DEFAULT 'standard'
      CHECK(ramp_speed IN ('instant','standard','extended')),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
});

registerTable({
  name: "hr_reviews",
  createSQL: `CREATE TABLE IF NOT EXISTS hr_reviews (
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
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_hr_reviews_agent ON hr_reviews(agent_role)",
    "CREATE INDEX IF NOT EXISTS idx_hr_reviews_created ON hr_reviews(created_at)",
  ],
});

registerTable({
  name: "hr_improvement_plans",
  createSQL: `CREATE TABLE IF NOT EXISTS hr_improvement_plans (
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
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_hr_plans_agent ON hr_improvement_plans(agent_role)",
    "CREATE INDEX IF NOT EXISTS idx_hr_plans_status ON hr_improvement_plans(status)",
  ],
});

// --- Context provider ---

registerContextProvider("hr-context", async (config, projectDir) => {
  lastProjectDir = projectDir;

  const hrConfig = config.extensions?.hr as HRConfig | undefined;
  if (hrConfig && !hrConfig.enabled) return "";

  const maxEvents = hrConfig?.max_context_events ?? 10;
  if (maxEvents === 0) return "";

  let hr: HRManager | undefined;
  try {
    hr = new HRManager(projectDir);
    return hr.formatForContext(undefined, maxEvents);
  } catch {
    return "";
  } finally {
    hr?.close();
  }
});

// --- Message handler ---

interface PendingHRAction {
  type: string;
  data: Record<string, string>;
}

let pendingActions: PendingHRAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastProjectDir: string | null = null;

function queueAction(action: PendingHRAction, projectDir: string): void {
  lastProjectDir = projectDir;
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

  let hr: HRManager | undefined;
  try {
    hr = new HRManager(lastProjectDir);

    for (const action of actions) {
      try {
        switch (action.type) {
          case "hire": {
            const { role, department, mentor } = action.data;
            if (!role?.trim() || !department?.trim()) break;
            hr.recordHire(role, department, "ceo", undefined, mentor || undefined);
            break;
          }
          case "onboard_advance": {
            const { role } = action.data;
            if (!role?.trim()) break;
            hr.advanceOnboarding(role, "ceo");
            break;
          }
          case "onboard_complete": {
            const { role } = action.data;
            if (!role?.trim()) break;
            hr.completeOnboarding(role, "ceo");
            break;
          }
          case "review": {
            const { role, task, quality, efficiency, collab, summary, rec } = action.data;
            if (!role?.trim()) break;
            hr.createReview({
              agentRole: role,
              reviewer: "ceo",
              taskScore: task ? parseFloat(task) : undefined,
              qualityScore: quality ? parseFloat(quality) : undefined,
              efficiencyScore: efficiency ? parseFloat(efficiency) : undefined,
              collaborationScore: collab ? parseFloat(collab) : undefined,
              summary: summary || undefined,
              recommendation: (VALID_RECOMMENDATIONS.includes(rec as Recommendation) ? rec : "maintain") as Recommendation,
            });
            break;
          }
          case "promote": {
            const { role, from, to, reason } = action.data;
            if (!role?.trim() || !from || !to) break;
            hr.recordPromotion(role, from, to, reason || undefined, "ceo");
            break;
          }
          case "demote": {
            const { role, from, to, reason } = action.data;
            if (!role?.trim() || !from || !to) break;
            hr.recordDemotion(role, from, to, reason || undefined, "ceo");
            break;
          }
          case "improve": {
            const { role, goals, deadline } = action.data;
            if (!role?.trim() || !goals?.trim()) break;
            const goalList = goals.split(";").map((g) => g.trim()).filter(Boolean);
            hr.createImprovementPlan({
              agentRole: role,
              createdBy: "ceo",
              goals: goalList,
              deadline: deadline || undefined,
            });
            break;
          }
          case "state": {
            const { role, state, reason } = action.data;
            if (!role?.trim() || !state?.trim()) break;
            if (!VALID_AGENT_HR_STATES.includes(state as AgentHRState)) break;
            hr.recordStateChange(role, state as AgentHRState, reason || undefined, "ceo");
            break;
          }
          case "fire": {
            const { role, reason } = action.data;
            if (!role?.trim()) break;
            hr.recordFiring(role, reason || undefined, "ceo");
            break;
          }
        }
      } catch (e) {
        console.warn("HR action failed:", e);
      }
    }
  } catch (e) {
    console.warn("HR flush DB error:", e);
  } finally {
    hr?.close();
  }
}

registerMessageHandler("hr-actions", (msg, config) => {
  const hrConfig = config.extensions?.hr as HRConfig | undefined;
  if (hrConfig && !hrConfig.enabled) return;

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

  // Parse structured HR:: markers

  // HR::HIRE role=<r> department=<d> [mentor=<m>]
  const hireMatches = text.matchAll(
    /HR::HIRE\s+role=(\S+)\s+department=(\S+)(?:\s+mentor=(\S+))?/g
  );
  for (const match of hireMatches) {
    queueAction(
      { type: "hire", data: { role: match[1], department: match[2], mentor: match[3] || "" } },
      lastProjectDir
    );
  }

  // HR::ONBOARD_ADVANCE role=<r>
  const advanceMatches = text.matchAll(/HR::ONBOARD_ADVANCE\s+role=(\S+)/g);
  for (const match of advanceMatches) {
    queueAction(
      { type: "onboard_advance", data: { role: match[1] } },
      lastProjectDir
    );
  }

  // HR::REVIEW role=<r> task=N quality=N efficiency=N collab=N summary="..." rec=<rec>
  const reviewMatches = text.matchAll(
    /HR::REVIEW\s+role=(\S+)\s+task=(\d+)\s+quality=(\d+)\s+efficiency=(\d+)\s+collab=(\d+)\s+summary="([^"]*)"\s+rec=(\S+)/g
  );
  for (const match of reviewMatches) {
    queueAction(
      {
        type: "review",
        data: {
          role: match[1], task: match[2], quality: match[3],
          efficiency: match[4], collab: match[5], summary: match[6], rec: match[7],
        },
      },
      lastProjectDir
    );
  }

  // HR::PROMOTE role=<r> from=<level> to=<level> reason="..."
  const promoteMatches = text.matchAll(
    /HR::PROMOTE\s+role=(\S+)\s+from=(\S+)\s+to=(\S+)(?:\s+reason="([^"]*)")?/g
  );
  for (const match of promoteMatches) {
    queueAction(
      { type: "promote", data: { role: match[1], from: match[2], to: match[3], reason: match[4] || "" } },
      lastProjectDir
    );
  }

  // HR::DEMOTE role=<r> from=<level> to=<level> reason="..."
  const demoteMatches = text.matchAll(
    /HR::DEMOTE\s+role=(\S+)\s+from=(\S+)\s+to=(\S+)(?:\s+reason="([^"]*)")?/g
  );
  for (const match of demoteMatches) {
    queueAction(
      { type: "demote", data: { role: match[1], from: match[2], to: match[3], reason: match[4] || "" } },
      lastProjectDir
    );
  }

  // HR::IMPROVE role=<r> goals="g1;g2" [deadline=DATE]
  const improveMatches = text.matchAll(
    /HR::IMPROVE\s+role=(\S+)\s+goals="([^"]+)"(?:\s+deadline=(\S+))?/g
  );
  for (const match of improveMatches) {
    queueAction(
      { type: "improve", data: { role: match[1], goals: match[2], deadline: match[3] || "" } },
      lastProjectDir
    );
  }

  // HR::STATE role=<r> state=<s> [reason="..."]
  const stateMatches = text.matchAll(
    /HR::STATE\s+role=(\S+)\s+state=(\S+)(?:\s+reason="([^"]*)")?/g
  );
  for (const match of stateMatches) {
    queueAction(
      { type: "state", data: { role: match[1], state: match[2], reason: match[3] || "" } },
      lastProjectDir
    );
  }

  // HR::FIRE role=<r> [reason="..."]
  const fireMatches = text.matchAll(
    /HR::FIRE\s+role=(\S+)(?:\s+reason="([^"]*)")?/g
  );
  for (const match of fireMatches) {
    queueAction(
      { type: "fire", data: { role: match[1], reason: match[2] || "" } },
      lastProjectDir
    );
  }

  // Natural language fallbacks (minimal, high-confidence)
  const hireNl = text.matchAll(/hired agent (\S+)/gi);
  for (const match of hireNl) {
    queueAction(
      { type: "hire", data: { role: match[1], department: "general" } },
      lastProjectDir
    );
  }

  const completeNl = text.matchAll(/completed onboarding for (\S+)/gi);
  for (const match of completeNl) {
    queueAction(
      { type: "onboard_complete", data: { role: match[1] } },
      lastProjectDir
    );
  }
});
