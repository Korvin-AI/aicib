/**
 * Review Chain Configuration (#39)
 *
 * Determines the review chain for a task based on its type, resolves
 * the appropriate reviewer at each layer, and tracks chain progress
 * by reading task comments. No new DB tables — chain state is derived
 * from the task's `reviewer` field and `review_result` comments.
 */

import {
  TaskManager,
  type Task,
  type TaskComment,
  type TasksConfig,
  type ReviewLayer,
  VALID_REVIEW_LAYERS,
} from "./task-manager.js";

// ── Types ───────────────────────────────────────────────────────────

export interface TasksConfigWithOverrides extends TasksConfig {
  review_chain_overrides: Record<string, Record<string, ReviewLayer[]>>;
}

export interface ReviewChainState {
  chain: ReviewLayer[];
  currentLayerIndex: number;
  completedLayers: ReviewLayer[];
  remainingLayers: ReviewLayer[];
  currentReviewer: string | null;
  chainType: string;
  isComplete: boolean;
}

// ── Keyword → chain type inference ──────────────────────────────────

const TYPE_KEYWORDS: Record<string, string[]> = {
  // Categories with longer/more-specific phrases first (first-match-wins)
  marketing_internal: ["marketing plan", "campaign plan", "brand guideline"],
  marketing_external: [
    "press release", "blog post", "social media", "newsletter",
    "customer email", "announcement",
  ],
  financial_report: [
    "financial", "budget", "revenue", "expense", "forecast",
    "quarterly report", "annual report", "p&l",
  ],
  strategic_plan: [
    "strategy", "strategic", "roadmap", "vision", "okr",
    "objective", "long-term plan",
  ],
  customer_facing: [
    "customer", "user-facing", "documentation", "help center",
    "support article", "onboarding",
  ],
  // Broad single-word matches last to avoid misclassification
  code: [
    "code", "implement", "develop", "build", "refactor", "debug", "fix bug",
    "api", "endpoint", "database", "migration", "deploy", "test",
  ],
};

// ── Chain Resolution ────────────────────────────────────────────────

/**
 * Determine which review chain applies to a task.
 *
 * Resolution order:
 * 1. Check `review_chain_overrides[department][type]`
 * 2. Check `default_review_chains[type]`
 * 3. Infer type from task title keywords
 * 4. Fall back to `internal_document` (["self"])
 */
export function resolveReviewChain(
  task: Task,
  tasksConfig: TasksConfigWithOverrides
): { chain: ReviewLayer[]; chainType: string } {
  const department = task.department?.toLowerCase() || "";
  const overrides = tasksConfig.review_chain_overrides || {};
  const defaults = tasksConfig.default_review_chains || {};

  // Try to infer type from task title
  const inferredType = inferChainType(task.title);

  // 1. Check department-specific overrides
  if (department && overrides[department]) {
    const deptOverrides = overrides[department];
    if (inferredType && deptOverrides[inferredType]) {
      return { chain: deptOverrides[inferredType], chainType: inferredType };
    }
  }

  // 2. Check default chains with inferred type
  if (inferredType && defaults[inferredType]) {
    return { chain: defaults[inferredType], chainType: inferredType };
  }

  // 3. Fall back to internal_document
  const fallbackChain = defaults.internal_document || ["self"];
  return {
    chain: fallbackChain as ReviewLayer[],
    chainType: "internal_document",
  };
}

/**
 * Infer chain type from task title keywords.
 */
function inferChainType(title: string): string | null {
  const lower = title.toLowerCase();

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return type;
      }
    }
  }

  return null;
}

// ── Reviewer Resolution ─────────────────────────────────────────────

interface AgentInfo {
  role: string;
  department: string;
}

const DEPARTMENT_HEADS: Record<string, string> = {
  engineering: "cto",
  finance: "cfo",
  marketing: "cmo",
};

/**
 * Resolve the reviewer for a given review layer.
 *
 * @returns The reviewer role name, or null if the layer should be skipped.
 */
export function resolveReviewerForLayer(
  layer: ReviewLayer,
  task: Task,
  agents: AgentInfo[]
): string | null {
  switch (layer) {
    case "self":
      return task.assignee || null;

    case "peer": {
      // Find another agent in the same department, excluding the assignee
      const dept = task.department?.toLowerCase();
      if (!dept) return null;
      const peers = agents.filter(
        (a) =>
          a.department.toLowerCase() === dept &&
          a.role !== task.assignee &&
          a.role !== "ceo"
      );
      return peers.length > 0 ? peers[0].role : null;
    }

    case "department_head": {
      const dept = task.department?.toLowerCase();
      if (!dept) return null;
      return DEPARTMENT_HEADS[dept] ?? null;
    }

    case "csuite":
      return "ceo";

    case "owner":
      return "human-founder";

    default:
      return null;
  }
}

// ── Chain restart marker ─────────────────────────────────────────────

/** Marker content written when a review chain starts/restarts. */
export const CHAIN_START_MARKER = "Review chain started";

// ── Chain State Tracking ────────────────────────────────────────────

/**
 * Derive the review chain state from a task's existing comments.
 * Only counts approvals after the most recent chain start marker,
 * so rejection/re-submission cycles don't carry over stale approvals.
 */
export function getReviewChainState(
  task: Task,
  tasksConfig: TasksConfigWithOverrides,
  agents: AgentInfo[],
  comments?: TaskComment[]
): ReviewChainState {
  const { chain, chainType } = resolveReviewChain(task, tasksConfig);

  // Find the most recent chain start marker to scope approval counting
  const allComments = comments || [];
  let startIndex = 0;
  for (let i = allComments.length - 1; i >= 0; i--) {
    if (
      allComments[i].comment_type === "review_request" &&
      allComments[i].content.startsWith(CHAIN_START_MARKER)
    ) {
      startIndex = i;
      break;
    }
  }

  // Count approvals only from comments after the last chain start
  const relevantComments = allComments.slice(startIndex);
  const approvals = relevantComments.filter(
    (c) =>
      c.comment_type === "review_result" &&
      c.content.toLowerCase().startsWith("approved")
  ).length;

  let currentIndex = Math.min(approvals, chain.length);
  const isComplete = currentIndex >= chain.length;

  // Resolve current reviewer, skipping unavailable peer layers
  let currentReviewer: string | null = null;
  if (!isComplete) {
    while (currentIndex < chain.length) {
      currentReviewer = resolveReviewerForLayer(
        chain[currentIndex],
        task,
        agents
      );
      if (currentReviewer !== null) break;
      // Skip this layer (no available reviewer — typically peer in solo dept)
      currentIndex++;
    }
  }

  const effectiveComplete = isComplete || currentIndex >= chain.length;

  return {
    chain,
    currentLayerIndex: currentIndex,
    completedLayers: chain.slice(0, currentIndex),
    remainingLayers: chain.slice(currentIndex),
    currentReviewer,
    chainType,
    isComplete: effectiveComplete,
  };
}

// ── Chain Advancement ───────────────────────────────────────────────

/**
 * Advance a review chain: on approve, move to next layer/reviewer.
 * On reject, return to in_progress with feedback comment.
 * On chain complete, mark task as done.
 *
 * @returns Updated task or null if task not found.
 */
export function advanceReviewChain(
  tm: TaskManager,
  task: Task,
  approved: boolean,
  tasksConfig: TasksConfigWithOverrides,
  agents: AgentInfo[],
  feedback?: string
): Task | null {
  if (!approved) {
    // Rejection: back to in_progress with feedback
    const updated = tm.updateTask(task.id, { status: "in_progress" });
    if (updated && feedback) {
      tm.addComment(
        task.id,
        task.reviewer || "system",
        `Rejected: ${feedback}`,
        "review_result"
      );
    } else if (updated) {
      tm.addComment(
        task.id,
        task.reviewer || "system",
        "Rejected: needs revision",
        "review_result"
      );
    }
    return updated;
  }

  // Approval: record it
  tm.addComment(
    task.id,
    task.reviewer || "system",
    "Approved",
    "review_result"
  );

  // Re-derive state after approval
  const comments = tm.getComments(task.id);
  const state = getReviewChainState(task, tasksConfig, agents, comments);

  if (state.isComplete) {
    // Chain complete — mark task as done
    return tm.updateTask(task.id, { status: "done", reviewer: null });
  }

  // Find next reviewer (skip layers with no available reviewer)
  let nextReviewer: string | null = null;
  let layerIdx = state.currentLayerIndex;
  while (layerIdx < state.chain.length) {
    nextReviewer = resolveReviewerForLayer(
      state.chain[layerIdx],
      task,
      agents
    );
    if (nextReviewer !== null) break;
    // Skip this layer — log as informational comment (not review_result,
    // so it doesn't inflate the approval count used by getReviewChainState)
    tm.addComment(
      task.id,
      "system",
      `Skipped ${state.chain[layerIdx]} review layer (no available reviewer)`,
      "comment"
    );
    layerIdx++;
  }

  if (!nextReviewer) {
    // No more reviewers available — chain complete
    return tm.updateTask(task.id, { status: "done", reviewer: null });
  }

  // Set next reviewer
  tm.updateTask(task.id, { reviewer: nextReviewer });
  tm.addComment(
    task.id,
    "system",
    `Review requested from ${nextReviewer} (${state.chain[layerIdx]} layer)`,
    "review_request"
  );

  return tm.getTask(task.id);
}

// ── Context Formatting ──────────────────────────────────────────────

/**
 * Format review chain configuration as prompt text for the CEO system prompt.
 */
export function formatReviewChainContext(
  tasksConfig: TasksConfigWithOverrides,
  inReviewTasks?: Array<{ task: Task; state: ReviewChainState }>
): string {
  const chains = tasksConfig.default_review_chains || {};
  const overrides = tasksConfig.review_chain_overrides || {};

  const lines: string[] = [
    "## Review Chain Policy",
    "",
    "Each task type follows a defined review chain. Layers are processed in order:",
    "",
  ];

  // Show default chains
  for (const [type, chain] of Object.entries(chains)) {
    lines.push(`- **${type}:** ${(chain as ReviewLayer[]).join(" → ")}`);
  }

  // Show overrides if any
  const overrideKeys = Object.keys(overrides);
  if (overrideKeys.length > 0) {
    lines.push("");
    lines.push("**Department overrides:**");
    for (const dept of overrideKeys) {
      for (const [type, chain] of Object.entries(overrides[dept])) {
        lines.push(
          `- ${dept}/${type}: ${(chain as ReviewLayer[]).join(" → ")}`
        );
      }
    }
  }

  // Show in-review tasks
  if (inReviewTasks && inReviewTasks.length > 0) {
    lines.push("");
    lines.push("**Tasks currently in review:**");
    for (const { task, state } of inReviewTasks) {
      const progress = `${state.completedLayers.length}/${state.chain.length}`;
      const currentLayer =
        state.remainingLayers.length > 0 ? state.remainingLayers[0] : "done";
      lines.push(
        `- #${task.id} "${task.title}" — ${state.chainType} chain, layer ${progress} (${currentLayer}), reviewer: ${state.currentReviewer || "pending"}`
      );
    }
  }

  lines.push("");
  lines.push(
    "Use REVIEW::SUBMIT, REVIEW::APPROVE, and REVIEW::REJECT markers to manage review chains."
  );

  return lines.join("\n");
}

// ── Validation helpers (for task-register.ts) ───────────────────────

/**
 * Validate `review_chain_overrides` structure.
 * Called from task-register.ts validation.
 */
export function validateReviewChainOverrides(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return errors;

  const obj = raw as Record<string, unknown>;
  const validLayers = new Set(VALID_REVIEW_LAYERS);

  for (const [dept, deptOverrides] of Object.entries(obj)) {
    if (!deptOverrides || typeof deptOverrides !== "object") {
      errors.push(
        `tasks.review_chain_overrides.${dept} must be an object`
      );
      continue;
    }

    const overridesMap = deptOverrides as Record<string, unknown>;
    for (const [type, chain] of Object.entries(overridesMap)) {
      if (!Array.isArray(chain)) {
        errors.push(
          `tasks.review_chain_overrides.${dept}.${type} must be an array`
        );
      } else {
        for (const layer of chain) {
          if (!validLayers.has(layer as ReviewLayer)) {
            errors.push(
              `tasks.review_chain_overrides.${dept}.${type} contains invalid layer "${layer}". Valid: ${VALID_REVIEW_LAYERS.join(", ")}`
            );
          }
        }
      }
    }
  }

  return errors;
}
