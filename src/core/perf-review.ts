import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { HRManager, type CreateReviewInput, type Recommendation } from "./hr.js";
import { loadAgentDefinitions, type AgentDefinition } from "./agents.js";
import { getAgentsDir } from "./team.js";
import { loadConfig } from "./config.js";

// ── Type Definitions ────────────────────────────────────────────────

export interface AutoReviewConfig {
  enabled: boolean;
  trigger: "task_completed" | "periodic" | "both";
  min_tasks_before_review: number;
  cooldown_hours: number;
  include_cost_efficiency: boolean;
  periodic_cadence: string;
}

export const AUTO_REVIEW_CONFIG_DEFAULTS: AutoReviewConfig = {
  enabled: true,
  trigger: "task_completed",
  min_tasks_before_review: 3,
  cooldown_hours: 48,
  include_cost_efficiency: true,
  periodic_cadence: "monthly",
};

export const VALID_TRIGGERS = ["task_completed", "periodic", "both"] as const;

export interface AutoReviewMetrics {
  taskCompletionCount: number;
  taskAssignedCount: number;
  avgTaskDurationMs: number;
  totalCostUsd: number;
  costPerTask: number;
  teamAvgCostPerTask: number;
  reviewApprovalRate: number;
  commentActivityCount: number;
}

export interface ReviewScores {
  taskScore: number;
  qualityScore: number;
  efficiencyScore: number;
  collaborationScore: number;
}

export interface AutoReviewQueueEntry {
  id: number;
  agent_role: string;
  trigger_event: string;
  trigger_data: string; // JSON
  status: "pending" | "processing" | "completed" | "skipped";
  review_id: number | null;
  created_at: string;
  processed_at: string | null;
}

// ── Metric Collection ───────────────────────────────────────────────

export function collectAgentMetrics(
  projectDir: string,
  agentRole: string,
  windowDays: number = 30
): AutoReviewMetrics {
  const dbPath = path.join(projectDir, ".aicib", "state.db");
  let db: Database.Database | undefined;

  try {
    db = new Database(dbPath, { readonly: true });
    db.pragma("busy_timeout = 3000");

    windowDays = Math.max(1, Math.min(365, Math.floor(windowDays)));
    const cutoffDays = `-${windowDays} days`;

    // Task completion metrics
    let taskCompletionCount = 0;
    let taskAssignedCount = 0;
    let avgTaskDurationMs = 0;

    try {
      const completed = db
        .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'done' AND updated_at >= datetime('now', ?)")
        .get(agentRole, cutoffDays) as { count: number };
      taskCompletionCount = completed.count;

      const assigned = db
        .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND created_at >= datetime('now', ?)")
        .get(agentRole, cutoffDays) as { count: number };
      taskAssignedCount = assigned.count;

      // Average task duration (time from creation to done)
      const durations = db
        .prepare("SELECT AVG((julianday(updated_at) - julianday(created_at)) * 86400000) as avg_ms FROM tasks WHERE assigned_to = ? AND status = 'done' AND updated_at >= datetime('now', ?)")
        .get(agentRole, cutoffDays) as { avg_ms: number | null };
      avgTaskDurationMs = durations.avg_ms ?? 0;
    } catch { /* tasks table may not exist */ }

    // Cost metrics
    let totalCostUsd = 0;
    let costPerTask = 0;
    let teamAvgCostPerTask = 0;

    try {
      const agentCost = db
        .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM cost_entries WHERE agent_role = ? AND timestamp >= datetime('now', ?)")
        .get(agentRole, cutoffDays) as { total: number };
      totalCostUsd = agentCost.total;

      costPerTask = taskCompletionCount > 0 ? totalCostUsd / taskCompletionCount : 0;

      // Team average cost per task
      const teamCost = db
        .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM cost_entries WHERE timestamp >= datetime('now', ?)")
        .get(cutoffDays) as { total: number };
      const teamCompleted = db
        .prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND updated_at >= datetime('now', ?)")
        .get(cutoffDays) as { count: number };
      teamAvgCostPerTask = teamCompleted.count > 0 ? teamCost.total / teamCompleted.count : 0;
    } catch { /* cost_entries may not exist */ }

    // Review approval rate
    let reviewApprovalRate = 0;
    try {
      const reviews = db
        .prepare("SELECT COUNT(*) as total, SUM(CASE WHEN content LIKE 'approved%' OR content = 'approved' THEN 1 ELSE 0 END) as approved FROM task_comments WHERE agent_role = ? AND comment_type = 'review_result' AND created_at >= datetime('now', ?)")
        .get(agentRole, cutoffDays) as { total: number; approved: number };
      reviewApprovalRate = reviews.total > 0 ? reviews.approved / reviews.total : 1;
    } catch {
      // task_comments table may not exist, default to 100% approval
      reviewApprovalRate = 1;
    }

    // Comment activity count
    let commentActivityCount = 0;
    try {
      const comments = db
        .prepare("SELECT COUNT(*) as count FROM task_comments WHERE agent_role = ? AND created_at >= datetime('now', ?)")
        .get(agentRole, cutoffDays) as { count: number };
      commentActivityCount = comments.count;
    } catch { /* table may not exist */ }

    return {
      taskCompletionCount,
      taskAssignedCount,
      avgTaskDurationMs,
      totalCostUsd,
      costPerTask,
      teamAvgCostPerTask,
      reviewApprovalRate,
      commentActivityCount,
    };
  } finally {
    db?.close();
  }
}

// ── Score Computation ───────────────────────────────────────────────

export function computeReviewScores(metrics: AutoReviewMetrics, includeEfficiency?: boolean): ReviewScores {
  // taskScore: completion rate scaled to 0-100
  const completionRate = metrics.taskAssignedCount > 0
    ? metrics.taskCompletionCount / metrics.taskAssignedCount
    : 1;
  const taskScore = Math.min(100, Math.round(completionRate * 100));

  // qualityScore: review approval rate * 100
  const qualityScore = Math.min(100, Math.round(metrics.reviewApprovalRate * 100));

  // efficiencyScore: cost efficiency vs team average (lower cost = higher score)
  let efficiencyScore = 0;
  if (includeEfficiency !== false) {
    efficiencyScore = 75; // default if no cost data
    if (metrics.teamAvgCostPerTask > 0 && metrics.costPerTask > 0) {
      // Ratio of team average to agent cost. >1 means agent is cheaper
      const ratio = metrics.teamAvgCostPerTask / metrics.costPerTask;
      // Score: ratio clamped into 0-100 range, centered at 50 for average performance
      efficiencyScore = Math.min(100, Math.max(0, Math.round(ratio * 50)));
    }
  }

  // collaborationScore: comment activity count, capped at 20 interactions = 100
  const collaborationScore = Math.min(100, Math.round((metrics.commentActivityCount / 20) * 100));

  return { taskScore, qualityScore, efficiencyScore, collaborationScore };
}

// ── Reviewer Determination ──────────────────────────────────────────

export function getReviewerForAgent(
  projectDir: string,
  _config: unknown,
  agentRole: string
): string | null {
  // CEO is not auto-reviewed — founder reviews manually
  if (agentRole === "ceo") return null;

  try {
    const agentsDir = getAgentsDir(projectDir);
    const agents = loadAgentDefinitions(agentsDir);

    const agentDef = agents.get(agentRole);
    if (!agentDef) return "ceo"; // fallback: CEO reviews unknown agents

    const reportsTo = agentDef.frontmatter.reports_to;
    if (!reportsTo || reportsTo === "founder" || reportsTo === "human-founder") {
      return "ceo"; // C-suite agents: CEO reviews them
    }

    // Verify the reviewer exists
    if (agents.has(reportsTo)) {
      return reportsTo;
    }

    return "ceo"; // fallback
  } catch {
    return "ceo"; // fallback if agents can't be loaded
  }
}

// ── Recommendation Derivation ───────────────────────────────────────

export function deriveRecommendation(overallScore: number): Recommendation {
  if (overallScore >= 85) return "promote";
  if (overallScore >= 60) return "maintain";
  if (overallScore >= 40) return "improve";
  return "demote";
}

// ── Eligibility Check ───────────────────────────────────────────────

export function isEligibleForAutoReview(
  projectDir: string,
  agentRole: string,
  autoConfig: AutoReviewConfig
): boolean {
  // CEO is never auto-reviewed
  if (agentRole === "ceo") return false;

  const dbPath = path.join(projectDir, ".aicib", "state.db");
  let db: Database.Database | undefined;

  try {
    db = new Database(dbPath, { readonly: true });
    db.pragma("busy_timeout = 3000");

    // Check min_tasks threshold
    try {
      const completed = db
        .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'done'")
        .get(agentRole) as { count: number };

      if (completed.count < autoConfig.min_tasks_before_review) {
        return false;
      }
    } catch {
      return false; // tasks table doesn't exist
    }

    // Check cooldown_hours since last review
    try {
      const lastReview = db
        .prepare("SELECT created_at FROM hr_reviews WHERE agent_role = ? ORDER BY created_at DESC LIMIT 1")
        .get(agentRole) as { created_at: string } | undefined;

      if (lastReview) {
        const lastReviewTime = new Date(lastReview.created_at).getTime();
        const cooldownMs = autoConfig.cooldown_hours * 60 * 60 * 1000;
        if (Date.now() - lastReviewTime < cooldownMs) {
          return false;
        }
      }
    } catch { /* hr_reviews may not exist — eligible */ }

    return true;
  } finally {
    db?.close();
  }
}

// ── Queue Processing ────────────────────────────────────────────────

export function processAutoReviewQueue(
  projectDir: string,
  config: AutoReviewConfig
): number {
  const dbPath = path.join(projectDir, ".aicib", "state.db");
  let db: Database.Database | undefined;
  let hr: HRManager | undefined;
  let processed = 0;

  try {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");

    // Atomic claim: use a transaction to claim one pending entry at a time
    const claimOne = db.transaction(() => {
      const entry = db!
        .prepare("SELECT * FROM auto_review_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
        .get() as AutoReviewQueueEntry | undefined;
      if (!entry) return null;
      db!.prepare("UPDATE auto_review_queue SET status = 'processing' WHERE id = ?").run(entry.id);
      return entry;
    });

    hr = new HRManager(projectDir);

    let entry: AutoReviewQueueEntry | null;
    while ((entry = claimOne()) !== null) {
      try {
        // Check eligibility
        if (!isEligibleForAutoReview(projectDir, entry.agent_role, config)) {
          db.prepare("UPDATE auto_review_queue SET status = 'skipped', processed_at = datetime('now') WHERE id = ?").run(entry.id);
          continue;
        }

        // Determine reviewer
        const reviewer = getReviewerForAgent(projectDir, config, entry.agent_role);
        if (!reviewer) {
          db.prepare("UPDATE auto_review_queue SET status = 'skipped', processed_at = datetime('now') WHERE id = ?").run(entry.id);
          continue;
        }

        // Collect metrics
        const metrics = collectAgentMetrics(projectDir, entry.agent_role);

        // Compute scores (respecting include_cost_efficiency config)
        const includeEfficiency = config.include_cost_efficiency;
        const scores = computeReviewScores(metrics, includeEfficiency);

        // Calculate overall score with dynamic weights based on efficiency inclusion
        let overallScore: number;
        if (includeEfficiency === false) {
          // Redistribute efficiency weight: task 37.5%, quality 37.5%, collaboration 25%
          overallScore = Math.round(
            scores.taskScore * 0.375 +
            scores.qualityScore * 0.375 +
            scores.collaborationScore * 0.25
          );
        } else {
          overallScore = Math.round(
            scores.taskScore * 0.3 +
            scores.qualityScore * 0.3 +
            scores.efficiencyScore * 0.2 +
            scores.collaborationScore * 0.2
          );
        }

        // Derive recommendation
        const recommendation = deriveRecommendation(overallScore);

        // Create review via HRManager
        const review = hr.createReview({
          agentRole: entry.agent_role,
          reviewer,
          reviewType: "periodic",
          taskScore: scores.taskScore,
          qualityScore: scores.qualityScore,
          efficiencyScore: scores.efficiencyScore,
          collaborationScore: scores.collaborationScore,
          summary: `Auto-review: ${metrics.taskCompletionCount} tasks completed, $${metrics.totalCostUsd.toFixed(4)} total cost, ${recommendation} recommended`,
          recommendation,
        });

        // Update queue entry
        db.prepare("UPDATE auto_review_queue SET status = 'completed', review_id = ?, processed_at = datetime('now') WHERE id = ?")
          .run(review.id, entry.id);

        processed++;
      } catch (e) {
        console.warn(`Auto-review processing failed for ${entry.agent_role}:`, e);
        db.prepare("UPDATE auto_review_queue SET status = 'skipped', processed_at = datetime('now') WHERE id = ?").run(entry.id);
      }
    }

    return processed;
  } finally {
    hr?.close();
    db?.close();
  }
}
