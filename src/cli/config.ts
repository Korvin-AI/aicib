import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  loadConfig,
  saveConfig,
  listAllAgents,
  type ModelName,
  type EscalationThreshold,
} from "../core/config.js";
import {
  VALID_PRESETS,
  PRESET_DESCRIPTIONS,
  type PersonaPreset,
} from "../core/persona.js";
import { agentCustomizeCommand } from "./agent.js";

interface ConfigOptions {
  dir: string;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
    return;
  }

  console.log(chalk.bold("\n  AI Company-in-a-Box — Configuration\n"));
  console.log(`  Company: ${config.company.name}`);
  console.log(`  Template: ${config.company.template}\n`);

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to configure?",
      choices: [
        { name: "Company name", value: "name" },
        { name: "Agent models", value: "models" },
        { name: "Enable/disable agents", value: "toggle" },
        { name: "Spending limits", value: "limits" },
        { name: "Escalation threshold", value: "escalation" },
        { name: "Agent personas", value: "personas" },
        { name: "View current config", value: "view" },
        { name: "Exit", value: "exit" },
      ],
    },
  ]);

  switch (action) {
    case "name": {
      const { newName } = await inquirer.prompt([
        {
          type: "input",
          name: "newName",
          message: "New company name:",
          default: config.company.name,
        },
      ]);
      config.company.name = newName;
      saveConfig(projectDir, config);
      console.log(chalk.green(`\n  Company name updated to "${newName}"\n`));
      break;
    }

    case "models": {
      const agents = listAllAgents(config);
      const { agentToModify } = await inquirer.prompt([
        {
          type: "list",
          name: "agentToModify",
          message: "Which agent's model do you want to change?",
          choices: agents.map((a) => ({
            name: `${a.role} (currently: ${a.model})`,
            value: a.role,
          })),
        },
      ]);

      const { newModel } = await inquirer.prompt([
        {
          type: "list",
          name: "newModel",
          message: `New model for ${agentToModify}:`,
          choices: [
            { name: "opus (most capable, highest cost)", value: "opus" },
            { name: "sonnet (balanced)", value: "sonnet" },
            { name: "haiku (fastest, lowest cost)", value: "haiku" },
          ],
        },
      ]);

      // Update the model in config
      if (config.agents[agentToModify]) {
        config.agents[agentToModify].model = newModel as ModelName;
      } else {
        // It's a worker - find it
        for (const agent of Object.values(config.agents)) {
          if (agent.workers) {
            for (const workerEntry of agent.workers) {
              if (agentToModify in workerEntry) {
                workerEntry[agentToModify].model = newModel as ModelName;
              }
            }
          }
        }
      }

      saveConfig(projectDir, config);
      console.log(
        chalk.green(`\n  ${agentToModify} model updated to ${newModel}\n`)
      );
      break;
    }

    case "toggle": {
      const agents = listAllAgents(config);
      const { agentToToggle } = await inquirer.prompt([
        {
          type: "list",
          name: "agentToToggle",
          message: "Which agent do you want to enable/disable?",
          choices: agents
            .filter((a) => a.role !== "ceo") // Can't disable CEO
            .map((a) => ({
              name: `${a.role} (${a.enabled ? "enabled" : "disabled"})`,
              value: a.role,
            })),
        },
      ]);

      const currentAgent = agents.find((a) => a.role === agentToToggle);
      const newEnabled = !currentAgent?.enabled;

      if (config.agents[agentToToggle]) {
        config.agents[agentToToggle].enabled = newEnabled;
      } else {
        for (const agent of Object.values(config.agents)) {
          if (agent.workers) {
            for (const workerEntry of agent.workers) {
              if (agentToToggle in workerEntry) {
                workerEntry[agentToToggle].enabled = newEnabled;
              }
            }
          }
        }
      }

      saveConfig(projectDir, config);
      console.log(
        chalk.green(
          `\n  ${agentToToggle} ${newEnabled ? "enabled" : "disabled"}\n`
        )
      );
      break;
    }

    case "limits": {
      const { dailyLimit, monthlyLimit } = await inquirer.prompt([
        {
          type: "number",
          name: "dailyLimit",
          message: "Daily cost limit (USD):",
          default: config.settings.cost_limit_daily,
        },
        {
          type: "number",
          name: "monthlyLimit",
          message: "Monthly cost limit (USD):",
          default: config.settings.cost_limit_monthly,
        },
      ]);

      config.settings.cost_limit_daily = dailyLimit;
      config.settings.cost_limit_monthly = monthlyLimit;
      saveConfig(projectDir, config);
      console.log(
        chalk.green(
          `\n  Limits updated: $${dailyLimit}/day, $${monthlyLimit}/month\n`
        )
      );
      break;
    }

    case "escalation": {
      const { threshold } = await inquirer.prompt([
        {
          type: "list",
          name: "threshold",
          message: "Escalation threshold (what gets escalated to the human founder):",
          choices: [
            {
              name: "low — Agents escalate most decisions to you",
              value: "low",
            },
            {
              name: "medium — Agents handle routine decisions, escalate significant ones",
              value: "medium",
            },
            {
              name: "high — Agents handle most decisions autonomously, only escalate critical ones",
              value: "high",
            },
          ],
          default: config.settings.escalation_threshold,
        },
      ]);

      config.settings.escalation_threshold =
        threshold as EscalationThreshold;
      saveConfig(projectDir, config);
      console.log(
        chalk.green(
          `\n  Escalation threshold set to "${threshold}"\n`
        )
      );
      break;
    }

    case "personas": {
      const { personaAction } = await inquirer.prompt([
        {
          type: "list",
          name: "personaAction",
          message: "Agent personas:",
          choices: [
            { name: "Change company preset (all agents)", value: "change" },
            { name: "Set agent override (one agent)", value: "override" },
            { name: "Customize agent persona (studio)", value: "studio" },
            { name: "View current persona settings", value: "view" },
            { name: "Back", value: "back" },
          ],
        },
      ]);

      switch (personaAction) {
        case "change": {
          const currentPreset = config.persona?.preset || "professional";
          const { newPreset } = await inquirer.prompt([
            {
              type: "list",
              name: "newPreset",
              message: "Choose a personality style for all agents:",
              choices: VALID_PRESETS.map((p) => ({
                name: `${p.charAt(0).toUpperCase() + p.slice(1)} — ${PRESET_DESCRIPTIONS[p]}${p === currentPreset ? " (current)" : ""}`,
                value: p,
              })),
              default: currentPreset,
            },
          ]);

          if (!config.persona) {
            config.persona = { preset: "professional" };
          }
          config.persona.preset = newPreset as PersonaPreset;
          saveConfig(projectDir, config);
          console.log(
            chalk.green(
              `\n  Company persona preset changed to "${newPreset}"\n`
            )
          );
          break;
        }

        case "override": {
          const agents = listAllAgents(config);
          const { agentToOverride } = await inquirer.prompt([
            {
              type: "list",
              name: "agentToOverride",
              message: "Which agent should have a different persona?",
              choices: agents.map((a) => {
                const override = config.persona?.overrides?.[a.role];
                const label = override
                  ? `${a.role} (override: ${override})`
                  : `${a.role}`;
                return { name: label, value: a.role };
              }),
            },
          ]);

          const { overridePreset } = await inquirer.prompt([
            {
              type: "list",
              name: "overridePreset",
              message: `Persona for ${agentToOverride}:`,
              choices: [
                ...VALID_PRESETS.map((p) => ({
                  name: `${p.charAt(0).toUpperCase() + p.slice(1)} — ${PRESET_DESCRIPTIONS[p]}`,
                  value: p,
                })),
                { name: "Remove override (use company preset)", value: "remove" },
              ],
            },
          ]);

          if (!config.persona) {
            config.persona = { preset: "professional" };
          }

          if (overridePreset === "remove") {
            if (config.persona.overrides) {
              delete config.persona.overrides[agentToOverride];
              if (Object.keys(config.persona.overrides).length === 0) {
                delete config.persona.overrides;
              }
            }
            console.log(
              chalk.green(
                `\n  Removed persona override for ${agentToOverride} (will use company preset)\n`
              )
            );
          } else {
            if (!config.persona.overrides) {
              config.persona.overrides = {};
            }
            config.persona.overrides[agentToOverride] = overridePreset as PersonaPreset;
            console.log(
              chalk.green(
                `\n  ${agentToOverride} persona set to "${overridePreset}"\n`
              )
            );
          }
          saveConfig(projectDir, config);
          break;
        }

        case "studio": {
          await agentCustomizeCommand(undefined, { dir: options.dir });
          break;
        }

        case "view": {
          const currentPreset = config.persona?.preset || "professional";
          console.log(chalk.bold("\n  Persona Settings:\n"));
          console.log(
            `    Company preset: ${chalk.cyan(currentPreset)} — ${PRESET_DESCRIPTIONS[currentPreset as PersonaPreset] || ""}`
          );

          if (
            config.persona?.overrides &&
            Object.keys(config.persona.overrides).length > 0
          ) {
            console.log(chalk.bold("\n    Agent overrides:"));
            for (const [role, preset] of Object.entries(
              config.persona.overrides
            )) {
              console.log(
                `      ${role}: ${chalk.cyan(preset)} — ${PRESET_DESCRIPTIONS[preset as PersonaPreset] || ""}`
              );
            }
          } else {
            console.log(
              chalk.dim("    No agent overrides — all agents use the company preset")
            );
          }

          // Display Agent Persona Studio config
          if (
            config.persona?.agents &&
            Object.keys(config.persona.agents).length > 0
          ) {
            console.log(chalk.bold("\n    Agent Persona Studio:"));
            for (const [role, ap] of Object.entries(config.persona.agents)) {
              const parts: string[] = [];
              if (ap.display_name) parts.push(`name: ${ap.display_name}`);
              if (ap.role_preset) parts.push(`preset: ${ap.role_preset}`);
              if (ap.traits) {
                const traitParts: string[] = [];
                if (ap.traits.communication_style) traitParts.push(ap.traits.communication_style);
                if (ap.traits.decision_making) traitParts.push(ap.traits.decision_making);
                if (ap.traits.risk_tolerance) traitParts.push(ap.traits.risk_tolerance);
                if (traitParts.length > 0) parts.push(`traits: ${traitParts.join(", ")}`);
              }
              if (ap.background?.industry_experience?.length) {
                parts.push(`bg: ${ap.background.industry_experience.join(", ")}`);
              }
              console.log(`      ${role}: ${parts.join(" | ")}`);
            }
          }
          console.log();
          break;
        }

        case "back":
          break;
      }
      break;
    }

    case "view": {
      console.log(chalk.bold("\n  Current Configuration:\n"));
      console.log(`  Company: ${config.company.name}`);
      console.log(`  Template: ${config.company.template}`);

      console.log(chalk.bold("\n  Agents:"));
      const agents = listAllAgents(config);
      for (const agent of agents) {
        const status = agent.enabled ? chalk.green("ON") : chalk.red("OFF");
        const indent = agent.department !== agent.role ? "      " : "    ";
        console.log(
          `${indent}${status} ${agent.role.padEnd(22)} ${agent.model}`
        );
      }

      console.log(chalk.bold("\n  Settings:"));
      console.log(
        `    Daily limit:    $${config.settings.cost_limit_daily}`
      );
      console.log(
        `    Monthly limit:  $${config.settings.cost_limit_monthly}`
      );
      console.log(
        `    Escalation:     ${config.settings.escalation_threshold}`
      );
      console.log(
        `    Auto-start:     ${config.settings.auto_start_workers}`
      );

      const currentPreset = config.persona?.preset || "professional";
      console.log(chalk.bold("\n  Persona:"));
      console.log(`    Preset:         ${currentPreset}`);
      if (
        config.persona?.overrides &&
        Object.keys(config.persona.overrides).length > 0
      ) {
        console.log("    Overrides:");
        for (const [role, preset] of Object.entries(config.persona.overrides)) {
          console.log(`      ${role}: ${preset}`);
        }
      }
      if (
        config.persona?.agents &&
        Object.keys(config.persona.agents).length > 0
      ) {
        console.log("    Studio:");
        for (const [role, ap] of Object.entries(config.persona.agents)) {
          const parts: string[] = [];
          if (ap.display_name) parts.push(ap.display_name);
          if (ap.role_preset) parts.push(ap.role_preset);
          console.log(`      ${role}: ${parts.join(" / ") || "configured"}`);
        }
      }
      console.log();
      break;
    }

    case "exit":
      break;
  }
}
