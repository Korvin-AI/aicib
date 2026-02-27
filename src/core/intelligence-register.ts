/**
 * Hook registration for the Agent Intelligence features
 * (Autonomy Matrix, Escalation Protocol, Skills System).
 *
 * Importing this module (side-effect import) registers:
 * - Config extensions: `autonomy:`, `escalation:`, `skills:` sections
 * - Database tables: escalation_events
 * - Context providers: autonomy-rules, escalation-chain, agent-skills
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import { registerContextProvider } from "./agent-runner.js";
import {
  AUTONOMY_CONFIG_DEFAULTS,
  validateAutonomyConfig,
  resolveAutonomyLevel,
  formatAutonomyContext,
  type AutonomyConfig,
} from "./autonomy-matrix.js";
import {
  ESCALATION_CONFIG_DEFAULTS,
  validateEscalationConfig,
  formatFullEscalationContext,
  type EscalationConfig,
} from "./escalation.js";
import {
  SKILLS_CONFIG_DEFAULTS,
  validateSkillsConfig,
  resolveAgentSkills,
  resolveSkills,
  formatSkillsContext,
  type SkillsConfig,
} from "./skills.js";
import { loadAgentDefinitions } from "./agents.js";
import { getAgentsDir } from "./team.js";

// ============================================
// CONFIG EXTENSIONS
// ============================================

registerConfigExtension({
  key: "autonomy",
  defaults: { ...AUTONOMY_CONFIG_DEFAULTS },
  validate: validateAutonomyConfig,
});

registerConfigExtension({
  key: "escalation",
  defaults: { ...ESCALATION_CONFIG_DEFAULTS },
  validate: validateEscalationConfig,
});

registerConfigExtension({
  key: "skills",
  defaults: { ...SKILLS_CONFIG_DEFAULTS },
  validate: validateSkillsConfig,
});

// ============================================
// DATABASE TABLES
// ============================================

// Scaffolding for Phase 3 Session 6 — message handler will detect ESCALATION markers and insert events
registerTable({
  name: "escalation_events",
  createSQL: `CREATE TABLE IF NOT EXISTS escalation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    step TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    category TEXT NOT NULL DEFAULT 'general',
    reason TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolution TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_esc_session ON escalation_events(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_esc_from ON escalation_events(from_agent)",
    "CREATE INDEX IF NOT EXISTS idx_esc_resolved ON escalation_events(resolved)",
    "CREATE INDEX IF NOT EXISTS idx_esc_created ON escalation_events(created_at)",
  ],
});

// ============================================
// CONTEXT PROVIDERS
// ============================================

/**
 * Autonomy context provider.
 * Injects a structured matrix of what each agent can/cannot decide
 * into the CEO's prompt for better delegation awareness.
 */
registerContextProvider("autonomy-rules", (config, projectDir) => {
  const autonomyConfig = config.extensions?.autonomy as
    | AutonomyConfig
    | undefined;
  if (!autonomyConfig?.enabled) return "";

  const agentsDir = getAgentsDir(projectDir);
  const agents = loadAgentDefinitions(agentsDir);

  let context = `## Autonomy & Decision-Making Matrix\n\n`;
  context += `Each agent has a structured autonomy level governing what they can decide alone vs. what requires escalation:\n\n`;

  // Only show CEO + direct reports (C-suite). Workers are managed by their department heads.
  for (const [role, agent] of agents) {
    if (agent.frontmatter.reports_to !== "ceo" && role !== "ceo") continue;

    const level = resolveAutonomyLevel(
      role,
      agent.frontmatter.autonomy_level,
      autonomyConfig
    );
    context += `### ${agent.frontmatter.title} (${role})\n`;
    context += formatAutonomyContext(role, level, autonomyConfig);
    context += "\n";
  }

  return context;
});

/**
 * Escalation context provider.
 * Injects the 6-step escalation protocol into the CEO's prompt
 * so it can instruct agents on the proper escalation path.
 */
registerContextProvider("escalation-chain", (config, projectDir) => {
  const escalationConfig = config.extensions?.escalation as
    | EscalationConfig
    | undefined;
  if (!escalationConfig?.enabled) return "";

  let context = `## Error Handling & Escalation Protocol\n\n`;
  context += `All agents follow a structured escalation chain when encountering errors or blockers.\n\n`;
  context += formatFullEscalationContext(projectDir, config, escalationConfig);

  return context;
});

/**
 * Skills context provider.
 * Injects abbreviated skill descriptions into the CEO's prompt
 * so it knows which agent is best equipped for which type of work.
 */
registerContextProvider("agent-skills", (config, projectDir) => {
  const skillsConfig = config.extensions?.skills as
    | SkillsConfig
    | undefined;
  if (!skillsConfig?.enabled) return "";

  const agentsDir = getAgentsDir(projectDir);
  const agents = loadAgentDefinitions(agentsDir);

  let context = `## Agent Skills & Capabilities\n\n`;
  context += `Each agent has specialized skills. Use this when delegating to assign work to the best-equipped agent:\n\n`;

  // Only show CEO + direct reports (C-suite). Workers are managed by their department heads.
  for (const [role, agent] of agents) {
    if (agent.frontmatter.reports_to !== "ceo" && role !== "ceo") continue;

    const skillNames = resolveAgentSkills(
      role,
      agent.frontmatter.skills,
      skillsConfig
    );
    const skills = resolveSkills(skillNames, skillsConfig);

    if (skills.length > 0) {
      context += `### ${agent.frontmatter.title} (${role})\n`;
      context += formatSkillsContext(role, skills);
      context += "\n";
    }
  }

  return context;
});
