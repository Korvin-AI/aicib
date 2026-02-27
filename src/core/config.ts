import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { PersonaPreset, PersonaConfig, AgentPersonaConfig } from "./persona.js";
import {
  VALID_PRESETS,
  ROLE_PRESETS,
  VALID_COMMUNICATION_STYLES,
  VALID_DECISION_MAKING,
  VALID_RISK_TOLERANCE,
  VALID_CONFLICT_APPROACHES,
} from "./persona.js";
import { isValidModelName } from "./model-router.js";

/** Any valid model name — short ("opus") or full ("claude-opus-4-6"). */
export type ModelName = string;
export type EscalationThreshold = "low" | "medium" | "high";
export type { PersonaConfig } from "./persona.js";

export interface WorkerConfig {
  model: ModelName;
  enabled?: boolean;
  mcp_servers?: string[];
}

export interface AgentConfig {
  enabled: boolean;
  model: ModelName;
  check_in_interval?: string;
  workers?: Array<Record<string, WorkerConfig>>;
  mcp_servers?: string[];
}

export interface CompanyConfig {
  name: string;
  template: string;
}

export interface SettingsConfig {
  cost_limit_daily: number;
  cost_limit_monthly: number;
  escalation_threshold: EscalationThreshold;
  auto_start_workers: boolean;
}

export interface AicibConfig {
  company: CompanyConfig;
  agents: Record<string, AgentConfig>;
  settings: SettingsConfig;
  persona?: PersonaConfig;
  extensions: Record<string, unknown>;
}

const DEFAULT_SETTINGS: SettingsConfig = {
  cost_limit_daily: 50,
  cost_limit_monthly: 500,
  escalation_threshold: "high",
  auto_start_workers: true,
};

const VALID_THRESHOLDS: EscalationThreshold[] = ["low", "medium", "high"];

// --- Config Extension Registry ---
// Features register their own config sections here.
// Extensions are validated and populated with defaults during config loading.

export interface ConfigExtension {
  /** Top-level key in the YAML config (e.g., "autonomy", "tasks") */
  key: string;
  /** Default values when the section is absent from the YAML file */
  defaults: Record<string, unknown>;
  /** Optional validator — returns an array of error messages (empty = valid) */
  validate?: (raw: unknown) => string[];
}

const configExtensions: ConfigExtension[] = [];

const RESERVED_CONFIG_KEYS = new Set(["company", "agents", "settings", "persona"]);

/**
 * Register a config extension so that a feature's config section is
 * automatically validated and populated with defaults during loadConfig().
 *
 * Example:
 *   registerConfigExtension({
 *     key: 'autonomy',
 *     defaults: { enabled: true, level: 'medium' },
 *     validate: (raw) => {
 *       const errors: string[] = [];
 *       if (raw && typeof raw === 'object' && 'level' in raw) {
 *         if (!['low','medium','high'].includes((raw as any).level)) {
 *           errors.push('autonomy.level must be low, medium, or high');
 *         }
 *       }
 *       return errors;
 *     },
 *   });
 */
export function registerConfigExtension(ext: ConfigExtension): void {
  if (RESERVED_CONFIG_KEYS.has(ext.key)) {
    throw new Error(`Config extension key "${ext.key}" is reserved`);
  }
  if (configExtensions.some((e) => e.key === ext.key)) {
    throw new Error(`Config extension key "${ext.key}" is already registered`);
  }
  configExtensions.push(ext);
}

export function getConfigPath(projectDir: string): string {
  return path.join(projectDir, "aicib.config.yaml");
}

export function configExists(projectDir: string): boolean {
  return fs.existsSync(getConfigPath(projectDir));
}

export function loadConfig(projectDir: string): AicibConfig {
  const configPath = getConfigPath(projectDir);

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. Run 'aicib init' first.`
    );
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown>;

  return validateConfig(parsed);
}

export function saveConfig(projectDir: string, config: AicibConfig): void {
  const configPath = getConfigPath(projectDir);

  // Flatten extensions to top-level YAML keys (so the YAML reads naturally)
  const { extensions, ...coreConfig } = config;
  const toSave: Record<string, unknown> = { ...coreConfig };
  if (extensions) {
    for (const [key, value] of Object.entries(extensions)) {
      toSave[key] = value;
    }
  }

  const yamlStr = yaml.dump(toSave, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  fs.writeFileSync(configPath, yamlStr, "utf-8");
}

export function validateConfig(raw: Record<string, unknown>): AicibConfig {
  const errors: string[] = [];

  // Validate company
  if (!raw.company || typeof raw.company !== "object") {
    errors.push("Missing 'company' section");
  } else {
    const company = raw.company as Record<string, unknown>;
    if (!company.name || typeof company.name !== "string") {
      errors.push("company.name must be a non-empty string");
    }
    if (!company.template || typeof company.template !== "string") {
      errors.push("company.template must be a non-empty string");
    }
  }

  // Validate agents
  if (!raw.agents || typeof raw.agents !== "object") {
    errors.push("Missing 'agents' section");
  } else {
    const agents = raw.agents as Record<string, unknown>;
    for (const [name, agentRaw] of Object.entries(agents)) {
      if (!agentRaw || typeof agentRaw !== "object") {
        errors.push(`agents.${name} must be an object`);
        continue;
      }
      const agent = agentRaw as Record<string, unknown>;

      if (
        agent.model &&
        !isValidModelName(agent.model as string)
      ) {
        errors.push(
          `agents.${name}.model "${agent.model}" is not a recognized model name. Use a short name (opus, sonnet, haiku) or a full Claude model ID (claude-opus-4-6, etc.)`
        );
      }

      if (agent.mcp_servers !== undefined) {
        if (!Array.isArray(agent.mcp_servers)) {
          errors.push(`agents.${name}.mcp_servers must be an array of strings`);
        } else {
          for (const s of agent.mcp_servers) {
            if (typeof s !== "string") {
              errors.push(`agents.${name}.mcp_servers entries must be strings`);
              break;
            }
          }
        }
      }

      if (agent.workers && Array.isArray(agent.workers)) {
        for (const workerEntry of agent.workers) {
          if (typeof workerEntry === "object" && workerEntry !== null) {
            for (const [workerName, workerRaw] of Object.entries(
              workerEntry as Record<string, unknown>
            )) {
              if (workerRaw && typeof workerRaw === "object") {
                const worker = workerRaw as Record<string, unknown>;
                if (
                  worker.model &&
                  !isValidModelName(worker.model as string)
                ) {
                  errors.push(
                    `agents.${name}.workers.${workerName}.model "${worker.model}" is not a recognized model name. Use a short name (opus, sonnet, haiku) or a full Claude model ID.`
                  );
                }
                if (worker.mcp_servers !== undefined) {
                  if (!Array.isArray(worker.mcp_servers)) {
                    errors.push(`agents.${name}.workers.${workerName}.mcp_servers must be an array of strings`);
                  } else {
                    for (const s of worker.mcp_servers) {
                      if (typeof s !== "string") {
                        errors.push(`agents.${name}.workers.${workerName}.mcp_servers entries must be strings`);
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Validate settings
  if (raw.settings && typeof raw.settings === "object") {
    const settings = raw.settings as Record<string, unknown>;
    if (
      settings.escalation_threshold &&
      !VALID_THRESHOLDS.includes(
        settings.escalation_threshold as EscalationThreshold
      )
    ) {
      errors.push(
        `settings.escalation_threshold must be one of: ${VALID_THRESHOLDS.join(", ")}`
      );
    }
    if (
      settings.cost_limit_daily !== undefined &&
      (typeof settings.cost_limit_daily !== "number" ||
        settings.cost_limit_daily < 0)
    ) {
      errors.push("settings.cost_limit_daily must be a non-negative number");
    }
    if (
      settings.cost_limit_monthly !== undefined &&
      (typeof settings.cost_limit_monthly !== "number" ||
        settings.cost_limit_monthly < 0)
    ) {
      errors.push("settings.cost_limit_monthly must be a non-negative number");
    }
  }

  // Validate persona (optional section)
  if (raw.persona && typeof raw.persona === "object") {
    const persona = raw.persona as Record<string, unknown>;
    if (
      persona.preset &&
      !VALID_PRESETS.includes(persona.preset as PersonaPreset)
    ) {
      errors.push(
        `persona.preset must be one of: ${VALID_PRESETS.join(", ")}`
      );
    }
    if (persona.overrides && typeof persona.overrides === "object") {
      for (const [agentRole, presetVal] of Object.entries(
        persona.overrides as Record<string, unknown>
      )) {
        if (!VALID_PRESETS.includes(presetVal as PersonaPreset)) {
          errors.push(
            `persona.overrides.${agentRole} must be one of: ${VALID_PRESETS.join(", ")}`
          );
        }
      }
    }

    // Validate persona.agents (Agent Persona Studio)
    if (persona.agents && typeof persona.agents === "object") {
      for (const [agentRole, agentPersonaRaw] of Object.entries(
        persona.agents as Record<string, unknown>
      )) {
        if (!agentPersonaRaw || typeof agentPersonaRaw !== "object") {
          errors.push(`persona.agents.${agentRole} must be an object`);
          continue;
        }
        const ap = agentPersonaRaw as Record<string, unknown>;

        if (ap.display_name !== undefined && typeof ap.display_name !== "string") {
          errors.push(`persona.agents.${agentRole}.display_name must be a string`);
        }

        if (ap.role_preset !== undefined) {
          if (typeof ap.role_preset !== "string") {
            errors.push(`persona.agents.${agentRole}.role_preset must be a string`);
          } else if (!/^[a-z][a-z0-9-]*$/.test(ap.role_preset)) {
            errors.push(
              `persona.agents.${agentRole}.role_preset "${ap.role_preset}" must be a valid slug (lowercase letters, numbers, and hyphens)`
            );
          }
        }

        if (ap.traits !== undefined && typeof ap.traits !== "object") {
          errors.push(`persona.agents.${agentRole}.traits must be an object`);
        } else if (ap.traits && typeof ap.traits === "object") {
          const traits = ap.traits as Record<string, unknown>;
          if (traits.communication_style !== undefined &&
            !VALID_COMMUNICATION_STYLES.includes(traits.communication_style as never)) {
            errors.push(
              `persona.agents.${agentRole}.traits.communication_style must be one of: ${VALID_COMMUNICATION_STYLES.join(", ")}`
            );
          }
          if (traits.decision_making !== undefined &&
            !VALID_DECISION_MAKING.includes(traits.decision_making as never)) {
            errors.push(
              `persona.agents.${agentRole}.traits.decision_making must be one of: ${VALID_DECISION_MAKING.join(", ")}`
            );
          }
          if (traits.risk_tolerance !== undefined &&
            !VALID_RISK_TOLERANCE.includes(traits.risk_tolerance as never)) {
            errors.push(
              `persona.agents.${agentRole}.traits.risk_tolerance must be one of: ${VALID_RISK_TOLERANCE.join(", ")}`
            );
          }
          if (traits.conflict_approach !== undefined &&
            !VALID_CONFLICT_APPROACHES.includes(traits.conflict_approach as never)) {
            errors.push(
              `persona.agents.${agentRole}.traits.conflict_approach must be one of: ${VALID_CONFLICT_APPROACHES.join(", ")}`
            );
          }
          if (traits.assertiveness !== undefined) {
            const val = Number(traits.assertiveness);
            if (!Number.isInteger(val) || val < 1 || val > 5) {
              errors.push(`persona.agents.${agentRole}.traits.assertiveness must be an integer between 1 and 5`);
            }
          }
          if (traits.creativity !== undefined) {
            const val = Number(traits.creativity);
            if (!Number.isInteger(val) || val < 1 || val > 5) {
              errors.push(`persona.agents.${agentRole}.traits.creativity must be an integer between 1 and 5`);
            }
          }
        }

        if (ap.background !== undefined) {
          if (typeof ap.background !== "object" || ap.background === null) {
            errors.push(`persona.agents.${agentRole}.background must be an object`);
          } else {
            const bg = ap.background as Record<string, unknown>;
            if (bg.industry_experience !== undefined && !Array.isArray(bg.industry_experience)) {
              errors.push(`persona.agents.${agentRole}.background.industry_experience must be an array`);
            }
            if (bg.years_experience !== undefined && typeof bg.years_experience !== "number") {
              errors.push(`persona.agents.${agentRole}.background.years_experience must be a number`);
            }
            if (bg.specialized_knowledge !== undefined && !Array.isArray(bg.specialized_knowledge)) {
              errors.push(`persona.agents.${agentRole}.background.specialized_knowledge must be an array`);
            }
            if (bg.work_history !== undefined && typeof bg.work_history !== "string") {
              errors.push(`persona.agents.${agentRole}.background.work_history must be a string`);
            }
          }
        }
      }
    }
  }

  // Validate and populate registered config extensions
  const extensions: Record<string, unknown> = {};
  for (const ext of configExtensions) {
    if (raw[ext.key] !== undefined) {
      if (ext.validate) {
        const extErrors = ext.validate(raw[ext.key]);
        errors.push(...extErrors);
      }
      extensions[ext.key] = { ...ext.defaults, ...(raw[ext.key] as Record<string, unknown>) };
    } else {
      extensions[ext.key] = { ...ext.defaults };
    }
  }

  // Preserve unrecognized top-level keys for round-trip safety
  const knownKeys = new Set(["company", "agents", "settings", "persona", ...configExtensions.map((e) => e.key)]);
  for (const [key, value] of Object.entries(raw)) {
    if (!knownKeys.has(key) && !(key in extensions)) {
      extensions[key] = value;
    }
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join("\n  - ")}`);
  }

  // Build validated config with defaults
  const company = raw.company as Record<string, unknown>;
  const settings = (raw.settings as Record<string, unknown>) || {};

  // Build persona config with default
  const rawPersona = (raw.persona as Record<string, unknown>) || {};
  const personaConfig: PersonaConfig = {
    preset: (rawPersona.preset as PersonaPreset) || "professional",
    ...(rawPersona.overrides
      ? { overrides: rawPersona.overrides as Record<string, PersonaPreset> }
      : {}),
    ...(rawPersona.agents
      ? { agents: rawPersona.agents as Record<string, AgentPersonaConfig> }
      : {}),
  };

  return {
    company: {
      name: company.name as string,
      template: company.template as string,
    },
    agents: raw.agents as Record<string, AgentConfig>,
    settings: {
      cost_limit_daily:
        (settings.cost_limit_daily as number) ?? DEFAULT_SETTINGS.cost_limit_daily,
      cost_limit_monthly:
        (settings.cost_limit_monthly as number) ??
        DEFAULT_SETTINGS.cost_limit_monthly,
      escalation_threshold:
        (settings.escalation_threshold as EscalationThreshold) ??
        DEFAULT_SETTINGS.escalation_threshold,
      auto_start_workers:
        (settings.auto_start_workers as boolean) ??
        DEFAULT_SETTINGS.auto_start_workers,
    },
    persona: personaConfig,
    extensions,
  };
}

export function getAgentModel(
  config: AicibConfig,
  agentRole: string
): ModelName {
  // Check top-level agents
  if (config.agents[agentRole]) {
    return config.agents[agentRole].model;
  }

  // Check workers
  for (const agent of Object.values(config.agents)) {
    if (agent.workers) {
      for (const workerEntry of agent.workers) {
        for (const [workerName, workerConfig] of Object.entries(workerEntry)) {
          if (workerName === agentRole) {
            return workerConfig.model;
          }
        }
      }
    }
  }

  return "sonnet"; // default fallback
}

export function listAllAgents(
  config: AicibConfig
): Array<{ role: string; model: ModelName; department: string; enabled: boolean }> {
  const agents: Array<{
    role: string;
    model: ModelName;
    department: string;
    enabled: boolean;
  }> = [];

  for (const [role, agentConfig] of Object.entries(config.agents)) {
    agents.push({
      role,
      model: agentConfig.model,
      department: role,
      enabled: agentConfig.enabled ?? true,
    });

    if (agentConfig.workers) {
      for (const workerEntry of agentConfig.workers) {
        for (const [workerName, workerConfig] of Object.entries(workerEntry)) {
          agents.push({
            role: workerName,
            model: workerConfig.model,
            department: role,
            enabled: workerConfig.enabled ?? true,
          });
        }
      }
    }
  }

  return agents;
}
