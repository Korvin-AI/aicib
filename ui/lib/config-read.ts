import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getProjectDir } from "@/lib/config";

export interface CompanyConfig {
  name: string;
  template: string;
}

export interface AppSettingsConfig {
  costLimitDaily: number;
  costLimitMonthly: number;
}

export interface AgentConfig {
  role: string;
  model: string;
  department: string;
  enabled: boolean;
  displayName?: string;
}

export interface AppConfigSnapshot {
  company: CompanyConfig;
  settings: AppSettingsConfig;
  agents: AgentConfig[];
  projectDir: string;
  exists: boolean;
  raw: string;
}

type UnknownRecord = Record<string, unknown>;
type ParseYamlFn = (input: string) => unknown;

const require = createRequire(import.meta.url);
let parseYamlFn: ParseYamlFn | null = null;

function getYamlParser(): ParseYamlFn {
  if (parseYamlFn) return parseYamlFn;

  try {
    const jsYamlModule = require("js-yaml") as { load?: ParseYamlFn };
    if (typeof jsYamlModule.load === "function") {
      parseYamlFn = jsYamlModule.load;
      return parseYamlFn;
    }
  } catch {
    // Leave parser unset.
  }

  parseYamlFn = () => ({});
  return parseYamlFn;
}

function asRecord(value: unknown): UnknownRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseCompany(config: UnknownRecord): CompanyConfig {
  const company = asRecord(config.company);
  const name = asString(company?.name ?? config.name) || "AICIB";
  const template = asString(company?.template ?? config.template) || "saas-startup";
  return { name, template };
}

function parseSettings(config: UnknownRecord): AppSettingsConfig {
  const settings = asRecord(config.settings);
  const costLimitDaily = asNumber(settings?.cost_limit_daily) ?? 50;
  const costLimitMonthly = asNumber(settings?.cost_limit_monthly) ?? 500;
  return { costLimitDaily, costLimitMonthly };
}

function parsePersonaDisplayNames(config: UnknownRecord): Map<string, string> {
  const persona = asRecord(config.persona);
  const personaAgents = asRecord(persona?.agents);
  const displayNames = new Map<string, string>();

  if (!personaAgents) return displayNames;

  for (const [role, rawSettings] of Object.entries(personaAgents)) {
    const settings = asRecord(rawSettings);
    const displayName = asString(settings?.display_name);
    if (!displayName) continue;
    displayNames.set(role, displayName);
  }

  return displayNames;
}

function parseWorkers(rawWorkers: unknown): Array<{ role: string; model: string }> {
  const workers: Array<{ role: string; model: string }> = [];

  const appendWorker = (role: string, workerSettingsRaw: unknown) => {
    if (!role) return;
    const workerSettings = asRecord(workerSettingsRaw);
    const model = asString(workerSettings?.model) || "sonnet";
    workers.push({ role, model });
  };

  if (Array.isArray(rawWorkers)) {
    for (const worker of rawWorkers) {
      if (typeof worker === "string") {
        appendWorker(worker, null);
        continue;
      }

      const workerMap = asRecord(worker);
      if (!workerMap) continue;
      for (const [role, workerSettings] of Object.entries(workerMap)) {
        appendWorker(role, workerSettings);
      }
    }
    return workers;
  }

  const workerObject = asRecord(rawWorkers);
  if (!workerObject) return workers;

  for (const [role, workerSettings] of Object.entries(workerObject)) {
    appendWorker(role, workerSettings);
  }

  return workers;
}

function parseAgents(config: UnknownRecord): AgentConfig[] {
  const agentsRoot = asRecord(config.agents);
  if (!agentsRoot) return [];

  const personaNames = parsePersonaDisplayNames(config);
  const seenRoles = new Set<string>();
  const agents: AgentConfig[] = [];

  const appendAgent = (
    role: string,
    model: string,
    enabled: boolean,
    department: string
  ) => {
    if (!role || seenRoles.has(role)) return;
    seenRoles.add(role);
    agents.push({
      role,
      model,
      enabled,
      department,
      displayName: personaNames.get(role),
    });
  };

  for (const [role, rawAgentConfig] of Object.entries(agentsRoot)) {
    const agentConfig = asRecord(rawAgentConfig);
    const model = asString(agentConfig?.model) || "sonnet";
    const enabled = asBoolean(agentConfig?.enabled) ?? true;
    appendAgent(role, model, enabled, role);

    const workers = parseWorkers(agentConfig?.workers);
    for (const worker of workers) {
      appendAgent(worker.role, worker.model, true, role);
    }
  }

  return agents;
}

function parseConfig(raw: string): UnknownRecord {
  try {
    const parsed = getYamlParser()(raw);
    return asRecord(parsed) ?? {};
  } catch (error) {
    console.error("Failed to parse aicib.config.yaml", error);
    return {};
  }
}

export function readAppConfig(): AppConfigSnapshot {
  const projectDir = getProjectDir();
  const configPath = path.join(projectDir, "aicib.config.yaml");

  if (!fs.existsSync(configPath)) {
    return {
      company: { name: "AICIB", template: "saas-startup" },
      settings: { costLimitDaily: 50, costLimitMonthly: 500 },
      agents: [],
      projectDir,
      exists: false,
      raw: "",
    };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const config = parseConfig(raw);

  return {
    company: parseCompany(config),
    settings: parseSettings(config),
    agents: parseAgents(config),
    projectDir,
    exists: true,
    raw,
  };
}
