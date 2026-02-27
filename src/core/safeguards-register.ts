/**
 * Hook registration for External Safeguards (#14) and Trust Evolution (#38).
 *
 * Importing this module (side-effect import) registers:
 * - Config extensions: `safeguards:` and `trust:` sections
 * - Database tables: safeguard_pending, external_actions
 * - Context providers: external-safeguards, trust-evolution
 * - Message handler: safeguard-actions (detects SAFEGUARD:: markers)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import {
  registerContextProvider,
  registerMessageHandler,
} from "./agent-runner.js";
import {
  SAFEGUARDS_CONFIG_DEFAULTS,
  validateSafeguardsConfig,
  formatSafeguardsContext,
  evaluateSafeguardAction,
  resolveCategoryRule,
  resolveApprover,
  VALID_ACTION_CATEGORIES,
  type SafeguardsConfig,
  type ActionCategory,
  type ResolvedApprovalChainStep,
  type PendingAction,
} from "./safeguards.js";
import {
  TRUST_CONFIG_DEFAULTS,
  validateTrustConfig,
  formatTrustContext,
  resolveTrustLevel,
  recordExternalAction,
  type TrustConfig,
} from "./trust-evolution.js";
import type { AutonomyConfig } from "./autonomy-matrix.js";
import { loadAgentDefinitions } from "./agents.js";
import { getAgentsDir } from "./team.js";

// ============================================
// CONFIG EXTENSIONS
// ============================================

registerConfigExtension({
  key: "safeguards",
  defaults: { ...SAFEGUARDS_CONFIG_DEFAULTS },
  validate: validateSafeguardsConfig,
});

registerConfigExtension({
  key: "trust",
  defaults: { ...TRUST_CONFIG_DEFAULTS },
  validate: validateTrustConfig,
});

// ============================================
// DATABASE TABLES
// ============================================

registerTable({
  name: "safeguard_pending",
  createSQL: `CREATE TABLE IF NOT EXISTS safeguard_pending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_role TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    approval_chain TEXT NOT NULL DEFAULT '[]',
    current_step INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    approvals TEXT NOT NULL DEFAULT '[]',
    rejection TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    expires_at TEXT
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_safeguard_pending_agent ON safeguard_pending(agent_role)",
    "CREATE INDEX IF NOT EXISTS idx_safeguard_pending_status ON safeguard_pending(status)",
    "CREATE INDEX IF NOT EXISTS idx_safeguard_pending_category ON safeguard_pending(category)",
  ],
});

registerTable({
  name: "external_actions",
  createSQL: `CREATE TABLE IF NOT EXISTS external_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_role TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL,
    approved_by TEXT,
    rejected_by TEXT,
    rejection_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_external_actions_agent ON external_actions(agent_role)",
    "CREATE INDEX IF NOT EXISTS idx_external_actions_category ON external_actions(category)",
    "CREATE INDEX IF NOT EXISTS idx_external_actions_outcome ON external_actions(outcome)",
  ],
});

// ============================================
// DB HELPER
// ============================================

function openDb(projectDir: string): Database.Database {
  const dbPath = path.join(projectDir, ".aicib", "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

// ============================================
// CONTEXT PROVIDERS
// ============================================

// Module-level projectDir set by the context provider, read by the message handler.
let lastProjectDir: string | null = null;
let lastSafeguardsConfig: SafeguardsConfig | null = null;
let lastTrustConfig: TrustConfig | null = null;
let lastAutonomyConfig: AutonomyConfig | null = null;

registerContextProvider(
  "external-safeguards",
  async (config, projectDir) => {
    lastProjectDir = projectDir;

    const safeguardsConfig = (config.extensions?.safeguards as
      | SafeguardsConfig
      | undefined) ?? SAFEGUARDS_CONFIG_DEFAULTS;
    lastSafeguardsConfig = safeguardsConfig;

    if (!safeguardsConfig.enabled) return "";

    // Fetch pending actions from DB
    let db: Database.Database | undefined;
    try {
      const dbPath = path.join(projectDir, ".aicib", "state.db");
      if (!fs.existsSync(dbPath)) return formatSafeguardsContext(safeguardsConfig);

      db = openDb(projectDir);
      // Expire old actions first
      db.prepare(
        `UPDATE safeguard_pending 
         SET status = 'expired', resolved_at = datetime('now')
         WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
      ).run();

      const pendingActions = db
        .prepare(
          `SELECT id, agent_role, category, description, current_step, approval_chain, status, created_at
           FROM safeguard_pending
           WHERE status = 'pending'
           AND (expires_at IS NULL OR expires_at > datetime('now'))
           ORDER BY created_at DESC
           LIMIT 20`
        )
        .all() as PendingAction[];

      return formatSafeguardsContext(safeguardsConfig, pendingActions);
    } catch {
      return formatSafeguardsContext(safeguardsConfig);
    } finally {
      db?.close();
    }
  }
);

registerContextProvider(
  "trust-evolution",
  async (config, projectDir) => {
    lastProjectDir = projectDir;

    const trustConfig = (config.extensions?.trust as
      | TrustConfig
      | undefined) ?? TRUST_CONFIG_DEFAULTS;
    lastTrustConfig = trustConfig;

    if (!trustConfig.enabled) return "";

    let db: Database.Database | undefined;
    try {
      const dbPath = path.join(projectDir, ".aicib", "state.db");
      if (!fs.existsSync(dbPath)) return "";

      db = openDb(projectDir);

      // Load agent roles
      let agentRoles: string[] = [];
      try {
        const agentsDir = getAgentsDir(projectDir);
        const agentDefs = loadAgentDefinitions(agentsDir);
        agentRoles = Array.from(agentDefs.keys());
      } catch {
        // No agents loaded — skip
      }

      const autonomyConfig = config.extensions?.autonomy as
        | AutonomyConfig
        | undefined;
      lastAutonomyConfig = autonomyConfig ?? null;

      return formatTrustContext(db, trustConfig, agentRoles, autonomyConfig);
    } catch {
      return "";
    } finally {
      db?.close();
    }
  }
);

// ============================================
// MESSAGE HANDLER (Debounced Queue)
// ============================================

interface PendingSafeguardAction {
  type: "request" | "approve" | "reject";
  data: Record<string, string>;
}

let pendingActions: PendingSafeguardAction[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueAction(
  action: PendingSafeguardAction,
  projectDir: string
): void {
  lastProjectDir = projectDir;
  pendingActions.push(action);
  if (!flushTimer) {
    flushTimer = setTimeout(() => flushPendingActions(), 500);
  }
}

function flushPendingActions(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingActions.length === 0 || !lastProjectDir) return;

  const actions = pendingActions;
  pendingActions = [];

  // Deduplicate: keep only the first action per (id, type) per batch
  const seen = new Set<string>();
  const dedupedActions = actions.filter((a) => {
    const key = `${a.data.id || a.data.category + ":" + a.data.agent}:${a.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Load agent departments for resolveApprover
  let agentDepts = new Map<string, string>();
  try {
    const agentsDir = getAgentsDir(lastProjectDir);
    const agentDefs = loadAgentDefinitions(agentsDir);
    for (const [role, def] of agentDefs) {
      agentDepts.set(role, def.frontmatter.department || "");
    }
  } catch {
    // Best-effort
  }

  let db: Database.Database | undefined;
  try {
    db = openDb(lastProjectDir);

    const safeguardsConfig =
      lastSafeguardsConfig || SAFEGUARDS_CONFIG_DEFAULTS;
    const trustConfig = lastTrustConfig || TRUST_CONFIG_DEFAULTS;

    for (const action of dedupedActions) {
      try {
        processSafeguardAction(
          db,
          action,
          safeguardsConfig,
          trustConfig,
          agentDepts
        );
      } catch (e) {
        console.warn("Safeguard action failed:", e);
      }
    }
  } catch (e) {
    console.warn("Safeguard flush DB error:", e);
  } finally {
    db?.close();
  }
}

function processSafeguardAction(
  db: Database.Database,
  action: PendingSafeguardAction,
  safeguardsConfig: SafeguardsConfig,
  trustConfig: TrustConfig,
  agentDepts: Map<string, string>
): void {
  switch (action.type) {
    case "request": {
      const { category, agent, description } = action.data;
      if (!category || !agent) break;

      if (
        !VALID_ACTION_CATEGORIES.includes(category as ActionCategory)
      )
        break;

      // Expire old pending actions first
      db.prepare(
        `UPDATE safeguard_pending 
         SET status = 'expired', resolved_at = datetime('now')
         WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
      ).run();

      // Check max pending per agent (excluding expired)
      const pendingCount = (
        db
          .prepare(
            `SELECT COUNT(*) as cnt FROM safeguard_pending 
             WHERE agent_role = ? AND status = 'pending' 
             AND (expires_at IS NULL OR expires_at > datetime('now'))`
          )
          .get(agent) as { cnt: number }
      ).cnt;

      if (pendingCount >= safeguardsConfig.max_pending_per_agent) break;

      // Resolve trust level for this agent+category
      const trustLevel = trustConfig.enabled
        ? resolveTrustLevel(
            agent,
            category,
            trustConfig,
            db,
            lastAutonomyConfig ?? undefined
          )
        : "probationary" as const;

      // Evaluate the action — may shorten chain or auto-approve
      const evaluation = evaluateSafeguardAction(
        agent,
        category as ActionCategory,
        safeguardsConfig,
        trustLevel
      );

      if (evaluation.autoApproved || evaluation.chain.length === 0) {
        // Auto-approved by trust level or empty chain after modifications
        db.prepare(
          `INSERT INTO safeguard_pending
           (agent_role, category, description, approval_chain, current_step, status, resolved_at)
           VALUES (?, ?, ?, '[]', 0, 'auto_approved', datetime('now'))`
        ).run(agent, category, description || "");

        // Record in external_actions for trust tracking
        recordExternalAction(
          db,
          agent,
          category,
          description || "",
          "approved",
          "auto"
        );
        break;
      }

      // Resolve concrete approvers in the chain
      const resolvedChain: ResolvedApprovalChainStep[] = evaluation.chain.map((step) => ({
        role: resolveApprover(step.role, agent, agentDepts),
        qualifier: step.qualifier,
      }));

      // Calculate expiry
      const expiryHours = safeguardsConfig.action_expiry_hours || 48;
      const expiresAt = new Date(
        Date.now() + expiryHours * 60 * 60 * 1000
      ).toISOString().replace("T", " ").slice(0, 19);

      db.prepare(
        `INSERT INTO safeguard_pending
         (agent_role, category, description, approval_chain, current_step, status, expires_at)
         VALUES (?, ?, ?, ?, 0, 'pending', ?)`
      ).run(
        agent,
        category,
        description || "",
        JSON.stringify(resolvedChain),
        expiresAt
      );
      break;
    }

    case "approve": {
      const id = parseInt(action.data.id, 10);
      if (Number.isNaN(id)) break;

      const row = db
        .prepare(
          `SELECT * FROM safeguard_pending 
           WHERE id = ? AND status = 'pending' 
           AND (expires_at IS NULL OR expires_at > datetime('now'))`
        )
        .get(id) as
        | (PendingAction & {
            approvals: string;
            expires_at: string | null;
          })
        | undefined;
      if (!row) break;

      let chain: ResolvedApprovalChainStep[] = [];
      try {
        const parsed = JSON.parse(row.approval_chain);
        if (!Array.isArray(parsed)) {
          console.warn(`Invalid approval chain format for action #${id}`);
          break;
        }
        chain = parsed as ResolvedApprovalChainStep[];
      } catch (e) {
        console.warn(`Failed to parse approval chain for action #${id}:`, e);
        break;
      }

      const approvedBy = action.data.by || "cli";
      let approvals: Array<{ role: string; approved_at: string }> = [];
      try {
        approvals = JSON.parse(row.approvals);
      } catch {
        // ignore
      }

      // Record this approval step
      approvals.push({
        role: approvedBy,
        approved_at: new Date().toISOString(),
      });

      const nextStep = row.current_step + 1;

      if (nextStep >= chain.length) {
        // All steps approved — mark as approved
        db.prepare(
          `UPDATE safeguard_pending
           SET status = 'approved', current_step = ?, approvals = ?, resolved_at = datetime('now')
           WHERE id = ?`
        ).run(nextStep, JSON.stringify(approvals), id);

        // Record in external_actions for trust tracking
        recordExternalAction(
          db,
          row.agent_role,
          row.category,
          row.description,
          "approved",
          approvedBy
        );
      } else {
        // Advance to next step
        db.prepare(
          `UPDATE safeguard_pending
           SET current_step = ?, approvals = ?
           WHERE id = ?`
        ).run(nextStep, JSON.stringify(approvals), id);
      }
      break;
    }

    case "reject": {
      const id = parseInt(action.data.id, 10);
      if (Number.isNaN(id)) break;

      const row = db
        .prepare(
          `SELECT * FROM safeguard_pending 
           WHERE id = ? AND status = 'pending' 
           AND (expires_at IS NULL OR expires_at > datetime('now'))`
        )
        .get(id) as (PendingAction & { approvals: string }) | undefined;
      if (!row) break;

      const rejectedBy = action.data.by || "cli";
      const reason = action.data.reason || "";

      const rejection = JSON.stringify({
        rejected_by: rejectedBy,
        reason,
        rejected_at: new Date().toISOString(),
      });

      db.prepare(
        `UPDATE safeguard_pending
         SET status = 'rejected', rejection = ?, resolved_at = datetime('now')
         WHERE id = ?`
      ).run(rejection, id);

      // Record in external_actions for trust tracking
      recordExternalAction(
        db,
        row.agent_role,
        row.category,
        row.description,
        "rejected",
        undefined,
        rejectedBy,
        reason
      );
      break;
    }
  }
}

// ============================================
// MESSAGE HANDLER REGISTRATION
// ============================================

registerMessageHandler("safeguard-actions", (msg, config) => {
  const safeguardsConfig = config.extensions?.safeguards as
    | SafeguardsConfig
    | undefined;
  if (safeguardsConfig && !safeguardsConfig.enabled) return;

  // Cache configs for the flush callback
  if (safeguardsConfig) lastSafeguardsConfig = safeguardsConfig;
  const trustConfig = config.extensions?.trust as TrustConfig | undefined;
  if (trustConfig) lastTrustConfig = trustConfig;
  const autonomyConfig = config.extensions?.autonomy as AutonomyConfig | undefined;
  if (autonomyConfig) lastAutonomyConfig = autonomyConfig;

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

  // Parse structured SAFEGUARD:: markers

  // SAFEGUARD::REQUEST category=<cat> agent=<role> description="<desc>"
  const requestMatches = text.matchAll(
    /SAFEGUARD::REQUEST\s+category=(\S+)\s+agent=(\S+)\s+description="([^"]*)"/g
  );
  for (const match of requestMatches) {
    queueAction(
      {
        type: "request",
        data: {
          category: match[1],
          agent: match[2],
          description: match[3],
        },
      },
      lastProjectDir
    );
  }

  // SAFEGUARD::APPROVE id=<id> [by=<role>]
  const approveMatches = text.matchAll(
    /SAFEGUARD::APPROVE\s+id=(\d+)(?:\s+by=(\S+))?/g
  );
  for (const match of approveMatches) {
    queueAction(
      {
        type: "approve",
        data: { id: match[1], by: match[2] || "" },
      },
      lastProjectDir
    );
  }

  // SAFEGUARD::REJECT id=<id> [by=<role>] [reason="<reason>"]
  const rejectMatches = text.matchAll(
    /SAFEGUARD::REJECT\s+id=(\d+)(?:\s+by=(\S+))?(?:\s+reason="([^"]*)")?/g
  );
  for (const match of rejectMatches) {
    queueAction(
      {
        type: "reject",
        data: {
          id: match[1],
          by: match[2] || "",
          reason: match[3] || "",
        },
      },
      lastProjectDir
    );
  }

  // Natural language fallback patterns
  const requestNlMatches = text.matchAll(
    /requesting approval for (\S+)/gi
  );
  for (const match of requestNlMatches) {
    const category = match[1].toLowerCase();
    if (VALID_ACTION_CATEGORIES.includes(category as ActionCategory)) {
      queueAction(
        {
          type: "request",
          data: {
            category,
            agent: "ceo",
            description: "Requested via natural language",
          },
        },
        lastProjectDir
      );
    }
  }

  const approveNlMatches = text.matchAll(
    /approved external action #(\d+)/gi
  );
  for (const match of approveNlMatches) {
    queueAction(
      {
        type: "approve",
        data: { id: match[1], by: "ceo" },
      },
      lastProjectDir
    );
  }

  const rejectNlMatches = text.matchAll(
    /rejected external action #(\d+)/gi
  );
  for (const match of rejectNlMatches) {
    queueAction(
      {
        type: "reject",
        data: { id: match[1], by: "ceo", reason: "" },
      },
      lastProjectDir
    );
  }
});
