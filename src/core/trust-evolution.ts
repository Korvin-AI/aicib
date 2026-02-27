/**
 * Trust Evolution (#38)
 *
 * Tracks agent reliability for external actions over time and progressively
 * relaxes approval chains as agents prove trustworthy. Each agent+category
 * pair has a trust level that evolves based on action history.
 *
 * Four levels: probationary -> established -> trusted -> veteran
 *
 * Integration with autonomy-matrix: agents at restricted/guided autonomy
 * are capped at `established` trust to prevent bypassing autonomy controls.
 */

import type Database from "better-sqlite3";
import {
  type AutonomyLevel,
  type AutonomyConfig,
  resolveAutonomyLevel,
} from "./autonomy-matrix.js";

// ── Types ───────────────────────────────────────────────────────────

export type TrustLevel =
  | "probationary"
  | "established"
  | "trusted"
  | "veteran";

export const VALID_TRUST_LEVELS: TrustLevel[] = [
  "probationary",
  "established",
  "trusted",
  "veteran",
];

export interface TrustLevelThreshold {
  min_actions: number;
  min_approval_rate: number;
  min_age_days: number;
}

export const TRUST_LEVEL_THRESHOLDS: Record<TrustLevel, TrustLevelThreshold> = {
  probationary: { min_actions: 0, min_approval_rate: 0, min_age_days: 0 },
  established: { min_actions: 10, min_approval_rate: 85, min_age_days: 14 },
  trusted: { min_actions: 30, min_approval_rate: 92, min_age_days: 60 },
  veteran: { min_actions: 100, min_approval_rate: 97, min_age_days: 180 },
};

export interface TrustChainModification {
  skip_first: string[];
  auto_approve: string[];
}

export const TRUST_CHAIN_MODIFICATIONS: Record<TrustLevel, TrustChainModification> = {
  probationary: { skip_first: [], auto_approve: [] },
  established: { skip_first: [], auto_approve: [] },
  trusted: {
    skip_first: ["social_media", "customer_email"],
    auto_approve: [],
  },
  veteran: {
    skip_first: ["social_media", "customer_email", "public_content"],
    auto_approve: ["social_media", "customer_email", "public_content"],
  },
};

export interface TrustScore {
  total_actions: number;
  approved_count: number;
  rejected_count: number;
  approval_rate: number;
  age_days: number;
  current_level: TrustLevel;
  next_level: TrustLevel | null;
  progress_to_next: {
    actions: { current: number; required: number };
    approval_rate: { current: number; required: number };
    age_days: { current: number; required: number };
  } | null;
}

export interface TrustConfig {
  enabled: boolean;
  overrides: Record<string, Record<string, TrustLevel>>;
  auto_recommend: boolean;
  max_level: TrustLevel;
}

export const TRUST_CONFIG_DEFAULTS: TrustConfig = {
  enabled: true,
  overrides: {},
  auto_recommend: true,
  max_level: "veteran",
};

// ── Autonomy level cap ──────────────────────────────────────────────

const TRUST_LEVEL_ORDER: TrustLevel[] = [
  "probationary",
  "established",
  "trusted",
  "veteran",
];

function trustLevelIndex(level: TrustLevel): number {
  return TRUST_LEVEL_ORDER.indexOf(level);
}

function capTrustByAutonomy(
  trustLevel: TrustLevel,
  autonomyLevel: AutonomyLevel
): TrustLevel {
  // Agents at restricted/guided autonomy are capped at established
  if (autonomyLevel === "restricted" || autonomyLevel === "guided") {
    const capIdx = trustLevelIndex("established");
    const currentIdx = trustLevelIndex(trustLevel);
    if (currentIdx > capIdx) return "established";
  }
  return trustLevel;
}

// ── Validation ──────────────────────────────────────────────────────

export function validateTrustConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return errors;

  const obj = raw as Record<string, unknown>;

  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    errors.push("trust.enabled must be a boolean");
  }

  if (obj.auto_recommend !== undefined && typeof obj.auto_recommend !== "boolean") {
    errors.push("trust.auto_recommend must be a boolean");
  }

  if (obj.max_level !== undefined) {
    if (!VALID_TRUST_LEVELS.includes(obj.max_level as TrustLevel)) {
      errors.push(
        `trust.max_level must be one of: ${VALID_TRUST_LEVELS.join(", ")}`
      );
    }
  }

  if (obj.overrides !== undefined) {
    if (typeof obj.overrides !== "object" || obj.overrides === null) {
      errors.push("trust.overrides must be an object");
    } else {
      for (const [agent, cats] of Object.entries(
        obj.overrides as Record<string, unknown>
      )) {
        if (typeof cats !== "object" || cats === null) {
          errors.push(`trust.overrides.${agent} must be an object`);
          continue;
        }
        for (const [cat, level] of Object.entries(
          cats as Record<string, unknown>
        )) {
          if (!VALID_TRUST_LEVELS.includes(level as TrustLevel)) {
            errors.push(
              `trust.overrides.${agent}.${cat} must be one of: ${VALID_TRUST_LEVELS.join(", ")}`
            );
          }
        }
      }
    }
  }

  return errors;
}

// ── Core functions ──────────────────────────────────────────────────

interface ExternalActionRow {
  agent_role: string;
  category: string;
  outcome: string;
  created_at: string;
}

/**
 * Compute the trust score for a specific agent+category from action history.
 */
export function computeTrustScore(
  db: Database.Database,
  agentRole: string,
  category: string
): TrustScore {
  const rows = db
    .prepare(
      `SELECT agent_role, category, outcome, created_at
       FROM external_actions
       WHERE agent_role = ? AND category = ?
       ORDER BY created_at ASC`
    )
    .all(agentRole, category) as ExternalActionRow[];

  const totalActions = rows.length;
  const approvedCount = rows.filter((r) => r.outcome === "approved").length;
  const rejectedCount = rows.filter((r) => r.outcome === "rejected").length;
  const approvalRate =
    totalActions > 0 ? (approvedCount / totalActions) * 100 : 0;

  // Age in days since first action
  let ageDays = 0;
  if (rows.length > 0) {
    const firstDate = new Date(rows[0].created_at);
    ageDays = Math.floor(
      (Date.now() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  // Determine current level based on thresholds
  let currentLevel: TrustLevel = "probationary";
  for (const level of TRUST_LEVEL_ORDER) {
    const threshold = TRUST_LEVEL_THRESHOLDS[level];
    if (
      totalActions >= threshold.min_actions &&
      approvalRate >= threshold.min_approval_rate &&
      ageDays >= threshold.min_age_days
    ) {
      currentLevel = level;
    }
  }

  // Determine next level and progress
  const currentIdx = trustLevelIndex(currentLevel);
  const nextIdx = currentIdx + 1;
  let nextLevel: TrustLevel | null = null;
  let progressToNext: TrustScore["progress_to_next"] = null;

  if (nextIdx < TRUST_LEVEL_ORDER.length) {
    nextLevel = TRUST_LEVEL_ORDER[nextIdx];
    const nextThreshold = TRUST_LEVEL_THRESHOLDS[nextLevel];
    progressToNext = {
      actions: {
        current: totalActions,
        required: nextThreshold.min_actions,
      },
      approval_rate: {
        current: Math.round(approvalRate * 100) / 100,
        required: nextThreshold.min_approval_rate,
      },
      age_days: {
        current: ageDays,
        required: nextThreshold.min_age_days,
      },
    };
  }

  return {
    total_actions: totalActions,
    approved_count: approvedCount,
    rejected_count: rejectedCount,
    approval_rate: Math.round(approvalRate * 100) / 100,
    age_days: ageDays,
    current_level: currentLevel,
    next_level: nextLevel,
    progress_to_next: progressToNext,
  };
}

/**
 * Compute trust scores across all categories for a given agent.
 */
export function computeAgentTrustScores(
  db: Database.Database,
  agentRole: string
): Record<string, TrustScore> {
  const scores: Record<string, TrustScore> = {};

  const catRows = db
    .prepare(
      `SELECT DISTINCT category FROM external_actions WHERE agent_role = ?`
    )
    .all(agentRole) as Array<{ category: string }>;

  for (const row of catRows) {
    scores[row.category] = computeTrustScore(db, agentRole, row.category);
  }

  return scores;
}

/**
 * Resolve the effective trust level for an agent+category.
 * Priority: config override > computed from history > probationary
 *
 * Applies autonomy cap: restricted/guided agents capped at established.
 */
export function resolveTrustLevel(
  agentRole: string,
  category: string,
  config: TrustConfig,
  db: Database.Database,
  autonomyConfig?: AutonomyConfig
): TrustLevel {
  let level: TrustLevel;

  // 1. Check config override
  const override = config.overrides?.[agentRole]?.[category];
  if (override && VALID_TRUST_LEVELS.includes(override)) {
    level = override;
  } else {
    // 2. Compute from history
    const score = computeTrustScore(db, agentRole, category);
    level = score.current_level;
  }

  // 3. Cap by max_level config
  const maxIdx = trustLevelIndex(config.max_level || "veteran");
  const currentIdx = trustLevelIndex(level);
  if (currentIdx > maxIdx) {
    level = config.max_level || "veteran";
  }

  // 4. Cap by autonomy level
  if (autonomyConfig) {
    const autonomyLevel = resolveAutonomyLevel(
      agentRole,
      undefined,
      autonomyConfig
    );
    level = capTrustByAutonomy(level, autonomyLevel);
  }

  return level;
}

export interface TrustRecommendation {
  agent_role: string;
  category: string;
  current_level: TrustLevel;
  recommended_level: TrustLevel;
  score: TrustScore;
}

/**
 * Find agents that are ready for trust level upgrades.
 */
export function getTrustRecommendations(
  db: Database.Database,
  config: TrustConfig
): TrustRecommendation[] {
  if (!config.auto_recommend) return [];

  const recommendations: TrustRecommendation[] = [];

  // Get all agent+category pairs
  const rows = db
    .prepare(
      `SELECT DISTINCT agent_role, category FROM external_actions`
    )
    .all() as Array<{ agent_role: string; category: string }>;

  for (const row of rows) {
    const score = computeTrustScore(db, row.agent_role, row.category);

    // Skip if override exists (manually set)
    if (config.overrides?.[row.agent_role]?.[row.category]) continue;

    // Recommend if agent meets at least 2 of 3 thresholds for next level.
    // Note: computeTrustScore already promotes currentLevel to the highest
    // fully-qualifying level, so checking all 3 thresholds would be
    // unreachable. Instead, surface agents that are *close* to the next
    // level (2/3 criteria met) so operators can grant early overrides.
    if (score.next_level && score.progress_to_next) {
      const p = score.progress_to_next;
      const metCount = [
        p.actions.current >= p.actions.required,
        p.approval_rate.current >= p.approval_rate.required,
        p.age_days.current >= p.age_days.required,
      ].filter(Boolean).length;

      if (metCount >= 2) {
        // Cap by max_level
        const maxIdx = trustLevelIndex(config.max_level || "veteran");
        const nextIdx = trustLevelIndex(score.next_level);
        if (nextIdx <= maxIdx) {
          recommendations.push({
            agent_role: row.agent_role,
            category: row.category,
            current_level: score.current_level,
            recommended_level: score.next_level,
            score,
          });
        }
      }
    }
  }

  return recommendations;
}

/**
 * Record an external action outcome for trust tracking.
 */
export function recordExternalAction(
  db: Database.Database,
  agentRole: string,
  category: string,
  description: string,
  outcome: string,
  approvedBy?: string,
  rejectedBy?: string,
  rejectionReason?: string
): void {
  db.prepare(
    `INSERT INTO external_actions
     (agent_role, category, description, outcome, approved_by, rejected_by, rejection_reason, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    agentRole,
    category,
    description,
    outcome,
    approvedBy || null,
    rejectedBy || null,
    rejectionReason || null
  );
}

// ── Context formatting ──────────────────────────────────────────────

/**
 * Format trust evolution data as markdown for the CEO prompt.
 */
export function formatTrustContext(
  db: Database.Database,
  config: TrustConfig,
  agentRoles: string[],
  autonomyConfig?: AutonomyConfig
): string {
  if (!config.enabled) return "";

  const lines: string[] = [
    "## Trust Evolution",
    "",
    "Agent trust levels evolve based on external action history.",
    "Higher trust = shorter approval chains for qualifying categories.",
    "",
  ];

  const agentData: Array<{
    role: string;
    scores: Record<string, TrustScore>;
    autonomyLevel?: string;
  }> = [];

  for (const role of agentRoles) {
    const scores = computeAgentTrustScores(db, role);
    let autonomyLevel: string | undefined;
    if (autonomyConfig) {
      autonomyLevel = resolveAutonomyLevel(role, undefined, autonomyConfig);
    }
    agentData.push({ role, scores, autonomyLevel });
  }

  // Only show agents that have trust data
  const agentsWithData = agentData.filter(
    (a) => Object.keys(a.scores).length > 0
  );

  if (agentsWithData.length > 0) {
    lines.push("### Agent Trust Levels", "");
    lines.push(
      "| Agent | Category | Level | Actions | Approval Rate | Autonomy |"
    );
    lines.push(
      "|-------|----------|-------|---------|--------------|----------|"
    );

    for (const info of agentsWithData) {
      for (const [category, score] of Object.entries(info.scores)) {
        const effectiveLevel = resolveTrustLevel(
          info.role,
          category,
          config,
          db,
          autonomyConfig
        );
        lines.push(
          `| ${info.role} | ${category} | ${effectiveLevel} | ${score.total_actions} | ${score.approval_rate}% | ${info.autonomyLevel || "standard"} |`
        );
      }
    }
  } else {
    lines.push("_No external action history yet._");
  }

  // Recommendations
  const recommendations = getTrustRecommendations(db, config);
  if (recommendations.length > 0) {
    lines.push("", "### Upgrade Recommendations", "");
    for (const rec of recommendations) {
      lines.push(
        `- **${rec.agent_role}** (${rec.category}): ${rec.current_level} -> ${rec.recommended_level} ` +
          `(${rec.score.total_actions} actions, ${rec.score.approval_rate}% approval, ${rec.score.age_days}d)`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
