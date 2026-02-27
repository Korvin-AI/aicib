/**
 * External Safeguards (#14)
 *
 * Defines category-based approval chains for external agent actions.
 * Each action category (social_media, code_deployment, etc.) has a
 * required approval chain that must be completed before the action
 * can execute. Trust levels can shorten chains over time.
 *
 * Integration: Context provider injects safeguard rules into CEO prompt.
 * Message handler detects SAFEGUARD:: markers for approval workflow.
 */

import type { TrustLevel } from "./trust-evolution.js";
import { TRUST_CHAIN_MODIFICATIONS } from "./trust-evolution.js";

// ── Types ───────────────────────────────────────────────────────────

export type ActionCategory =
  | "social_media"
  | "customer_email"
  | "marketing_email"
  | "code_deployment"
  | "financial_transaction"
  | "public_content"
  | "internal_tool_change";

export const VALID_ACTION_CATEGORIES: ActionCategory[] = [
  "social_media",
  "customer_email",
  "marketing_email",
  "code_deployment",
  "financial_transaction",
  "public_content",
  "internal_tool_change",
];

export type ApprovalRole =
  | "department_head"
  | "cmo"
  | "cto"
  | "cfo"
  | "ceo"
  | "owner";

export const VALID_APPROVAL_ROLES: ApprovalRole[] = [
  "department_head",
  "cmo",
  "cto",
  "cfo",
  "ceo",
  "owner",
];

export interface ApprovalChainStep {
  role: ApprovalRole;
  qualifier?: string;
}

export interface CategoryRule {
  category: ActionCategory;
  description: string;
  approval_chain: ApprovalChainStep[];
  auto_execute: boolean;
}

export type ActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "auto_approved";

export interface SafeguardsConfig {
  enabled: boolean;
  action_expiry_hours: number;
  categories: Record<string, Partial<CategoryRule>>;
  max_pending_per_agent: number;
}

// ── Defaults ────────────────────────────────────────────────────────

export const SAFEGUARDS_CONFIG_DEFAULTS: SafeguardsConfig = {
  enabled: true,
  action_expiry_hours: 48,
  categories: {},
  max_pending_per_agent: 10,
};

const DEFAULT_CATEGORY_RULES: Record<ActionCategory, CategoryRule> = {
  social_media: {
    category: "social_media",
    description: "Posts to social media platforms (Twitter, LinkedIn, etc.)",
    approval_chain: [{ role: "cmo" }],
    auto_execute: true,
  },
  customer_email: {
    category: "customer_email",
    description: "Emails sent directly to customers",
    approval_chain: [{ role: "department_head" }],
    auto_execute: true,
  },
  marketing_email: {
    category: "marketing_email",
    description: "Marketing campaigns and newsletters",
    approval_chain: [{ role: "cmo" }, { role: "owner" }],
    auto_execute: true,
  },
  code_deployment: {
    category: "code_deployment",
    description: "Deploying code to staging or production",
    approval_chain: [{ role: "cto" }, { role: "owner", qualifier: "production" }],
    auto_execute: false,
  },
  financial_transaction: {
    category: "financial_transaction",
    description: "Any financial commitment or transaction",
    approval_chain: [{ role: "cfo" }, { role: "owner" }],
    auto_execute: false,
  },
  public_content: {
    category: "public_content",
    description: "Blog posts, press releases, public documentation",
    approval_chain: [
      { role: "department_head" },
      { role: "cmo" },
      { role: "owner" },
    ],
    auto_execute: true,
  },
  internal_tool_change: {
    category: "internal_tool_change",
    description: "Changes to internal tools, configurations, or infrastructure",
    approval_chain: [{ role: "cto" }, { role: "owner" }],
    auto_execute: false,
  },
};

// ── Department head mapping ─────────────────────────────────────────

const DEPARTMENT_HEADS: Record<string, string> = {
  engineering: "cto",
  finance: "cfo",
  marketing: "cmo",
};

// ── Validation ──────────────────────────────────────────────────────

export function validateSafeguardsConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return errors;

  const obj = raw as Record<string, unknown>;

  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    errors.push("safeguards.enabled must be a boolean");
  }

  if (obj.action_expiry_hours !== undefined) {
    if (
      typeof obj.action_expiry_hours !== "number" ||
      obj.action_expiry_hours < 1
    ) {
      errors.push("safeguards.action_expiry_hours must be a positive number");
    }
  }

  if (obj.max_pending_per_agent !== undefined) {
    if (
      typeof obj.max_pending_per_agent !== "number" ||
      obj.max_pending_per_agent < 1
    ) {
      errors.push(
        "safeguards.max_pending_per_agent must be a positive number"
      );
    }
  }

  if (obj.categories !== undefined) {
    if (typeof obj.categories !== "object" || obj.categories === null) {
      errors.push("safeguards.categories must be an object");
    } else {
      for (const [cat, rule] of Object.entries(
        obj.categories as Record<string, unknown>
      )) {
        if (!VALID_ACTION_CATEGORIES.includes(cat as ActionCategory)) {
          errors.push(
            `safeguards.categories.${cat} is not a valid category (${VALID_ACTION_CATEGORIES.join(", ")})`
          );
        }
        if (rule && typeof rule === "object") {
          const r = rule as Record<string, unknown>;
          if (r.auto_execute !== undefined && typeof r.auto_execute !== "boolean") {
            errors.push(`safeguards.categories.${cat}.auto_execute must be a boolean`);
          }
          if (r.approval_chain !== undefined && !Array.isArray(r.approval_chain)) {
            errors.push(`safeguards.categories.${cat}.approval_chain must be an array`);
          }
        }
      }
    }
  }

  return errors;
}

// ── Core functions ──────────────────────────────────────────────────

/**
 * Resolve the effective category rule by merging defaults with config overrides.
 */
export function resolveCategoryRule(
  category: ActionCategory,
  config: SafeguardsConfig
): CategoryRule {
  const base = DEFAULT_CATEGORY_RULES[category];
  const override = config.categories?.[category];
  if (!override) return base;

  return {
    ...base,
    ...override,
    category,
    description: override.description || base.description,
    approval_chain: override.approval_chain || base.approval_chain,
    auto_execute: override.auto_execute ?? base.auto_execute,
  };
}

/**
 * Resolve abstract `department_head` role to a concrete C-level based on
 * the agent's department.
 */
export function resolveApprover(
  role: ApprovalRole,
  agentRole: string,
  agentDepts: Map<string, string>
): string {
  if (role === "department_head") {
    // Look up the agent's department and find the department head
    const dept = agentDepts.get(agentRole);
    if (!dept) {
      console.warn(
        `Agent ${agentRole} has no department for department_head resolution, falling back to CEO`
      );
      return "ceo";
    }
    const head = DEPARTMENT_HEADS[dept.toLowerCase()];
    if (!head) {
      console.warn(
        `Unknown department "${dept}" for agent ${agentRole}, falling back to CEO`
      );
      return "ceo";
    }
    return head;
  }
  return role;
}

export interface SafeguardEvaluation {
  chain: ApprovalChainStep[];
  autoApproved: boolean;
}

/**
 * Evaluate whether an external action requires approval and what chain applies.
 * Trust level can shorten the chain for qualifying categories.
 */
export function evaluateSafeguardAction(
  agentRole: string,
  category: ActionCategory,
  config: SafeguardsConfig,
  trustLevel?: TrustLevel
): SafeguardEvaluation {
  const rule = resolveCategoryRule(category, config);
  let chain = [...rule.approval_chain];

  // Trust-based chain modifications (imported from trust-evolution)
  if (trustLevel) {
    const mods = TRUST_CHAIN_MODIFICATIONS[trustLevel];
    if (mods) {
      // Skip first chain step for qualifying categories
      if (mods.skip_first.includes(category) && chain.length > 1) {
        chain = chain.slice(1);
      }

      // Auto-approve for veteran on qualifying categories
      if (mods.auto_approve.includes(category) && rule.auto_execute) {
        return { chain: [], autoApproved: true };
      }
    }
  }

  return { chain, autoApproved: false };
}

// ── Context formatting ──────────────────────────────────────────────

export interface ResolvedApprovalChainStep {
  role: string; // Concrete role (cto, cfo, etc.) - resolved from ApprovalRole
  qualifier?: string;
}

export interface PendingAction {
  id: number;
  agent_role: string;
  category: string;
  description: string;
  current_step: number;
  approval_chain: string; // JSON array of ResolvedApprovalChainStep
  status: string;
  created_at: string;
}

/**
 * Format safeguards configuration as markdown for the CEO prompt.
 */
export function formatSafeguardsContext(
  config: SafeguardsConfig,
  pendingActions?: PendingAction[]
): string {
  if (!config.enabled) return "";

  const lines: string[] = [
    "## External Action Safeguards",
    "",
    "All external actions require approval through category-specific chains.",
    "Use SAFEGUARD:: markers to request, approve, or reject external actions.",
    "",
    "### Category Rules",
    "",
    "| Category | Approval Chain | Auto-Execute |",
    "|----------|---------------|-------------|",
  ];

  for (const cat of VALID_ACTION_CATEGORIES) {
    const rule = resolveCategoryRule(cat, config);
    const chainStr = rule.approval_chain
      .map((s) => s.role + (s.qualifier ? ` (${s.qualifier})` : ""))
      .join(" -> ");
    lines.push(
      `| ${cat} | ${chainStr} | ${rule.auto_execute ? "Yes" : "No"} |`
    );
  }

  if (pendingActions && pendingActions.length > 0) {
    lines.push("", "### Pending Actions", "");
    for (const action of pendingActions) {
      let chain: ResolvedApprovalChainStep[] = [];
      try {
        const parsed = JSON.parse(action.approval_chain);
        if (Array.isArray(parsed)) {
          chain = parsed as ResolvedApprovalChainStep[];
        }
      } catch {
        // Parse error - use empty chain
      }
      const step = action.current_step;
      const total = chain.length;
      const currentRole = step < total ? chain[step].role : "complete";
      lines.push(
        `- **#${action.id}** [${action.category}] ${action.description} ` +
          `(step ${step + 1}/${total}, awaiting: ${currentRole}) — by ${action.agent_role}`
      );
    }
  }

  lines.push(
    "",
    "### Marker Syntax",
    '- `SAFEGUARD::REQUEST category=<cat> agent=<role> description="<desc>"`',
    "- `SAFEGUARD::APPROVE id=<id> [by=<role>]`",
    '- `SAFEGUARD::REJECT id=<id> [by=<role>] [reason="<reason>"]`',
    ""
  );

  return lines.join("\n");
}
