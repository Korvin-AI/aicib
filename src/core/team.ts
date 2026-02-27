import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { AicibConfig, ModelName } from "./config.js";
import {
  loadAgentDefinitions,
  renderAgentContent,
  type AgentDefinition,
} from "./agents.js";
import { CostTracker } from "./cost-tracker.js";
import chalk from "chalk";

export interface RunningAgent {
  role: string;
  model: ModelName;
  status: "starting" | "running" | "idle" | "stopped" | "error";
  process?: ChildProcess;
  pid?: number;
}

export interface TeamState {
  sessionId: string;
  teamName: string;
  agents: Map<string, RunningAgent>;
  config: AicibConfig;
  costTracker: CostTracker;
}

function generateSessionId(): string {
  return `aicib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTeamState(
  projectDir: string,
  config: AicibConfig
): TeamState {
  const sessionId = generateSessionId();
  const costTracker = new CostTracker(projectDir);
  costTracker.createSession(sessionId);

  return {
    sessionId,
    teamName: config.company.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    agents: new Map(),
    config,
    costTracker,
  };
}

export function getAgentsDir(projectDir: string): string {
  return path.join(projectDir, ".claude", "agents");
}

export function ensureAgentsDir(projectDir: string): string {
  const agentsDir = getAgentsDir(projectDir);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  return agentsDir;
}

export function installAgentDefinitions(
  projectDir: string,
  templateDir: string,
  companyName: string
): void {
  const agentsDir = ensureAgentsDir(projectDir);
  const templateAgentsDir = path.join(templateDir, "agents");

  if (!fs.existsSync(templateAgentsDir)) {
    throw new Error(`Template agents directory not found: ${templateAgentsDir}`);
  }

  const files = fs.readdirSync(templateAgentsDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const src = path.join(templateAgentsDir, file);
    const dest = path.join(agentsDir, file);
    let content = fs.readFileSync(src, "utf-8");
    content = renderAgentContent(content, { company_name: companyName });
    fs.writeFileSync(dest, content, "utf-8");
  }
}

/** @deprecated Replaced by agent-runner.ts startCEOSession(). Kept for backwards compatibility. */
export function buildStartCommand(
  projectDir: string,
  config: AicibConfig
): string {
  // Generate the Claude Code command to create and start the team
  const teamName = config.company.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  const agentsDir = getAgentsDir(projectDir);
  const agents = loadAgentDefinitions(agentsDir);

  const ceoAgent = agents.get("ceo");
  if (!ceoAgent) {
    throw new Error("CEO agent definition not found. Run 'aicib init' first.");
  }

  // Build the prompt that will be sent to Claude Code to bootstrap the team
  const enabledAgents = getEnabledAgents(config);
  const teamMembers = enabledAgents
    .filter((a) => a.role !== "ceo")
    .filter((a) => !a.isWorker)
    .map((a) => `- ${a.role} (${a.title}, model: ${a.model})`)
    .join("\n");

  const workers = enabledAgents
    .filter((a) => a.isWorker)
    .map((a) => `- ${a.role} (${a.title}, managed by: ${a.reportsTo}, model: ${a.model})`)
    .join("\n");

  return `You are bootstrapping an AI company called "${config.company.name}".

Create a team using TeamCreate with team_name "${teamName}".

The CEO is the team lead. Spawn the following teammates:
${teamMembers}

These workers will be spawned on-demand by their department heads using the Task tool:
${workers}

Company settings:
- Cost limit (daily): $${config.settings.cost_limit_daily}
- Cost limit (monthly): $${config.settings.cost_limit_monthly}
- Escalation threshold: ${config.settings.escalation_threshold}
- Auto-start workers: ${config.settings.auto_start_workers}

Start the team and wait for directives from the human founder.`;
}

interface EnabledAgent {
  role: string;
  title: string;
  model: ModelName;
  reportsTo: string;
  isWorker: boolean;
}

function getEnabledAgents(config: AicibConfig): EnabledAgent[] {
  const agents: EnabledAgent[] = [];
  const roleTitles: Record<string, string> = {
    ceo: "Chief Executive Officer",
    cto: "Chief Technology Officer",
    cfo: "Chief Financial Officer",
    cmo: "Chief Marketing Officer",
    "backend-engineer": "Backend Engineer",
    "frontend-engineer": "Frontend Engineer",
    "financial-analyst": "Financial Analyst",
    "content-writer": "Content Writer",
  };

  for (const [role, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.enabled) continue;

    agents.push({
      role,
      title: roleTitles[role] || role,
      model: agentConfig.model,
      reportsTo: role === "ceo" ? "human-founder" : "ceo",
      isWorker: false,
    });

    if (agentConfig.workers) {
      for (const workerEntry of agentConfig.workers) {
        for (const [workerName, workerConfig] of Object.entries(workerEntry)) {
          if (workerConfig.enabled === false) continue;
          agents.push({
            role: workerName,
            title: roleTitles[workerName] || workerName,
            model: workerConfig.model,
            reportsTo: role,
            isWorker: true,
          });
        }
      }
    }
  }

  return agents;
}

/** @deprecated Replaced by agent-runner.ts sendBrief(). Kept for backwards compatibility. */
export function buildBriefPrompt(brief: string, config: AicibConfig): string {
  return `DIRECTIVE FROM HUMAN FOUNDER:

${brief}

---
Process this directive according to your CEO role. Decompose into department-level objectives and delegate to your team. Report back with your plan before executing.`;
}

export function getTeamStatusSummary(
  costTracker: CostTracker,
  config: AicibConfig
): string {
  const statuses = costTracker.getAgentStatuses();
  const todayCost = costTracker.getTotalCostToday();
  const monthCost = costTracker.getTotalCostThisMonth();

  let output = `\n  Company: ${config.company.name}\n`;
  output += `  Template: ${config.company.template}\n\n`;

  if (statuses.length === 0) {
    output += "  No agents have been started yet.\n";
  } else {
    output += "  Agents:\n";
    for (const agent of statuses) {
      const statusIcon =
        agent.status === "running"
          ? chalk.green("\u25CF")
          : agent.status === "idle"
            ? chalk.yellow("\u25CB")
            : agent.status === "error"
              ? chalk.red("\u2717")
              : chalk.dim("\u00B7");
      const roleName = chalk.hex("#FFB300")(agent.agent_role); // gold for all roles in summary
      output += `    ${statusIcon} ${roleName.padEnd(20)} ${agent.status.padEnd(10)}`;
      if (agent.current_task) {
        output += ` \u2192 ${agent.current_task}`;
      }
      output += "\n";
    }
  }

  // Cost color based on proximity to limit
  const dailyCostColor =
    todayCost >= config.settings.cost_limit_daily * 0.8
      ? chalk.red
      : todayCost >= config.settings.cost_limit_daily * 0.5
        ? chalk.yellow
        : chalk.green;
  const monthlyCostColor =
    monthCost >= config.settings.cost_limit_monthly * 0.8
      ? chalk.red
      : monthCost >= config.settings.cost_limit_monthly * 0.5
        ? chalk.yellow
        : chalk.green;

  output += `\n  Cost today:      ${dailyCostColor(`$${todayCost.toFixed(2)}`)} / $${config.settings.cost_limit_daily}`;
  output += `\n  Cost this month:  ${monthlyCostColor(`$${monthCost.toFixed(2)}`)} / $${config.settings.cost_limit_monthly}\n`;

  return output;
}
