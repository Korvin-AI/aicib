/**
 * CLI commands: `aicib safeguards`
 *
 * Dashboard showing category rules, pending actions, approval/rejection,
 * and action history for the external safeguards system.
 */

import path from "node:path";
import Database from "better-sqlite3";
import fs from "node:fs";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import {
  SAFEGUARDS_CONFIG_DEFAULTS,
  VALID_ACTION_CATEGORIES,
  resolveCategoryRule,
  type SafeguardsConfig,
  type ActionCategory,
  type ResolvedApprovalChainStep,
} from "../core/safeguards.js";
import { recordExternalAction } from "../core/trust-evolution.js";
import { header, createTable } from "./ui.js";

interface SafeguardsOptions {
  dir: string;
  reason?: string;
}

function openDb(projectDir: string): Database.Database {
  // Ensure tables exist by creating CostTracker (which initializes registered tables)
  const ct = new CostTracker(projectDir);
  ct.close();

  const db = new Database(path.join(projectDir, ".aicib", "state.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

/**
 * `aicib safeguards` — Dashboard: show all 7 category rules + pending count.
 */
export async function safeguardsCommand(
  options: SafeguardsOptions
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

  const safeguardsConfig = (config.extensions?.safeguards as
    | SafeguardsConfig
    | undefined) ?? SAFEGUARDS_CONFIG_DEFAULTS;

  console.log(header("External Safeguards"));

  // Status overview
  const statusTable = createTable(["Setting", "Value"], [30, 40]);
  statusTable.push(
    [
      "Enabled",
      safeguardsConfig.enabled ? chalk.green("yes") : chalk.red("no"),
    ],
    ["Action Expiry (hours)", String(safeguardsConfig.action_expiry_hours)],
    [
      "Max Pending Per Agent",
      String(safeguardsConfig.max_pending_per_agent),
    ]
  );
  console.log(statusTable.toString());

  // Category rules table
  console.log(chalk.bold("\n  Category Rules:\n"));
  const rulesTable = createTable(
    ["Category", "Approval Chain", "Auto-Execute"],
    [24, 36, 14]
  );

  let pendingCounts: Record<string, number> = {};
  let db: Database.Database | undefined;
  try {
    const dbPath = path.join(projectDir, ".aicib", "state.db");
    if (fs.existsSync(dbPath)) {
      db = openDb(projectDir);

      // Expire old actions first (matching pattern in other commands)
      db.prepare(
        `UPDATE safeguard_pending
         SET status = 'expired', resolved_at = datetime('now')
         WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
      ).run();

      const rows = db
        .prepare(
          `SELECT category, COUNT(*) as cnt FROM safeguard_pending
           WHERE status = 'pending' AND (expires_at IS NULL OR expires_at > datetime('now'))
           GROUP BY category`
        )
        .all() as Array<{ category: string; cnt: number }>;
      for (const row of rows) {
        pendingCounts[row.category] = row.cnt;
      }
    }
  } catch {
    // best-effort
  } finally {
    db?.close();
  }

  for (const cat of VALID_ACTION_CATEGORIES) {
    const rule = resolveCategoryRule(cat, safeguardsConfig);
    const chainStr = rule.approval_chain
      .map((s) => s.role + (s.qualifier ? ` (${s.qualifier})` : ""))
      .join(chalk.dim(" -> "));
    const pending = pendingCounts[cat];
    const catDisplay = pending
      ? `${cat} ${chalk.yellow(`(${pending} pending)`)}`
      : cat;
    rulesTable.push([
      catDisplay,
      chainStr,
      rule.auto_execute ? chalk.green("yes") : chalk.dim("no"),
    ]);
  }

  console.log(rulesTable.toString());

  console.log(
    chalk.dim(
      "\n  Use `aicib safeguards pending` to see pending actions.\n"
    )
  );
}

/**
 * `aicib safeguards pending` — List pending actions awaiting approval.
 */
export async function safeguardsPendingCommand(
  options: SafeguardsOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Pending Safeguard Actions"));

  let db: Database.Database | undefined;
  try {
    db = openDb(projectDir);
    // Expire old actions first
    db.prepare(
      `UPDATE safeguard_pending
       SET status = 'expired', resolved_at = datetime('now')
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
    ).run();

    const rows = db
      .prepare(
        `SELECT id, agent_role, category, description, current_step, approval_chain, status, created_at, expires_at
         FROM safeguard_pending
         WHERE status = 'pending'
         AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY created_at DESC`
      )
      .all() as Array<{
      id: number;
      agent_role: string;
      category: string;
      description: string;
      current_step: number;
      approval_chain: string;
      status: string;
      created_at: string;
      expires_at: string | null;
    }>;

    if (rows.length === 0) {
      console.log(chalk.dim("  No pending actions.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Agent", "Category", "Description", "Step", "Awaiting"],
      [6, 14, 20, 24, 8, 14]
    );

    for (const row of rows) {
      let chain: ResolvedApprovalChainStep[] = [];
      try {
        const parsed = JSON.parse(row.approval_chain);
        if (Array.isArray(parsed)) {
          chain = parsed as ResolvedApprovalChainStep[];
        }
      } catch {
        // Parse error - use empty chain
      }
      const current = row.current_step;
      const total = chain.length;
      const awaiting =
        current < total ? chain[current].role : "complete";
      const desc =
        row.description.length > 22
          ? row.description.slice(0, 20) + ".."
          : row.description;

      table.push([
        `#${row.id}`,
        row.agent_role,
        row.category,
        desc,
        `${current + 1}/${total}`,
        awaiting,
      ]);
    }

    console.log(table.toString());
    console.log(
      chalk.dim(
        "\n  Use `aicib safeguards approve <id>` or `aicib safeguards reject <id>`.\n"
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
 * `aicib safeguards approve <id>` — Approve a pending action (advances chain or completes).
 */
export async function safeguardsApproveCommand(
  id: string,
  options: SafeguardsOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);
  const actionId = parseInt(id, 10);
  if (Number.isNaN(actionId)) {
    console.error(chalk.red("  Invalid action ID."));
    process.exit(1);
  }

  let db: Database.Database | undefined;
  try {
    db = openDb(projectDir);

    // Expire old actions first
    db.prepare(
      `UPDATE safeguard_pending 
       SET status = 'expired', resolved_at = datetime('now')
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
    ).run();

    const row = db
      .prepare(
        `SELECT * FROM safeguard_pending 
         WHERE id = ? AND status = 'pending' 
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
      )
      .get(actionId) as
      | {
          id: number;
          agent_role: string;
          category: string;
          description: string;
          current_step: number;
          approval_chain: string;
          approvals: string;
        }
      | undefined;

    if (!row) {
      console.error(
        chalk.red(`  Action #${actionId} not found, not pending, or expired.`)
      );
      process.exit(1);
    }

    if (!VALID_ACTION_CATEGORIES.includes(row.category as ActionCategory)) {
      console.error(chalk.red(`  Invalid category: ${row.category}`));
      process.exit(1);
    }

    let chain: ResolvedApprovalChainStep[] = [];
    try {
      const parsed = JSON.parse(row.approval_chain);
      if (Array.isArray(parsed)) {
        chain = parsed as ResolvedApprovalChainStep[];
      }
    } catch (e) {
      console.error(
        chalk.red(`  Failed to parse approval chain: ${e instanceof Error ? e.message : String(e)}`)
      );
      process.exit(1);
    }

    let approvals: Array<{ role: string; approved_at: string }> = [];
    try {
      approvals = JSON.parse(row.approvals);
    } catch {
      // ignore
    }

    approvals.push({
      role: "cli",
      approved_at: new Date().toISOString(),
    });

    const nextStep = row.current_step + 1;

    if (nextStep >= chain.length) {
      // Fully approved
      db.prepare(
        `UPDATE safeguard_pending
         SET status = 'approved', current_step = ?, approvals = ?, resolved_at = datetime('now')
         WHERE id = ?`
      ).run(nextStep, JSON.stringify(approvals), actionId);

      recordExternalAction(
        db,
        row.agent_role,
        row.category,
        row.description,
        "approved",
        "cli"
      );

      console.log(
        chalk.green(
          `  Action #${actionId} fully approved (${row.category}).`
        )
      );
    } else {
      // Advanced to next step
      db.prepare(
        `UPDATE safeguard_pending SET current_step = ?, approvals = ? WHERE id = ?`
      ).run(nextStep, JSON.stringify(approvals), actionId);

      const nextRole = chain[nextStep]?.role || "unknown";
      console.log(
        chalk.cyan(
          `  Action #${actionId} advanced to step ${nextStep + 1}/${chain.length} (awaiting: ${nextRole}).`
        )
      );
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
}

/**
 * `aicib safeguards reject <id>` — Reject a pending action.
 */
export async function safeguardsRejectCommand(
  id: string,
  options: SafeguardsOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);
  const actionId = parseInt(id, 10);
  if (Number.isNaN(actionId)) {
    console.error(chalk.red("  Invalid action ID."));
    process.exit(1);
  }

  let db: Database.Database | undefined;
  try {
    db = openDb(projectDir);

    // Expire old actions first
    db.prepare(
      `UPDATE safeguard_pending 
       SET status = 'expired', resolved_at = datetime('now')
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
    ).run();

    const row = db
      .prepare(
        `SELECT * FROM safeguard_pending 
         WHERE id = ? AND status = 'pending' 
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
      )
      .get(actionId) as
      | {
          id: number;
          agent_role: string;
          category: string;
          description: string;
        }
      | undefined;

    if (!row) {
      console.error(
        chalk.red(`  Action #${actionId} not found, not pending, or expired.`)
      );
      process.exit(1);
    }

    if (!VALID_ACTION_CATEGORIES.includes(row.category as ActionCategory)) {
      console.error(chalk.red(`  Invalid category: ${row.category}`));
      process.exit(1);
    }

    const rejection = JSON.stringify({
      rejected_by: "cli",
      reason: options.reason || "",
      rejected_at: new Date().toISOString(),
    });

    db.prepare(
      `UPDATE safeguard_pending
       SET status = 'rejected', rejection = ?, resolved_at = datetime('now')
       WHERE id = ?`
    ).run(rejection, actionId);

    recordExternalAction(
      db,
      row.agent_role,
      row.category,
      row.description,
      "rejected",
      undefined,
      "cli",
      options.reason || ""
    );

    console.log(
      chalk.red(`  Action #${actionId} rejected (${row.category}).`)
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
 * `aicib safeguards history` — Show resolved action history.
 */
export async function safeguardsHistoryCommand(
  options: SafeguardsOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Safeguard Action History"));

  let db: Database.Database | undefined;
  try {
    db = openDb(projectDir);
    const rows = db
      .prepare(
        `SELECT id, agent_role, category, description, outcome, approved_by, rejected_by, rejection_reason, created_at, resolved_at
         FROM external_actions
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all() as Array<{
      id: number;
      agent_role: string;
      category: string;
      description: string;
      outcome: string;
      approved_by: string | null;
      rejected_by: string | null;
      rejection_reason: string | null;
      created_at: string;
      resolved_at: string | null;
    }>;

    if (rows.length === 0) {
      console.log(chalk.dim("  No action history yet.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Agent", "Category", "Outcome", "By", "Date"],
      [6, 14, 20, 14, 10, 20]
    );

    for (const row of rows) {
      const outcomeColor =
        row.outcome === "approved"
          ? chalk.green
          : row.outcome === "rejected"
            ? chalk.red
            : chalk.yellow;
      const by = row.approved_by || row.rejected_by || "--";

      table.push([
        `#${row.id}`,
        row.agent_role,
        row.category,
        outcomeColor(row.outcome),
        by,
        row.created_at?.slice(0, 16) || "--",
      ]);
    }

    console.log(table.toString());
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
