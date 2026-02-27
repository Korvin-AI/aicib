/**
 * CLI command: `aicib reviews`
 *
 * Displays all configured review chains (default + overrides),
 * tasks currently in review with chain progress (layer/reviewer),
 * and a tip pointing to `aicib tasks review` for interactive approval.
 */

import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import {
  TaskManager,
  TASKS_CONFIG_DEFAULTS,
  type ReviewLayer,
} from "../core/task-manager.js";
import { loadAgentDefinitions } from "../core/agents.js";
import { getAgentsDir } from "../core/team.js";
import {
  getReviewChainState,
  type TasksConfigWithOverrides,
} from "../core/review-chains.js";
import { header, createTable, agentColor } from "./ui.js";

interface ReviewsOptions {
  dir: string;
}

export async function reviewsCommand(options: ReviewsOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);
  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  const tasksConfig = (config.extensions?.tasks as TasksConfigWithOverrides | undefined) ?? {
    ...TASKS_CONFIG_DEFAULTS,
    review_chain_overrides: {},
  };

  // Ensure overrides field exists
  const effectiveConfig: TasksConfigWithOverrides = {
    ...tasksConfig,
    review_chain_overrides: tasksConfig.review_chain_overrides || {},
  };

  console.log(header("Review Chains"));

  // Default chains table
  const defaultChains = effectiveConfig.default_review_chains || {};
  if (Object.keys(defaultChains).length > 0) {
    console.log(chalk.bold("  Default Review Chains:\n"));
    const chainsTable = createTable(
      ["Type", "Review Layers"],
      [25, 50]
    );
    for (const [type, chain] of Object.entries(defaultChains)) {
      const layers = (chain as ReviewLayer[])
        .map((l) => chalk.cyan(l))
        .join(chalk.dim(" → "));
      chainsTable.push([type, layers]);
    }
    console.log(chainsTable.toString());
  }

  // Override chains
  const overrides = effectiveConfig.review_chain_overrides;
  const overrideKeys = Object.keys(overrides);
  if (overrideKeys.length > 0) {
    console.log(chalk.bold("\n  Department Overrides:\n"));
    const overrideTable = createTable(
      ["Department", "Type", "Review Layers"],
      [18, 22, 35]
    );
    for (const dept of overrideKeys) {
      for (const [type, chain] of Object.entries(overrides[dept])) {
        const layers = (chain as ReviewLayer[])
          .map((l) => chalk.cyan(l))
          .join(chalk.dim(" → "));
        overrideTable.push([dept, type, layers]);
      }
    }
    console.log(overrideTable.toString());
  }

  // In-review tasks with chain progress
  let tm: TaskManager | undefined;
  try {
    tm = new TaskManager(projectDir);
    const inReviewTasks = tm.listTasks({ status: "in_review" });

    // Load agents for reviewer resolution
    let agents: Array<{ role: string; department: string }> = [];
    try {
      const agentsDir = getAgentsDir(projectDir);
      const agentDefs = loadAgentDefinitions(agentsDir);
      agents = Array.from(agentDefs.entries()).map(([role, def]) => ({
        role,
        department: def.frontmatter.department || "",
      }));
    } catch {
      // Best-effort
    }

    if (inReviewTasks.length > 0) {
      console.log(chalk.bold("\n  Tasks In Review:\n"));
      const reviewTable = createTable(
        ["ID", "Title", "Chain", "Progress", "Reviewer"],
        [6, 28, 18, 12, 14]
      );

      for (const task of inReviewTasks) {
        const comments = tm.getComments(task.id);
        const state = getReviewChainState(
          task,
          effectiveConfig,
          agents,
          comments
        );

        const progress = `${state.completedLayers.length}/${state.chain.length}`;
        const currentLayer =
          state.remainingLayers.length > 0
            ? state.remainingLayers[0]
            : "done";
        const reviewer = state.currentReviewer || task.reviewer || "--";

        reviewTable.push([
          `#${task.id}`,
          task.title.length > 26
            ? task.title.slice(0, 24) + ".."
            : task.title,
          `${state.chainType} (${currentLayer})`,
          progress,
          reviewer !== "--"
            ? agentColor(reviewer)(reviewer)
            : chalk.dim("--"),
        ]);
      }

      console.log(reviewTable.toString());
    } else {
      console.log(chalk.dim("\n  No tasks currently in review.\n"));
    }
  } catch {
    console.log(
      chalk.dim("\n  Task system not initialized — run `aicib init` first.\n")
    );
  } finally {
    tm?.close();
  }

  // Tip
  console.log(
    chalk.dim(
      "  Tip: Use `aicib tasks review` for interactive task approval.\n"
    )
  );
}
