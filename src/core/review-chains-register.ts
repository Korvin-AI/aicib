/**
 * Hook registration for the Review Chain system (#39).
 *
 * Importing this module (side-effect import) registers:
 * - Context provider: review-chains (injects review chain table into CEO prompt)
 * - Message handler: review-chain-actions (detects REVIEW:: markers)
 *
 * No config extension needed — uses existing `tasks:` key.
 * Validation for `review_chain_overrides` is added to task-register.ts.
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerContextProvider, registerMessageHandler } from "./agent-runner.js";
import {
  TaskManager,
  TASKS_CONFIG_DEFAULTS,
} from "./task-manager.js";
import {
  resolveReviewChain,
  resolveReviewerForLayer,
  getReviewChainState,
  advanceReviewChain,
  formatReviewChainContext,
  CHAIN_START_MARKER,
  type TasksConfigWithOverrides,
} from "./review-chains.js";
import { loadAgentDefinitions } from "./agents.js";
import { getAgentsDir } from "./team.js";

// Module-level projectDir set by the context provider, read by the message handler.
let lastProjectDir: string | null = null;
// Cached config from the last message handler invocation
let lastTasksConfig: TasksConfigWithOverrides | null = null;

// ============================================
// CONTEXT PROVIDER
// ============================================

registerContextProvider("review-chains", async (config, projectDir) => {
  lastProjectDir = projectDir;

  const tasksConfig = config.extensions?.tasks as
    | TasksConfigWithOverrides
    | undefined;
  if (tasksConfig && !tasksConfig.enabled) return "";

  // Build effective config with overrides
  const effectiveConfig: TasksConfigWithOverrides = {
    ...(tasksConfig || {
      enabled: true,
      max_context_tasks: 15,
      deadline_urgency_hours: 24,
      default_review_chains: {},
    }),
    review_chain_overrides: tasksConfig?.review_chain_overrides || {},
  };

  if (Object.keys(effectiveConfig.default_review_chains).length === 0) {
    return "";
  }

  // Get in-review tasks to show chain progress
  let tm: TaskManager | undefined;
  try {
    tm = new TaskManager(projectDir);
    const inReviewTasks = tm.listTasks({ status: "in_review" });

    let agents: Array<{ role: string; department: string }> = [];
    try {
      const agentsDir = getAgentsDir(projectDir);
      const agentDefs = loadAgentDefinitions(agentsDir);
      agents = Array.from(agentDefs.entries()).map(([role, def]) => ({
        role,
        department: def.frontmatter.department || "",
      }));
    } catch {
      // Agents not loaded — skip agent-aware features
    }

    const tasksWithState = inReviewTasks.map((task) => {
      const comments = tm!.getComments(task.id);
      return {
        task,
        state: getReviewChainState(task, effectiveConfig, agents, comments),
      };
    });

    return formatReviewChainContext(effectiveConfig, tasksWithState);
  } catch {
    // Task system not initialized yet — show chain config only
    return formatReviewChainContext(effectiveConfig);
  } finally {
    tm?.close();
  }
});

// ============================================
// MESSAGE HANDLER (Debounced Queue)
// ============================================

interface PendingReviewAction {
  type: "submit" | "approve" | "reject";
  data: Record<string, string>;
}

let pendingActions: PendingReviewAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAction(
  action: PendingReviewAction,
  projectDir: string
): void {
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

  // Deduplicate: keep only the first action per (task_id, type) per batch
  const seen = new Set<string>();
  const dedupedActions = actions.filter((a) => {
    const key = `${a.data.task_id}:${a.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let tm: TaskManager | undefined;
  try {
    tm = new TaskManager(lastProjectDir);

    // Load agents for reviewer resolution
    let agents: Array<{ role: string; department: string }> = [];
    try {
      const agentsDir = getAgentsDir(lastProjectDir);
      const agentDefs = loadAgentDefinitions(agentsDir);
      agents = Array.from(agentDefs.entries()).map(([role, def]) => ({
        role,
        department: def.frontmatter.department || "",
      }));
    } catch {
      // Best-effort — proceed without full agent list
    }

    for (const action of dedupedActions) {
      try {
        processReviewAction(tm, action, agents);
      } catch (e) {
        console.warn("Review chain action failed:", e);
      }
    }
  } catch (e) {
    console.warn("Review chain flush DB error:", e);
  } finally {
    tm?.close();
  }
}

function processReviewAction(
  tm: TaskManager,
  action: PendingReviewAction,
  agents: Array<{ role: string; department: string }>
): void {
  // Use cached config from last message handler invocation, or fall back to defaults
  const effectiveConfig: TasksConfigWithOverrides = lastTasksConfig || {
    ...TASKS_CONFIG_DEFAULTS,
    review_chain_overrides: {},
  };

  switch (action.type) {
    case "submit": {
      const taskId = parseInt(action.data.task_id, 10);
      if (Number.isNaN(taskId)) break;

      const task = tm.getTask(taskId);
      if (!task) break;

      // Resolve chain
      const { chain, chainType } = resolveReviewChain(task, effectiveConfig);
      if (chain.length === 0) break;

      // Write chain start marker FIRST — getReviewChainState scopes
      // approval counting from this marker, preventing stale approvals
      // from prior rejection cycles from carrying over.
      tm.addComment(
        taskId,
        "system",
        `${CHAIN_START_MARKER}: ${chainType} (${chain.join(" → ")})`,
        "review_request"
      );

      // Find first reviewer (skip layers with no available reviewer)
      let firstReviewer: string | null = null;
      let layerIdx = 0;
      while (layerIdx < chain.length) {
        firstReviewer = resolveReviewerForLayer(chain[layerIdx], task, agents);
        if (firstReviewer !== null) break;
        // Skip layer with no reviewer
        tm.addComment(
          taskId,
          "system",
          `Skipped ${chain[layerIdx]} review layer (no available reviewer)`,
          "comment"
        );
        layerIdx++;
      }

      if (!firstReviewer) {
        // No reviewer available for any layer — auto-complete
        tm.updateTask(taskId, { status: "done", reviewer: null });
        tm.addComment(taskId, "system", "Review chain auto-completed (no available reviewers)", "comment");
        break;
      }

      // Update task status
      tm.updateTask(taskId, {
        status: "in_review",
        reviewer: firstReviewer,
      });
      if (firstReviewer) {
        tm.addComment(
          taskId,
          "system",
          `Review requested from ${firstReviewer} (${chain[layerIdx]} layer)`,
          "review_request"
        );
      }
      break;
    }

    case "approve": {
      const taskId = parseInt(action.data.task_id, 10);
      if (Number.isNaN(taskId)) break;

      const task = tm.getTask(taskId);
      if (!task || task.status !== "in_review") break;

      advanceReviewChain(tm, task, true, effectiveConfig, agents);
      break;
    }

    case "reject": {
      const taskId = parseInt(action.data.task_id, 10);
      if (Number.isNaN(taskId)) break;

      const task = tm.getTask(taskId);
      if (!task || task.status !== "in_review") break;

      const feedback = action.data.feedback || undefined;
      advanceReviewChain(tm, task, false, effectiveConfig, agents, feedback);
      break;
    }
  }
}

registerMessageHandler("review-chain-actions", (msg, config) => {
  const tasksConfig = config.extensions?.tasks as
    | TasksConfigWithOverrides
    | undefined;
  if (tasksConfig && !tasksConfig.enabled) return;

  // Cache config for the flush callback (which doesn't have config access)
  if (tasksConfig) {
    lastTasksConfig = {
      ...tasksConfig,
      review_chain_overrides: tasksConfig.review_chain_overrides || {},
    };
  }

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

  // Parse structured REVIEW:: markers
  const submitMatches = text.matchAll(
    /REVIEW::SUBMIT\s+task_id=(\d+)(?:\s+chain_type=(\S+))?/g
  );
  for (const match of submitMatches) {
    queueAction(
      {
        type: "submit",
        data: {
          task_id: match[1],
          chain_type: match[2] || "",
        },
      },
      lastProjectDir
    );
  }

  const approveMatches = text.matchAll(
    /REVIEW::APPROVE\s+task_id=(\d+)/g
  );
  for (const match of approveMatches) {
    queueAction(
      {
        type: "approve",
        data: { task_id: match[1] },
      },
      lastProjectDir
    );
  }

  const rejectMatches = text.matchAll(
    /REVIEW::REJECT\s+task_id=(\d+)(?:\s+feedback="([^"]*)")?/g
  );
  for (const match of rejectMatches) {
    queueAction(
      {
        type: "reject",
        data: {
          task_id: match[1],
          feedback: match[2] || "",
        },
      },
      lastProjectDir
    );
  }

  // Natural language fallback patterns
  const selfReviewMatches = text.matchAll(
    /self[- ]review complete (?:for )?task\s+#(\d+)/gi
  );
  for (const match of selfReviewMatches) {
    queueAction(
      {
        type: "approve",
        data: { task_id: match[1] },
      },
      lastProjectDir
    );
  }

  const approvedNlMatches = text.matchAll(
    /approved task\s+#(\d+)/gi
  );
  for (const match of approvedNlMatches) {
    queueAction(
      {
        type: "approve",
        data: { task_id: match[1] },
      },
      lastProjectDir
    );
  }

  const rejectedNlMatches = text.matchAll(
    /needs revision on task\s+#(\d+)/gi
  );
  for (const match of rejectedNlMatches) {
    queueAction(
      {
        type: "reject",
        data: {
          task_id: match[1],
          feedback: "Needs revision",
        },
      },
      lastProjectDir
    );
  }
});
