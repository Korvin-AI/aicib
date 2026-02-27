/**
 * CLI commands: `aicib trust`
 *
 * Dashboard showing agent trust levels, action history,
 * upgrade recommendations, and manual trust level overrides.
 */

import path from "node:path";
import Database from "better-sqlite3";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import {
  TRUST_CONFIG_DEFAULTS,
  VALID_TRUST_LEVELS,
  TRUST_LEVEL_THRESHOLDS,
  computeTrustScore,
  computeAgentTrustScores,
  getTrustRecommendations,
  type TrustConfig,
  type TrustLevel,
} from "../core/trust-evolution.js";
import { VALID_ACTION_CATEGORIES, type ActionCategory } from "../core/safeguards.js";
import { loadAgentDefinitions } from "../core/agents.js";
import { getAgentsDir } from "../core/team.js";
import { header, createTable, agentColor } from "./ui.js";

interface TrustOptions {
  dir: string;
  category?: string;
}

function openDb(projectDir: string): Database.Database {
  // Ensure tables exist
  const ct = new CostTracker(projectDir);
  ct.close();

  const db = new Database(path.join(projectDir, ".aicib", "state.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

/**
 * `aicib trust` — Dashboard: agents x categories showing trust levels.
 */
export async function trustCommand(options: TrustOptions): Promise<void> {
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

  const trustConfig = (config.extensions?.trust as
    | TrustConfig
    | undefined) ?? TRUST_CONFIG_DEFAULTS;

  console.log(header("Trust Evolution"));

  // Status overview
  const statusTable = createTable(["Setting", "Value"], [25, 40]);
  statusTable.push(
    [
      "Enabled",
      trustConfig.enabled ? chalk.green("yes") : chalk.red("no"),
    ],
    ["Max Level", chalk.cyan(trustConfig.max_level)],
    [
      "Auto Recommend",
      trustConfig.auto_recommend ? chalk.green("yes") : chalk.dim("no"),
    ]
  );
  console.log(statusTable.toString());

  // Threshold reference
  console.log(chalk.bold("\n  Trust Level Thresholds:\n"));
  const threshTable = createTable(
    ["Level", "Min Actions", "Min Approval %", "Min Age (days)"],
    [16, 14, 16, 16]
  );
  for (const level of VALID_TRUST_LEVELS) {
    const t = TRUST_LEVEL_THRESHOLDS[level];
    threshTable.push([
      level,
      String(t.min_actions),
      `${t.min_approval_rate}%`,
      String(t.min_age_days),
    ]);
  }
  console.log(threshTable.toString());

  // Agent trust scores
  let db: Database.Database | undefined;
  try {
    db = openDb(projectDir);

    // Get all agents with history
    const agentRows = db
      .prepare(`SELECT DISTINCT agent_role FROM external_actions`)
      .all() as Array<{ agent_role: string }>;

    if (agentRows.length > 0) {
      console.log(chalk.bold("\n  Agent Trust Levels:\n"));
      const trustTable = createTable(
        ["Agent", "Category", "Level", "Actions", "Approved", "Rate", "Age (d)", "Next Level"],
        [14, 20, 14, 9, 9, 8, 9, 14]
      );

      for (const agentRow of agentRows) {
        const scores = computeAgentTrustScores(db, agentRow.agent_role);
        for (const [category, score] of Object.entries(scores)) {
          const levelColor =
            score.current_level === "veteran"
              ? chalk.green
              : score.current_level === "trusted"
                ? chalk.cyan
                : score.current_level === "established"
                  ? chalk.yellow
                  : chalk.dim;

          trustTable.push([
            agentColor(agentRow.agent_role)(agentRow.agent_role),
            category,
            levelColor(score.current_level),
            String(score.total_actions),
            String(score.approved_count),
            `${score.approval_rate}%`,
            String(score.age_days),
            score.next_level || chalk.dim("--"),
          ]);
        }
      }

      console.log(trustTable.toString());
    } else {
      console.log(
        chalk.dim("\n  No external action history yet.\n")
      );
    }

    // Overrides
    const overrideKeys = Object.keys(trustConfig.overrides);
    if (overrideKeys.length > 0) {
      console.log(chalk.bold("\n  Manual Overrides:\n"));
      const overrideTable = createTable(
        ["Agent", "Category", "Override Level"],
        [18, 22, 18]
      );
      for (const agent of overrideKeys) {
        for (const [cat, level] of Object.entries(trustConfig.overrides[agent])) {
          overrideTable.push([agent, cat, chalk.cyan(level)]);
        }
      }
      console.log(overrideTable.toString());
    }
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  } finally {
    db?.close();
  }

  console.log(
    chalk.dim(
      "\n  Use `aicib trust recommendations` to see upgrade suggestions.\n"
    )
  );
}

/**
 * `aicib trust history <agent>` — Detailed action history for an agent.
 */
export async function trustHistoryCommand(
  agent: string,
  options: TrustOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header(`Trust History: ${agent}`));

  let db: Database.Database | undefined;
  try {
    db = openDb(projectDir);

    let query = `SELECT id, agent_role, category, description, outcome, approved_by, rejected_by, rejection_reason, created_at
                 FROM external_actions
                 WHERE agent_role = ?`;
    const params: string[] = [agent];

    if (options.category) {
      query += ` AND category = ?`;
      params.push(options.category);
    }

    query += ` ORDER BY created_at DESC LIMIT 50`;

    const rows = db.prepare(query).all(...params) as Array<{
      id: number;
      agent_role: string;
      category: string;
      description: string;
      outcome: string;
      approved_by: string | null;
      rejected_by: string | null;
      rejection_reason: string | null;
      created_at: string;
    }>;

    if (rows.length === 0) {
      console.log(chalk.dim(`  No action history for ${agent}.\n`));
      return;
    }

    const table = createTable(
      ["ID", "Category", "Outcome", "Description", "By", "Date"],
      [6, 18, 12, 22, 10, 18]
    );

    for (const row of rows) {
      const outcomeColor =
        row.outcome === "approved"
          ? chalk.green
          : row.outcome === "rejected"
            ? chalk.red
            : chalk.yellow;
      const by = row.approved_by || row.rejected_by || "--";
      const desc =
        row.description.length > 20
          ? row.description.slice(0, 18) + ".."
          : row.description;

      table.push([
        `#${row.id}`,
        row.category,
        outcomeColor(row.outcome),
        desc,
        by,
        row.created_at?.slice(0, 16) || "--",
      ]);
    }

    console.log(table.toString());

    // Show trust scores for this agent
    const scores = computeAgentTrustScores(db, agent);
    if (Object.keys(scores).length > 0) {
      console.log(chalk.bold("\n  Trust Scores:\n"));
      for (const [category, score] of Object.entries(scores)) {
        console.log(
          `  ${chalk.cyan(category)}: ${score.current_level} ` +
            `(${score.total_actions} actions, ${score.approval_rate}% approval, ${score.age_days}d)`
        );
      }
    }

    console.log("");
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  } finally {
    db?.close();
  }
}

/**
 * `aicib trust recommendations` — Show agents ready for trust level upgrades.
 */
export async function trustRecommendationsCommand(
  options: TrustOptions
): Promise<void> {
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

  const trustConfig = (config.extensions?.trust as
    | TrustConfig
    | undefined) ?? TRUST_CONFIG_DEFAULTS;

  console.log(header("Trust Upgrade Recommendations"));

  let db: Database.Database | undefined;
  try {
    db = openDb(projectDir);

    const recommendations = getTrustRecommendations(db, trustConfig);

    if (recommendations.length === 0) {
      console.log(
        chalk.dim("  No upgrade recommendations at this time.\n")
      );
      return;
    }

    const table = createTable(
      ["Agent", "Category", "Current", "Recommended", "Actions", "Rate", "Age (d)"],
      [14, 20, 14, 14, 9, 8, 9]
    );

    for (const rec of recommendations) {
      table.push([
        agentColor(rec.agent_role)(rec.agent_role),
        rec.category,
        rec.current_level,
        chalk.green(rec.recommended_level),
        String(rec.score.total_actions),
        `${rec.score.approval_rate}%`,
        String(rec.score.age_days),
      ]);
    }

    console.log(table.toString());
    console.log(
      chalk.dim(
        "\n  Use `aicib trust set <agent> --category <cat> --level <level>` to apply.\n"
      )
    );
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  } finally {
    db?.close();
  }
}

/**
 * `aicib trust set <agent>` — Manually set trust level override.
 */
export async function trustSetCommand(
  agent: string,
  options: TrustOptions & { level?: string; category?: string }
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  if (!options.level) {
    console.error(chalk.red("  --level is required."));
    process.exit(1);
  }

  if (!VALID_TRUST_LEVELS.includes(options.level as TrustLevel)) {
    console.error(
      chalk.red(
        `  Invalid level. Must be one of: ${VALID_TRUST_LEVELS.join(", ")}`
      )
    );
    process.exit(1);
  }

  if (!options.category) {
    console.error(chalk.red("  --category is required."));
    process.exit(1);
  }

  if (!VALID_ACTION_CATEGORIES.includes(options.category as ActionCategory)) {
    console.error(
      chalk.red(
        `  Invalid category: ${options.category}. Must be one of: ${VALID_ACTION_CATEGORIES.join(", ")}`
      )
    );
    process.exit(1);
  }

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

  const trustConfig = (config.extensions?.trust as
    | TrustConfig
    | undefined) ?? { ...TRUST_CONFIG_DEFAULTS };

  // Ensure overrides structure exists
  if (!trustConfig.overrides) trustConfig.overrides = {};
  if (!trustConfig.overrides[agent]) trustConfig.overrides[agent] = {};

  trustConfig.overrides[agent][options.category] =
    options.level as TrustLevel;

  // Save back to config
  config.extensions.trust = trustConfig;
  saveConfig(projectDir, config);

  console.log(
    chalk.green(
      `  Trust override set: ${agent} / ${options.category} = ${options.level}`
    )
  );
}
