/**
 * Error Handling & Escalation Protocol (#24)
 *
 * Defines an up-to-6-step escalation chain: retry → peer → manager →
 * department_head → ceo → human_founder. Steps are skipped when not applicable
 * (e.g., CEO has only 2 steps: retry → human_founder). Chains are built
 * dynamically from the org structure (reports_to, department fields in
 * agent frontmatter).
 *
 * Integration: Context provider injects formatted escalation rules into the
 * CEO's prompt. Config extension allows max_retries and chain overrides.
 * Database table tracks escalation events for visibility and analytics.
 */

import { loadAgentDefinitions, type AgentDefinition } from "./agents.js";
import { getAgentsDir } from "./team.js";
import type { AicibConfig } from "./config.js";

// --- Types ---

/** The up-to-6-step escalation chain levels. */
export type EscalationStep =
  | "retry"
  | "peer"
  | "manager"
  | "department_head"
  | "ceo"
  | "human_founder";

/** Priority classification for escalation events. */
export type EscalationPriority = "low" | "medium" | "high" | "critical";

export const VALID_ESCALATION_PRIORITIES: EscalationPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

/** A single link in an escalation chain. */
export interface EscalationLink {
  step: EscalationStep;
  target: string;
  description: string;
}

/** An agent's complete escalation chain. */
export interface EscalationChain {
  agent_role: string;
  chain: EscalationLink[];
}

/** An escalation event recorded in SQLite. */
export interface EscalationEvent {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  step: EscalationStep;
  priority: EscalationPriority;
  category: string;
  reason: string;
  resolved: boolean;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** The escalation config section in aicib.config.yaml. */
export interface EscalationConfig {
  enabled: boolean;
  max_retries: number;
  track_events: boolean;
  chain_overrides: Record<string, string[]>;
}

// --- Constants ---

const ESCALATION_STEPS: EscalationStep[] = [
  "retry",
  "peer",
  "manager",
  "department_head",
  "ceo",
  "human_founder",
];

// --- Functions ---

/**
 * Build the escalation chain for a specific agent based on org structure.
 * Uses reports_to and department fields from the agent's frontmatter.
 */
export function buildEscalationChain(
  agentRole: string,
  projectDir: string,
  config: AicibConfig,
  preloadedAgents?: Map<string, AgentDefinition>
): EscalationChain {
  const agents = preloadedAgents ?? loadAgentDefinitions(getAgentsDir(projectDir));
  const agent = agents.get(agentRole);

  if (!agent) {
    // Fallback chain for unknown agents
    return {
      agent_role: agentRole,
      chain: [
        {
          step: "retry",
          target: agentRole,
          description: "Retry the task with a different approach",
        },
        {
          step: "ceo",
          target: "ceo",
          description: "Escalate to CEO",
        },
        {
          step: "human_founder",
          target: "human-founder",
          description: "Escalate to human founder",
        },
      ],
    };
  }

  const fm = agent.frontmatter;
  const department = fm.department;
  const reportsTo = fm.reports_to;

  // Find peers (same department, same reports_to, not self)
  const peers: string[] = [];
  for (const [role, def] of agents) {
    if (
      role !== agentRole &&
      def.frontmatter.department === department &&
      def.frontmatter.reports_to === reportsTo
    ) {
      peers.push(role);
    }
  }

  // Find department head (C-suite agent for this department)
  let deptHead = "ceo";
  for (const [role, def] of agents) {
    if (
      def.frontmatter.department === department &&
      def.frontmatter.reports_to === "ceo"
    ) {
      deptHead = role;
      break;
    }
  }

  const chain: EscalationLink[] = [];

  // Step 1: Retry (always self)
  chain.push({
    step: "retry",
    target: agentRole,
    description: `Retry the task with a different approach (up to max_retries)`,
  });

  // Step 2: Peer (colleague at same level)
  if (peers.length > 0) {
    chain.push({
      step: "peer",
      target: peers[0],
      description: `Ask ${peers[0]} (peer in ${department}) for guidance`,
    });
  }

  // Step 3: Manager (direct reports_to, if not already CEO/founder)
  if (reportsTo !== "ceo" && reportsTo !== "human-founder") {
    chain.push({
      step: "manager",
      target: reportsTo,
      description: `Escalate to ${reportsTo} (your direct manager)`,
    });
  }

  // Step 4: Department head (if different from manager and self)
  if (deptHead !== agentRole && deptHead !== reportsTo) {
    chain.push({
      step: "department_head",
      target: deptHead,
      description: `Escalate to ${deptHead} (head of ${department})`,
    });
  }

  // Step 5: CEO (unless you ARE the CEO)
  if (agentRole !== "ceo") {
    chain.push({
      step: "ceo",
      target: "ceo",
      description: "Escalate to CEO for cross-department resolution",
    });
  }

  // Step 6: Human founder (always the final step)
  chain.push({
    step: "human_founder",
    target: "human-founder",
    description: "Escalate to human founder (requires human intervention)",
  });

  // Apply chain overrides from config if present
  const escalationConfig = config.extensions?.escalation as
    | EscalationConfig
    | undefined;
  if (escalationConfig?.chain_overrides?.[agentRole]) {
    const overrideTargets = escalationConfig.chain_overrides[agentRole];
    const customChain: EscalationLink[] = [];

    // Warn if more targets than available steps (retry + human_founder are fixed)
    const maxCustomSteps = ESCALATION_STEPS.length - 2;
    if (overrideTargets.length > maxCustomSteps) {
      console.warn(
        `  Warning: chain_overrides.${agentRole} has ${overrideTargets.length} targets but only ${maxCustomSteps} are used (retry and human_founder are fixed).`
      );
    }

    // Always keep retry as first step
    customChain.push(chain[0]);

    // Map override targets to escalation steps
    for (
      let i = 0;
      i < overrideTargets.length && i < ESCALATION_STEPS.length - 1;
      i++
    ) {
      customChain.push({
        step: ESCALATION_STEPS[i + 1],
        target: overrideTargets[i],
        description: `Escalate to ${overrideTargets[i]}`,
      });
    }

    // Always keep human_founder as last step (unless already there from overrides)
    const lastTarget = customChain[customChain.length - 1]?.target;
    if (lastTarget !== "human-founder") {
      customChain.push(chain[chain.length - 1]);
    }
    return { agent_role: agentRole, chain: customChain };
  }

  return { agent_role: agentRole, chain };
}

/**
 * Format escalation chain and protocol as markdown for prompt injection.
 * Shows the chain for one agent plus general escalation rules.
 */
export function formatEscalationContext(
  _agentRole: string,
  chain: EscalationChain,
  config: EscalationConfig
): string {
  let output = "";

  for (let i = 0; i < chain.chain.length; i++) {
    const step = chain.chain[i];
    output += `${i + 1}. **${step.step.replace(/_/g, " ").toUpperCase()}** → ${step.description}\n`;
  }

  output += `\nMax retries before escalating: ${config.max_retries}\n`;

  return output;
}

/**
 * Format the full escalation protocol section for the CEO prompt.
 * Includes all C-suite chains + the standard escalation format.
 */
export function formatFullEscalationContext(
  projectDir: string,
  config: AicibConfig,
  escalationConfig: EscalationConfig
): string {
  const agentsDir = getAgentsDir(projectDir);
  const agents = loadAgentDefinitions(agentsDir);

  let context = "";

  // Show chain for CEO and each C-suite agent
  for (const [role, agent] of agents) {
    if (agent.frontmatter.reports_to !== "ceo" && role !== "ceo") continue;

    const chain = buildEscalationChain(role, projectDir, config, agents);
    context += `### ${agent.frontmatter.title} (${role})\n`;
    context += formatEscalationContext(role, chain, escalationConfig);
    context += "\n";
  }

  context += `### Escalation Format\n`;
  context += `When escalating, agents should use this format:\n`;
  context += "```\n";
  context += `ESCALATION [Step N: step_name] from [role] to [target_role]\n`;
  context += `Priority: [low|medium|high|critical]\n`;
  context += `Category: [what area this relates to]\n`;
  context += `Issue: [what went wrong]\n`;
  context += `Attempted: [what was already tried]\n`;
  context += `Need: [what is needed to proceed]\n`;
  context += "```\n";

  return context;
}

// --- SQL Helpers ---

export function getEscalationInsertSQL(): string {
  return `INSERT INTO escalation_events
    (session_id, from_agent, to_agent, step, priority, category, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
}

export function getRecentEscalationsSQL(limit: number = 10): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT * FROM escalation_events ORDER BY created_at DESC LIMIT ?`,
    params: [limit],
  };
}

export function getUnresolvedEscalationsSQL(): string {
  return `SELECT * FROM escalation_events WHERE resolved = 0 ORDER BY created_at DESC`;
}

// --- Config Extension ---

export const ESCALATION_CONFIG_DEFAULTS: EscalationConfig = {
  enabled: true,
  max_retries: 2,
  track_events: true,
  chain_overrides: {},
};

export function validateEscalationConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw !== undefined && (typeof raw !== "object" || raw === null)) {
    errors.push("escalation must be an object (not a scalar)");
    return errors;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
      errors.push("escalation.enabled must be a boolean");
    }

    if (obj.max_retries !== undefined) {
      if (
        typeof obj.max_retries !== "number" ||
        obj.max_retries < 0 ||
        !Number.isInteger(obj.max_retries)
      ) {
        errors.push("escalation.max_retries must be a non-negative integer");
      }
    }

    if (obj.track_events !== undefined && typeof obj.track_events !== "boolean") {
      errors.push("escalation.track_events must be a boolean");
    }

    if (
      obj.chain_overrides !== undefined &&
      typeof obj.chain_overrides === "object" &&
      obj.chain_overrides !== null
    ) {
      for (const [role, chain] of Object.entries(
        obj.chain_overrides as Record<string, unknown>
      )) {
        if (!Array.isArray(chain)) {
          errors.push(
            `escalation.chain_overrides.${role} must be an array of agent role names`
          );
        } else if (chain.some((x: unknown) => typeof x !== "string")) {
          errors.push(
            `escalation.chain_overrides.${role} items must be strings`
          );
        }
      }
    }
  }
  return errors;
}
