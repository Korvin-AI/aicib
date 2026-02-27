/**
 * Communication Routing Rules (#37)
 *
 * Defines routing modes that control how agents communicate across departments.
 * The CEO's system prompt includes the active routing policy so it can instruct
 * agents to follow the correct communication paths.
 *
 * Four modes:
 * - strict_hierarchy: cross-dept only through department heads
 * - open_cc_manager: anyone to anyone, but CC department heads on cross-dept
 * - open: no restrictions
 * - custom: per-department-pair overrides with global fallback
 */

// ── Types ───────────────────────────────────────────────────────────

export type RoutingMode =
  | "strict_hierarchy"
  | "open_cc_manager"
  | "open"
  | "custom";

export const VALID_ROUTING_MODES: RoutingMode[] = [
  "strict_hierarchy",
  "open_cc_manager",
  "open",
  "custom",
];

export interface CustomRoutingRule {
  from_department: string;
  to_department: string;
  mode: RoutingMode;
}

export interface RoutingConfig {
  enabled: boolean;
  mode: RoutingMode;
  log_violations: boolean;
  custom_rules: CustomRoutingRule[];
}

export const ROUTING_CONFIG_DEFAULTS: RoutingConfig = {
  enabled: true,
  mode: "open_cc_manager",
  log_violations: true,
  custom_rules: [],
};

export interface RouteEvaluation {
  allowed: boolean;
  requiresCC: string[];
  violation?: string;
}

// ── Department head mapping ─────────────────────────────────────────

const DEPARTMENT_HEADS: Record<string, string> = {
  engineering: "cto",
  finance: "cfo",
  marketing: "cmo",
};

function getDepartmentHead(department: string): string | null {
  return DEPARTMENT_HEADS[department.toLowerCase()] ?? null;
}

// ── Validation ──────────────────────────────────────────────────────

export function validateRoutingConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return errors;

  const obj = raw as Record<string, unknown>;

  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    errors.push("routing.enabled must be a boolean");
  }

  if (obj.mode !== undefined) {
    if (!VALID_ROUTING_MODES.includes(obj.mode as RoutingMode)) {
      errors.push(
        `routing.mode must be one of: ${VALID_ROUTING_MODES.join(", ")}`
      );
    }
  }

  if (
    obj.log_violations !== undefined &&
    typeof obj.log_violations !== "boolean"
  ) {
    errors.push("routing.log_violations must be a boolean");
  }

  if (obj.custom_rules !== undefined) {
    if (!Array.isArray(obj.custom_rules)) {
      errors.push("routing.custom_rules must be an array");
    } else {
      for (let i = 0; i < obj.custom_rules.length; i++) {
        const rule = obj.custom_rules[i] as Record<string, unknown>;
        if (!rule.from_department || typeof rule.from_department !== "string") {
          errors.push(
            `routing.custom_rules[${i}].from_department is required and must be a string`
          );
        }
        if (!rule.to_department || typeof rule.to_department !== "string") {
          errors.push(
            `routing.custom_rules[${i}].to_department is required and must be a string`
          );
        }
        if (
          !rule.mode ||
          !VALID_ROUTING_MODES.includes(rule.mode as RoutingMode)
        ) {
          errors.push(
            `routing.custom_rules[${i}].mode must be one of: ${VALID_ROUTING_MODES.join(", ")}`
          );
        } else if (rule.mode === "custom") {
          errors.push(
            `routing.custom_rules[${i}].mode cannot be "custom" (use a concrete mode: strict_hierarchy, open_cc_manager, or open)`
          );
        }
      }
    }
  }

  return errors;
}

// ── Route Evaluation ────────────────────────────────────────────────

/**
 * Evaluate whether a message route is allowed under the current config.
 *
 * @param fromRole - The sending agent's role (e.g., "developer")
 * @param fromDept - The sending agent's department (e.g., "engineering")
 * @param toRole - The receiving agent's role
 * @param toDept - The receiving agent's department
 * @param config - The active routing configuration
 */
export function evaluateRoute(
  fromRole: string,
  fromDept: string,
  toRole: string,
  toDept: string,
  config: RoutingConfig
): RouteEvaluation {
  if (!config.enabled) {
    return { allowed: true, requiresCC: [] };
  }

  // Same department — always allowed
  if (
    fromDept.toLowerCase() === toDept.toLowerCase() ||
    !fromDept ||
    !toDept
  ) {
    return { allowed: true, requiresCC: [] };
  }

  const effectiveMode = resolveEffectiveMode(fromDept, toDept, config);

  switch (effectiveMode) {
    case "open":
      return { allowed: true, requiresCC: [] };

    case "open_cc_manager": {
      const ccTargets: string[] = [];
      const fromHead = getDepartmentHead(fromDept);
      const toHead = getDepartmentHead(toDept);
      // CC both department heads if the sender/receiver aren't themselves the head
      if (fromHead && fromRole.toLowerCase() !== fromHead) {
        ccTargets.push(fromHead);
      }
      if (toHead && toRole.toLowerCase() !== toHead) {
        ccTargets.push(toHead);
      }
      return { allowed: true, requiresCC: ccTargets };
    }

    case "strict_hierarchy": {
      const fromHead = getDepartmentHead(fromDept);
      const toHead = getDepartmentHead(toDept);
      // Only department heads (or CEO) can communicate cross-department
      const isDeptHead =
        fromRole.toLowerCase() === fromHead ||
        fromRole.toLowerCase() === "ceo";
      const targetIsDeptHead =
        toRole.toLowerCase() === toHead || toRole.toLowerCase() === "ceo";

      if (isDeptHead || targetIsDeptHead) {
        return { allowed: true, requiresCC: [] };
      }

      return {
        allowed: false,
        requiresCC: [],
        violation: `Cross-department communication from ${fromRole} (${fromDept}) to ${toRole} (${toDept}) requires routing through department heads under strict_hierarchy mode`,
      };
    }

    case "custom":
      // Custom mode falls back to open_cc_manager behavior by default
      return evaluateRoute(
        fromRole,
        fromDept,
        toRole,
        toDept,
        { ...config, mode: "open_cc_manager" }
      );

    default:
      return { allowed: true, requiresCC: [] };
  }
}

/**
 * Resolve the effective mode for a given department pair.
 * Custom rules: check for exact dept-pair match, then fallback to global mode.
 */
function resolveEffectiveMode(
  fromDept: string,
  toDept: string,
  config: RoutingConfig
): RoutingMode {
  if (config.mode !== "custom" || config.custom_rules.length === 0) {
    return config.mode;
  }

  // Look for matching custom rule (exact dept pair)
  for (const rule of config.custom_rules) {
    if (
      rule.from_department.toLowerCase() === fromDept.toLowerCase() &&
      rule.to_department.toLowerCase() === toDept.toLowerCase()
    ) {
      return rule.mode;
    }
  }

  // No matching custom rule — fall back to open_cc_manager
  return "open_cc_manager";
}

// ── Context Formatting ──────────────────────────────────────────────

const MODE_DESCRIPTIONS: Record<RoutingMode, string> = {
  strict_hierarchy:
    "All cross-department communication must go through department heads (CTO, CFO, CMO). Individual contributors cannot message agents outside their department directly.",
  open_cc_manager:
    "Agents may communicate across departments freely, but must CC their department head on all cross-department messages. Department heads: CTO (engineering), CFO (finance), CMO (marketing).",
  open:
    "All agents may communicate with any other agent without restrictions.",
  custom:
    "Custom routing rules apply per department pair. Check specific rules below.",
};

/**
 * Format the routing policy as prompt text for the CEO system prompt.
 */
export function formatRoutingContext(config: RoutingConfig): string {
  if (!config.enabled) return "";

  const lines: string[] = [
    "## Communication Routing Policy",
    "",
    `**Mode:** ${config.mode}`,
    "",
    MODE_DESCRIPTIONS[config.mode],
  ];

  if (config.mode === "custom" && config.custom_rules.length > 0) {
    lines.push("");
    lines.push("**Custom Rules:**");
    for (const rule of config.custom_rules) {
      lines.push(
        `- ${rule.from_department} → ${rule.to_department}: ${rule.mode}`
      );
    }
  }

  lines.push("");
  lines.push(
    "When delegating work, ensure agents follow these communication rules. " +
      "Use ROUTE::SEND and ROUTE::CC markers to document cross-department communications."
  );

  if (config.log_violations) {
    lines.push(
      "Routing violations are logged for review."
    );
  }

  return lines.join("\n");
}
