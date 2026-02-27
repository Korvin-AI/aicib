import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import inquirer from "inquirer";
import { loadConfig, saveConfig } from "../core/config.js";
import { getTemplatePath } from "../core/agents.js";
import { getAgentsDir } from "../core/team.js";
import { listAllAgents } from "../core/config.js";
import {
  ROLE_PRESETS,
  VALID_COMMUNICATION_STYLES,
  VALID_DECISION_MAKING,
  VALID_RISK_TOLERANCE,
  VALID_CONFLICT_APPROACHES,
  validateAgentPersona,
  type AgentPersonaConfig,
  type CommunicationStyle,
  type DecisionMaking,
  type RiskTolerance,
  type ConflictApproach,
  type PersonalityTraits,
} from "../core/persona.js";
import { listRolePresets } from "../core/persona-studio.js";
import { compileTraits, compileBackground } from "../core/persona-studio.js";
import { header, createTable, agentColor } from "./ui.js";

// ── Helpers ───────────────────────────────────────────────────────

interface AgentOptions {
  dir: string;
}

function resolveProjectDir(dir: string): string {
  return path.resolve(dir);
}

function getPersonaForRole(
  config: ReturnType<typeof loadConfig>,
  role: string
): AgentPersonaConfig | undefined {
  return config.persona?.agents?.[role];
}

function traitsSummary(traits: PersonalityTraits): string {
  const parts: string[] = [];
  if (traits.communication_style) parts.push(traits.communication_style);
  if (traits.decision_making) parts.push(traits.decision_making);
  if (traits.risk_tolerance) parts.push(`risk:${traits.risk_tolerance}`);
  if (traits.assertiveness !== undefined) parts.push(`assert:${traits.assertiveness}`);
  if (traits.creativity !== undefined) parts.push(`creat:${traits.creativity}`);
  if (traits.conflict_approach) parts.push(traits.conflict_approach);
  return parts.length > 0 ? parts.join(", ") : chalk.dim("none");
}

// ── Dashboard (default `aicib agent`) ────────────────────────────

export async function agentDashboardCommand(options: AgentOptions): Promise<void> {
  await agentListCommand(options);
}

// ── List ─────────────────────────────────────────────────────────

export async function agentListCommand(options: AgentOptions): Promise<void> {
  const projectDir = resolveProjectDir(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  console.log(header("Agent Persona Studio"));

  const allAgents = listAllAgents(config);
  const agentPersonas = config.persona?.agents || {};

  const table = createTable(
    ["Agent", "Display Name", "Global Preset", "Role Preset", "Traits"],
    [20, 16, 14, 22, 30]
  );

  for (const agent of allAgents) {
    const persona = agentPersonas[agent.role];
    const globalPreset = config.persona?.overrides?.[agent.role] || config.persona?.preset || "professional";

    table.push([
      agentColor(agent.role)(agent.role),
      persona?.display_name || chalk.dim("—"),
      globalPreset,
      persona?.role_preset || chalk.dim("—"),
      persona?.traits ? traitsSummary(persona.traits) : chalk.dim("—"),
    ]);
  }

  console.log(table.toString());
  console.log(
    chalk.dim(`\n  Use ${chalk.white("aicib agent show <role>")} for details or ${chalk.white("aicib agent customize <role>")} to configure.\n`)
  );
}

// ── Show ─────────────────────────────────────────────────────────

export async function agentShowCommand(
  role: string,
  options: AgentOptions
): Promise<void> {
  const projectDir = resolveProjectDir(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  const persona = getPersonaForRole(config, role);

  console.log(header(`Agent Persona — ${role}`));

  // Basic info
  const globalPreset = config.persona?.overrides?.[role] || config.persona?.preset || "professional";
  console.log(`  ${chalk.bold("Role:")}           ${agentColor(role)(role)}`);
  console.log(`  ${chalk.bold("Display Name:")}   ${persona?.display_name || chalk.dim("not set")}`);
  console.log(`  ${chalk.bold("Global Preset:")}  ${globalPreset}`);
  console.log(`  ${chalk.bold("Role Preset:")}    ${persona?.role_preset || chalk.dim("not set")}`);
  console.log();

  // Traits
  if (persona?.traits) {
    console.log(chalk.bold("  Personality Traits:"));
    const t = persona.traits;
    if (t.communication_style) console.log(`    Communication: ${t.communication_style}`);
    if (t.decision_making) console.log(`    Decision Making: ${t.decision_making}`);
    if (t.risk_tolerance) console.log(`    Risk Tolerance: ${t.risk_tolerance}`);
    if (t.assertiveness !== undefined) console.log(`    Assertiveness: ${t.assertiveness}/5`);
    if (t.creativity !== undefined) console.log(`    Creativity: ${t.creativity}/5`);
    if (t.conflict_approach) console.log(`    Conflict Approach: ${t.conflict_approach}`);
    console.log();
  }

  // Background
  if (persona?.background) {
    console.log(chalk.bold("  Professional Background:"));
    const b = persona.background;
    if (b.years_experience !== undefined) console.log(`    Years: ${b.years_experience}`);
    if (b.industry_experience?.length) console.log(`    Industries: ${b.industry_experience.join(", ")}`);
    if (b.specialized_knowledge?.length) console.log(`    Specializations: ${b.specialized_knowledge.join(", ")}`);
    if (b.work_history) console.log(`    History: ${b.work_history}`);
    console.log();
  }

  // Preview compiled content
  if (persona) {
    console.log(chalk.bold("  Compiled Persona Preview:"));
    console.log(chalk.dim("  ─────────────────────────────────────────"));

    if (persona.role_preset) {
      const templateDir = getTemplatePath(config.company.template);
      try {
        const presets = listRolePresets(templateDir, role);
        const preset = presets.find((p) => p.name === persona.role_preset);
        if (preset) {
          console.log(chalk.cyan(`\n  ## Role Archetype (${preset.displayName})`));
          for (const line of preset.content.split("\n").slice(0, 5)) {
            console.log(`  ${chalk.dim(line)}`);
          }
          if (preset.content.split("\n").length > 5) {
            console.log(chalk.dim("  ..."));
          }
        }
      } catch (err) {
        console.warn(
          `Warning: Could not load preset for preview: ${(err as Error).message}`
        );
      }
    }

    if (persona.traits) {
      const traitsContent = compileTraits(persona.traits);
      if (traitsContent) {
        console.log(chalk.cyan("\n  ## Personality Calibration"));
        for (const line of traitsContent.split("\n").slice(0, 4)) {
          console.log(`  ${chalk.dim(line)}`);
        }
        if (traitsContent.split("\n").length > 4) {
          console.log(chalk.dim("  ..."));
        }
      }
    }

    if (persona.background) {
      const bgContent = compileBackground(persona.background);
      if (bgContent) {
        console.log(chalk.cyan("\n  ## Professional Background"));
        for (const line of bgContent.split("\n").slice(0, 3)) {
          console.log(`  ${chalk.dim(line)}`);
        }
      }
    }

    console.log();
  } else {
    console.log(chalk.dim("  No persona studio configuration for this agent."));
    console.log(chalk.dim(`  Run ${chalk.white(`aicib agent customize ${role}`)} to set one up.\n`));
  }
}

// ── Edit ─────────────────────────────────────────────────────────

export async function agentEditCommand(
  role: string,
  options: AgentOptions
): Promise<void> {
  const projectDir = resolveProjectDir(options.dir);
  const agentsDir = getAgentsDir(projectDir);
  const filePath = path.join(agentsDir, `${role}.md`);

  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`  Error: Agent file not found at ${filePath}`));
    console.error(chalk.dim(`  Available agents are in ${agentsDir}\n`));
    process.exit(1);
  }

  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const [editorCmd, ...editorArgs] = editor.split(/\s+/);

  console.log(chalk.dim(`  Opening ${filePath} in ${editor}...`));

  try {
    execFileSync(editorCmd, [...editorArgs, filePath], { stdio: "inherit" });
  } catch {
    console.error(chalk.red(`  Error: Failed to open editor "${editor}".`));
    process.exit(1);
  }

  // Validate after save
  const content = fs.readFileSync(filePath, "utf-8");
  const result = validateAgentPersona(content);

  if (result.valid) {
    console.log(chalk.green("\n  Agent persona validated successfully.\n"));
  } else {
    console.log(chalk.yellow("\n  Validation warnings:"));
    for (const err of result.errors) {
      console.log(chalk.yellow(`    - ${err}`));
    }
    console.log();
  }
}

// ── Customize ────────────────────────────────────────────────────

export async function agentCustomizeCommand(
  role: string | undefined,
  options: AgentOptions
): Promise<void> {
  const projectDir = resolveProjectDir(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  // If no role specified, pick one
  if (!role) {
    const allAgents = listAllAgents(config);
    const { selectedRole } = await inquirer.prompt([{
      type: "list",
      name: "selectedRole",
      message: "Which agent do you want to customize?",
      choices: allAgents.map((a) => ({
        name: `${a.role}${config.persona?.agents?.[a.role]?.display_name ? ` (${config.persona.agents[a.role].display_name})` : ""}`,
        value: a.role,
      })),
    }]);
    role = selectedRole;
  }

  console.log(header(`Customize — ${role}`));

  // Ensure persona.agents exists in config
  if (!config.persona) {
    config.persona = { preset: "professional" };
  }
  if (!config.persona.agents) {
    config.persona.agents = {};
  }
  if (!config.persona.agents[role!]) {
    config.persona.agents[role!] = {};
  }

  const persona = config.persona.agents[role!];

  let done = false;
  while (!done) {
    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: `What would you like to configure for ${role}?`,
      choices: [
        {
          name: `Set display name ${persona.display_name ? chalk.dim(`(current: ${persona.display_name})`) : ""}`,
          value: "display_name",
        },
        {
          name: `Choose role preset ${persona.role_preset ? chalk.dim(`(current: ${persona.role_preset})`) : ""}`,
          value: "role_preset",
        },
        { name: "Configure personality traits", value: "traits" },
        { name: "Set professional background", value: "background" },
        { name: "View current configuration", value: "view" },
        { name: chalk.dim("Done"), value: "done" },
      ],
    }]);

    switch (action) {
      case "display_name": {
        const { name } = await inquirer.prompt([{
          type: "input",
          name: "name",
          message: "Display name for this agent (e.g., Sarah, Marcus):",
          default: persona.display_name || "",
        }]);
        if (name.trim()) {
          persona.display_name = name.trim();
          saveConfig(projectDir, config);
          console.log(chalk.green(`  Updated display name to "${persona.display_name}"\n`));
        }
        break;
      }

      case "role_preset": {
        const templateDir = getTemplatePath(config.company.template);
        const presets = listRolePresets(templateDir, role!);

        if (presets.length === 0) {
          // Check ROLE_PRESETS constant for known presets
          const knownPresets = ROLE_PRESETS[role!];
          if (knownPresets && knownPresets.length > 0) {
            console.log(chalk.yellow(`  No preset files found for ${role}, but known presets: ${knownPresets.join(", ")}`));
          } else {
            console.log(chalk.dim(`  No role presets available for ${role}.\n`));
          }
          break;
        }

        const { preset } = await inquirer.prompt([{
          type: "list",
          name: "preset",
          message: `Choose a role preset for ${role}:`,
          choices: [
            ...presets.map((p) => ({
              name: `${p.displayName} — ${p.description}`,
              value: p.name,
            })),
            { name: chalk.dim("Skip (remove preset)"), value: "__skip__" },
          ],
        }]);

        if (preset === "__skip__") {
          delete persona.role_preset;
          saveConfig(projectDir, config);
          console.log(chalk.dim("  Role preset removed.\n"));
        } else {
          persona.role_preset = preset;
          saveConfig(projectDir, config);
          console.log(chalk.green(`  Set role preset to "${preset}"\n`));
        }
        break;
      }

      case "traits": {
        if (!persona.traits) {
          persona.traits = {};
        }

        const { traitAction } = await inquirer.prompt([{
          type: "list",
          name: "traitAction",
          message: "Which trait to configure?",
          choices: [
            {
              name: `Communication style ${persona.traits.communication_style ? chalk.dim(`(${persona.traits.communication_style})`) : ""}`,
              value: "communication_style",
            },
            {
              name: `Decision making ${persona.traits.decision_making ? chalk.dim(`(${persona.traits.decision_making})`) : ""}`,
              value: "decision_making",
            },
            {
              name: `Risk tolerance ${persona.traits.risk_tolerance ? chalk.dim(`(${persona.traits.risk_tolerance})`) : ""}`,
              value: "risk_tolerance",
            },
            {
              name: `Assertiveness ${persona.traits.assertiveness !== undefined ? chalk.dim(`(${persona.traits.assertiveness}/5)`) : ""}`,
              value: "assertiveness",
            },
            {
              name: `Creativity ${persona.traits.creativity !== undefined ? chalk.dim(`(${persona.traits.creativity}/5)`) : ""}`,
              value: "creativity",
            },
            {
              name: `Conflict approach ${persona.traits.conflict_approach ? chalk.dim(`(${persona.traits.conflict_approach})`) : ""}`,
              value: "conflict_approach",
            },
            { name: chalk.dim("Back"), value: "back" },
          ],
        }]);

        if (traitAction === "back") break;

        if (traitAction === "communication_style") {
          const { value } = await inquirer.prompt([{
            type: "list",
            name: "value",
            message: "Communication style:",
            choices: VALID_COMMUNICATION_STYLES.map((s) => ({ name: s, value: s })),
            default: persona.traits.communication_style,
          }]);
          persona.traits.communication_style = value as CommunicationStyle;
        } else if (traitAction === "decision_making") {
          const { value } = await inquirer.prompt([{
            type: "list",
            name: "value",
            message: "Decision making approach:",
            choices: VALID_DECISION_MAKING.map((s) => ({ name: s, value: s })),
            default: persona.traits.decision_making,
          }]);
          persona.traits.decision_making = value as DecisionMaking;
        } else if (traitAction === "risk_tolerance") {
          const { value } = await inquirer.prompt([{
            type: "list",
            name: "value",
            message: "Risk tolerance:",
            choices: VALID_RISK_TOLERANCE.map((s) => ({ name: s, value: s })),
            default: persona.traits.risk_tolerance,
          }]);
          persona.traits.risk_tolerance = value as RiskTolerance;
        } else if (traitAction === "assertiveness") {
          const { value } = await inquirer.prompt([{
            type: "list",
            name: "value",
            message: "Assertiveness level:",
            choices: [1, 2, 3, 4, 5].map((n) => ({
              name: `${n} — ${n === 1 ? "Very deferential" : n === 2 ? "Somewhat reserved" : n === 3 ? "Moderate" : n === 4 ? "Quite assertive" : "Extremely assertive"}`,
              value: n,
            })),
            default: persona.traits.assertiveness,
          }]);
          persona.traits.assertiveness = value;
        } else if (traitAction === "creativity") {
          const { value } = await inquirer.prompt([{
            type: "list",
            name: "value",
            message: "Creativity level:",
            choices: [1, 2, 3, 4, 5].map((n) => ({
              name: `${n} — ${n === 1 ? "Very conventional" : n === 2 ? "Mostly traditional" : n === 3 ? "Balanced" : n === 4 ? "Actively creative" : "Highly unconventional"}`,
              value: n,
            })),
            default: persona.traits.creativity,
          }]);
          persona.traits.creativity = value;
        } else if (traitAction === "conflict_approach") {
          const { value } = await inquirer.prompt([{
            type: "list",
            name: "value",
            message: "Conflict approach:",
            choices: VALID_CONFLICT_APPROACHES.map((s) => ({ name: s, value: s })),
            default: persona.traits.conflict_approach,
          }]);
          persona.traits.conflict_approach = value as ConflictApproach;
        }

        saveConfig(projectDir, config);
        console.log(chalk.green("  Traits updated.\n"));
        break;
      }

      case "background": {
        if (!persona.background) {
          persona.background = {};
        }

        const { bgAction } = await inquirer.prompt([{
          type: "list",
          name: "bgAction",
          message: "Which background field?",
          choices: [
            {
              name: `Years experience ${persona.background.years_experience !== undefined ? chalk.dim(`(${persona.background.years_experience})`) : ""}`,
              value: "years",
            },
            {
              name: `Industry experience ${persona.background.industry_experience?.length ? chalk.dim(`(${persona.background.industry_experience.join(", ")})`) : ""}`,
              value: "industries",
            },
            {
              name: `Specialized knowledge ${persona.background.specialized_knowledge?.length ? chalk.dim(`(${persona.background.specialized_knowledge.join(", ")})`) : ""}`,
              value: "knowledge",
            },
            {
              name: `Work history ${persona.background.work_history ? chalk.dim("(set)") : ""}`,
              value: "history",
            },
            { name: chalk.dim("Back"), value: "back" },
          ],
        }]);

        if (bgAction === "back") break;

        if (bgAction === "years") {
          const { value } = await inquirer.prompt([{
            type: "number",
            name: "value",
            message: "Years of experience:",
            default: persona.background.years_experience,
          }]);
          if (value !== undefined && !isNaN(value)) {
            persona.background.years_experience = value;
          }
        } else if (bgAction === "industries") {
          const { value } = await inquirer.prompt([{
            type: "input",
            name: "value",
            message: "Industry experience (comma-separated, e.g., fintech, saas, healthcare):",
            default: persona.background.industry_experience?.join(", ") || "",
          }]);
          if (value.trim()) {
            persona.background.industry_experience = value.split(",").map((s: string) => s.trim()).filter(Boolean);
          }
        } else if (bgAction === "knowledge") {
          const { value } = await inquirer.prompt([{
            type: "input",
            name: "value",
            message: "Specialized knowledge (comma-separated, e.g., product-strategy, go-to-market):",
            default: persona.background.specialized_knowledge?.join(", ") || "",
          }]);
          if (value.trim()) {
            persona.background.specialized_knowledge = value.split(",").map((s: string) => s.trim()).filter(Boolean);
          }
        } else if (bgAction === "history") {
          const { value } = await inquirer.prompt([{
            type: "input",
            name: "value",
            message: "Work history summary (1-2 sentences):",
            default: persona.background.work_history || "",
          }]);
          if (value.trim()) {
            persona.background.work_history = value.trim();
          }
        }

        saveConfig(projectDir, config);
        console.log(chalk.green("  Background updated.\n"));
        break;
      }

      case "view": {
        await agentShowCommand(role!, options);
        break;
      }

      case "done": {
        done = true;
        break;
      }
    }
  }

  console.log(chalk.green(`  Configuration saved for ${role}.\n`));
}
