/**
 * Autonomy & Decision-Making Matrix (#5)
 *
 * Defines 5 autonomy levels (restricted → full) that govern what each agent
 * can decide autonomously vs. what requires escalation. Rules are organized
 * across 4 categories: file_operations, decisions, communication, spending.
 *
 * Integration: Context provider injects formatted autonomy rules into the
 * CEO's prompt. Config extension allows global and per-agent overrides.
 */

// --- Types ---

/** The five autonomy levels, from most restricted to fully autonomous. */
export type AutonomyLevel =
  | "restricted"
  | "guided"
  | "standard"
  | "autonomous"
  | "full";

export const VALID_AUTONOMY_LEVELS: AutonomyLevel[] = [
  "restricted",
  "guided",
  "standard",
  "autonomous",
  "full",
];

/** A single autonomy rule for one category of actions. */
export interface AutonomyRule {
  category: string;
  autonomous: string[];
  requires_escalation: string[];
}

/** A complete autonomy profile for one level. */
export interface AutonomyProfile {
  level: AutonomyLevel;
  description: string;
  rules: AutonomyRule[];
}

/** Per-agent autonomy override from config. */
export interface AgentAutonomyOverride {
  level?: AutonomyLevel;
  /** Additional actions this agent can do autonomously beyond their level. */
  grant?: string[];
  /** Actions this agent must always escalate regardless of level. */
  restrict?: string[];
}

/** The autonomy config section in aicib.config.yaml. */
export interface AutonomyConfig {
  enabled: boolean;
  default_level: AutonomyLevel;
  overrides: Record<string, AgentAutonomyOverride>;
}

// --- Built-in Profiles ---

const AUTONOMY_PROFILES: Record<AutonomyLevel, AutonomyProfile> = {
  restricted: {
    level: "restricted",
    description:
      "Must get approval for nearly all actions. Suitable for new or untested agents.",
    rules: [
      {
        category: "file_operations",
        autonomous: ["Read files", "Search codebase"],
        requires_escalation: [
          "Create files",
          "Modify files",
          "Delete files",
        ],
      },
      {
        category: "decisions",
        autonomous: ["Analyze and recommend"],
        requires_escalation: [
          "All implementation decisions",
          "Any commitment or deliverable",
        ],
      },
      {
        category: "communication",
        autonomous: ["Report status to manager"],
        requires_escalation: [
          "Cross-department communication",
          "External communication",
        ],
      },
      {
        category: "spending",
        autonomous: [],
        requires_escalation: [
          "Any spending decision",
          "Any tool or service commitment",
        ],
      },
    ],
  },

  guided: {
    level: "guided",
    description:
      "Can act within clear parameters but must escalate anything ambiguous.",
    rules: [
      {
        category: "file_operations",
        autonomous: [
          "Read files",
          "Search codebase",
          "Create files within assigned scope",
        ],
        requires_escalation: [
          "Modify files outside assigned scope",
          "Delete files",
          "Structural changes",
        ],
      },
      {
        category: "decisions",
        autonomous: [
          "Implementation details within spec",
          "Minor technical choices",
        ],
        requires_escalation: [
          "Architecture decisions",
          "Scope changes",
          "Ambiguous requirements",
        ],
      },
      {
        category: "communication",
        autonomous: ["Report to manager", "Ask clarifying questions"],
        requires_escalation: [
          "Cross-department requests",
          "External communication",
        ],
      },
      {
        category: "spending",
        autonomous: [],
        requires_escalation: ["Any spending above $0"],
      },
    ],
  },

  standard: {
    level: "standard",
    description:
      "Default level. Operates independently on routine work, escalates significant decisions.",
    rules: [
      {
        category: "file_operations",
        autonomous: [
          "Read, create, and modify files within department scope",
        ],
        requires_escalation: [
          "Cross-department file changes",
          "Delete critical files",
        ],
      },
      {
        category: "decisions",
        autonomous: [
          "Implementation decisions",
          "Technical tradeoffs within scope",
          "Task prioritization",
        ],
        requires_escalation: [
          "Architecture changes affecting other departments",
          "Timeline slips > 1 day",
        ],
      },
      {
        category: "communication",
        autonomous: [
          "Report to manager",
          "Coordinate with peers in same department",
        ],
        requires_escalation: [
          "Cross-department commitments",
          "External communication",
        ],
      },
      {
        category: "spending",
        autonomous: ["Use existing tools and services"],
        requires_escalation: [
          "New service commitments",
          "Spending above departmental threshold",
        ],
      },
    ],
  },

  autonomous: {
    level: "autonomous",
    description:
      "Makes most decisions independently. Escalates only strategic or high-risk items.",
    rules: [
      {
        category: "file_operations",
        autonomous: ["All file operations within project scope"],
        requires_escalation: [
          "Changes to core configuration",
          "Deletions of shared resources",
        ],
      },
      {
        category: "decisions",
        autonomous: [
          "All technical and tactical decisions",
          "Cross-department coordination",
          "Resource allocation within department",
        ],
        requires_escalation: [
          "Strategic pivots",
          "Major architecture changes",
          "Commitments affecting company timeline",
        ],
      },
      {
        category: "communication",
        autonomous: ["All internal communication", "Peer coordination"],
        requires_escalation: [
          "External communication",
          "Commitments to outside parties",
        ],
      },
      {
        category: "spending",
        autonomous: ["Use and configure existing tools"],
        requires_escalation: [
          "New vendor commitments",
          "Spending above company threshold",
        ],
      },
    ],
  },

  full: {
    level: "full",
    description:
      "CEO-level autonomy. Acts independently on all matters except those reserved for the human founder.",
    rules: [
      {
        category: "file_operations",
        autonomous: ["All file operations"],
        requires_escalation: [],
      },
      {
        category: "decisions",
        autonomous: [
          "All operational and tactical decisions",
          "Cross-department strategy",
          "Resource reallocation",
        ],
        requires_escalation: [
          "Major strategic pivots",
          "External partnerships",
          "Spending above company limits",
        ],
      },
      {
        category: "communication",
        autonomous: [
          "All internal communication",
          "All department coordination",
        ],
        requires_escalation: [
          "Press/media",
          "Legal commitments",
          "Investor communication",
        ],
      },
      {
        category: "spending",
        autonomous: ["All spending within daily/monthly limits"],
        requires_escalation: ["Spending above configured limits"],
      },
    ],
  },
};

// --- Functions ---

/** Get the autonomy profile for a given level. */
export function getAutonomyProfile(level: AutonomyLevel): AutonomyProfile {
  return AUTONOMY_PROFILES[level];
}

/**
 * Resolve the effective autonomy level for an agent.
 * Priority: config override > frontmatter > config default > "standard"
 */
export function resolveAutonomyLevel(
  agentRole: string,
  frontmatterLevel: string | undefined,
  config: AutonomyConfig
): AutonomyLevel {
  const override = config.overrides?.[agentRole];
  if (override?.level && VALID_AUTONOMY_LEVELS.includes(override.level)) {
    return override.level;
  }
  if (
    frontmatterLevel &&
    VALID_AUTONOMY_LEVELS.includes(frontmatterLevel as AutonomyLevel)
  ) {
    return frontmatterLevel as AutonomyLevel;
  }
  if (
    config.default_level &&
    VALID_AUTONOMY_LEVELS.includes(config.default_level)
  ) {
    return config.default_level;
  }
  return "standard";
}

/**
 * Format autonomy rules as markdown for prompt injection.
 * Returns a block describing what this agent can/cannot do.
 */
export function formatAutonomyContext(
  agentRole: string,
  level: AutonomyLevel,
  config: AutonomyConfig
): string {
  const profile = AUTONOMY_PROFILES[level];
  const override = config.overrides?.[agentRole];

  let output = `**Level: ${level.toUpperCase()}** — ${profile.description}\n`;

  for (const rule of profile.rules) {
    const heading = rule.category
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    output += `- **${heading}:**`;

    if (rule.autonomous.length > 0) {
      output += ` Can: ${rule.autonomous.join("; ")}`;
    }
    if (rule.requires_escalation.length > 0) {
      if (rule.autonomous.length > 0) output += ` |`;
      output += ` Escalate: ${rule.requires_escalation.join("; ")}`;
    }
    output += "\n";
  }

  if (override?.grant && override.grant.length > 0) {
    output += `- **Additional permissions (config):** ${override.grant.join("; ")}\n`;
  }
  if (override?.restrict && override.restrict.length > 0) {
    output += `- **Always escalate (config):** ${override.restrict.join("; ")}\n`;
  }

  return output;
}

// --- Config Extension ---

export const AUTONOMY_CONFIG_DEFAULTS: AutonomyConfig = {
  enabled: true,
  default_level: "standard",
  overrides: {},
};

export function validateAutonomyConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw !== undefined && (typeof raw !== "object" || raw === null)) {
    errors.push("autonomy must be an object (not a scalar)");
    return errors;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
      errors.push("autonomy.enabled must be a boolean");
    }

    if (obj.default_level !== undefined) {
      if (
        !VALID_AUTONOMY_LEVELS.includes(obj.default_level as AutonomyLevel)
      ) {
        errors.push(
          `autonomy.default_level must be one of: ${VALID_AUTONOMY_LEVELS.join(", ")}`
        );
      }
    }

    if (
      obj.overrides !== undefined &&
      typeof obj.overrides === "object" &&
      obj.overrides !== null
    ) {
      for (const [role, override] of Object.entries(
        obj.overrides as Record<string, unknown>
      )) {
        if (override && typeof override === "object") {
          const o = override as Record<string, unknown>;
          if (
            o.level !== undefined &&
            !VALID_AUTONOMY_LEVELS.includes(o.level as AutonomyLevel)
          ) {
            errors.push(
              `autonomy.overrides.${role}.level must be one of: ${VALID_AUTONOMY_LEVELS.join(", ")}`
            );
          }
          if (o.grant !== undefined) {
            if (!Array.isArray(o.grant)) {
              errors.push(`autonomy.overrides.${role}.grant must be an array`);
            } else if (o.grant.some((x: unknown) => typeof x !== "string")) {
              errors.push(`autonomy.overrides.${role}.grant items must be strings`);
            }
          }
          if (o.restrict !== undefined) {
            if (!Array.isArray(o.restrict)) {
              errors.push(`autonomy.overrides.${role}.restrict must be an array`);
            } else if (o.restrict.some((x: unknown) => typeof x !== "string")) {
              errors.push(`autonomy.overrides.${role}.restrict items must be strings`);
            }
          }
        }
      }
    }
  }
  return errors;
}
