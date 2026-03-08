import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import {
  configExists,
  getConfigPath,
  loadConfig,
  saveConfig,
  validateApiKeyFormat,
  type AicibConfig,
} from "../core/config.js";
import { getTemplatePath, listTemplates } from "../core/agents.js";
import { installAgentDefinitions } from "../core/team.js";
import {
  VALID_PRESETS,
  PRESET_DESCRIPTIONS,
  ROLE_PRESETS,
  validateAgentPersona,
  type PersonaPreset,
  type AgentPersonaConfig,
} from "../core/persona.js";
import { listRolePresets } from "../core/persona-studio.js";
import {
  listStructures,
  listIndustries,
  getStructure,
  getIndustry,
  resolveTemplate,
  getStructureChoices,
  getIndustryChoices,
  validateCombination,
} from "../core/template-registry.js";
import { composeTemplate } from "../core/template-composer.js";
import { ensureAgentsDir } from "../core/team.js";

interface InitOptions {
  template?: string;
  structure?: string;
  industry?: string;
  name: string;
  dir: string;
  persona?: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const { name, dir } = options;
  const projectDir = path.resolve(dir);

  console.log(chalk.bold(`\n  AI Company-in-a-Box\n`));

  // Check if already initialized
  if (configExists(projectDir)) {
    console.log(
      chalk.yellow(
        `  Warning: aicib.config.yaml already exists in ${projectDir}`
      )
    );
    console.log(
      chalk.yellow(`  Use 'aicib config' to modify settings.\n`)
    );
    return;
  }

  // Resolve structure and industry from flags
  let structureName: string | undefined = options.structure;
  let industryName: string | undefined = options.industry;

  // Handle legacy --template flag
  if (options.template) {
    const resolved = resolveTemplate(options.template);
    if (resolved) {
      structureName = structureName || resolved.structure;
      industryName = industryName || resolved.industry || undefined;
      console.log(
        `  Initializing "${name}" with template: ${options.template} (${structureName} + ${industryName})\n`
      );
    } else {
      // Check if it's a legacy single-directory template
      const available = listTemplates();
      if (available.includes(options.template)) {
        return legacyInit(options.template, name, projectDir, options.persona);
      }
      console.log(
        chalk.red(
          `  Error: Template "${options.template}" not found.`
        )
      );
      return;
    }
  }

  // Interactive structure selection if not specified
  if (!structureName) {
    const structureChoices = getStructureChoices();
    if (structureChoices.length === 0) {
      console.log(chalk.red("  Error: No structures found."));
      return;
    }

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "structure",
        message: "Choose your company structure:",
        choices: structureChoices.map((c) => ({
          name: c.name,
          value: c.value,
        })),
        default: "full-c-suite",
      },
    ]);
    structureName = answer.structure;
  }

  // Interactive industry selection if not specified
  if (!industryName) {
    const industryChoices = getIndustryChoices();
    if (industryChoices.length === 0) {
      console.log(chalk.red("  Error: No industries found."));
      return;
    }

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "industry",
        message: "Choose your industry:",
        choices: industryChoices.map((c) => ({
          name: c.name,
          value: c.value,
        })),
        default: "saas-startup",
      },
    ]);
    industryName = answer.industry;
  }

  // Validate combination
  const errors = validateCombination(structureName!, industryName!);
  if (errors.length > 0) {
    for (const e of errors) {
      console.log(chalk.red(`  Error: ${e}`));
    }
    return;
  }

  if (!options.template) {
    console.log(
      `  Initializing "${name}" with ${structureName} + ${industryName}\n`
    );
  }

  // Select persona preset
  let selectedPreset: PersonaPreset;
  if (options.persona) {
    if (!VALID_PRESETS.includes(options.persona as PersonaPreset)) {
      console.log(
        chalk.red(
          `  Error: Invalid persona "${options.persona}". Available: ${VALID_PRESETS.join(", ")}`
        )
      );
      return;
    }
    selectedPreset = options.persona as PersonaPreset;
  } else {
    // Check if industry has a recommended preset
    const industry = getIndustry(industryName!);
    const defaultPreset = industry.recommended_preset || "professional";

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "selectedPreset",
        message: "What personality style should your AI team use?",
        choices: VALID_PRESETS.map((p) => ({
          name: `${p.charAt(0).toUpperCase() + p.slice(1)} — ${PRESET_DESCRIPTIONS[p]}${p === defaultPreset ? " (recommended)" : ""}`,
          value: p,
        })),
        default: defaultPreset,
      },
    ]);
    selectedPreset = answer.selectedPreset;
  }

  // Auth mode selection
  const { authMode } = await inquirer.prompt([
    {
      type: "list",
      name: "authMode",
      message: "How will your AI company authenticate?",
      choices: [
        {
          name: "Claude Code subscription (you're already logged in)",
          value: "claude-code",
        },
        {
          name: "Anthropic API key (enter your key)",
          value: "claude-api",
        },
      ],
      default: "claude-code",
    },
  ]);

  let initApiKey: string | undefined;
  if (authMode === "claude-api") {
    const { apiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "apiKey",
        message: "Anthropic API key:",
        mask: "*",
        validate: (input: string) => validateApiKeyFormat(input),
      },
    ]);
    initApiKey = apiKey.trim();
  }

  const spinner = ora("  Creating project structure...").start();

  try {
    // Compose template from structure + industry
    const composed = composeTemplate(
      structureName!,
      industryName!,
      name,
      selectedPreset
    );

    // Write config — compose engine block into YAML before writing to avoid
    // a load-patch-save round-trip that is fragile and wasteful.
    const configPath = getConfigPath(projectDir);
    let configYaml = composed.configYaml;
    if (authMode === "claude-api") {
      const engineBlock = initApiKey
        ? `\nengine:\n  mode: claude-api\n  api_key: "${initApiKey}"\n`
        : `\nengine:\n  mode: claude-api\n`;
      configYaml += engineBlock;
    }
    fs.writeFileSync(configPath, configYaml, "utf-8");

    spinner.text = "  Installing agent definitions...";

    // Write agent files
    const agentsDir = ensureAgentsDir(projectDir);
    for (const agent of composed.agentFiles) {
      fs.writeFileSync(
        path.join(agentsDir, agent.fileName),
        agent.content,
        "utf-8"
      );
    }

    // Create .aicib directory for state
    const stateDir = path.join(projectDir, ".aicib");
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    // Create .gitignore for state directory
    const gitignorePath = path.join(stateDir, ".gitignore");
    fs.writeFileSync(
      gitignorePath,
      "state.db\nstate.db-wal\nstate.db-shm\n",
      "utf-8"
    );

    // Validate installed agent personas
    spinner.text = "  Validating agent personas...";
    const agentFiles = fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"));
    const warnings: string[] = [];
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
      const result = validateAgentPersona(content);
      if (!result.valid) {
        warnings.push(`${file}: ${result.errors.join(", ")}`);
      }
    }

    spinner.succeed("  Project initialized!\n");

    // Print summary
    console.log(chalk.bold("  Created files:"));
    console.log(
      `    ${chalk.green("✓")} aicib.config.yaml (persona: ${selectedPreset})`
    );
    for (const agent of composed.agentFiles) {
      console.log(
        `    ${chalk.green("✓")} .claude/agents/${agent.fileName}`
      );
    }
    console.log(`    ${chalk.green("✓")} .aicib/ (state directory)`);

    if (warnings.length > 0) {
      console.log(chalk.yellow("\n  Persona warnings:"));
      for (const w of warnings) {
        console.log(chalk.yellow(`    ! ${w}`));
      }
    }

    // Dynamic org chart
    const structure = getStructure(structureName!);
    printOrgChart(structure);

    // Guided first experience
    console.log(chalk.bold("\n  🚀 Try your first brief:\n"));
    console.log(`    ${chalk.cyan("aicib start")}`);
    console.log(
      `    ${chalk.cyan(`aicib brief "Build a landing page for ${name}. Target: early adopters. MVP scope. Budget: $500/mo."`)}`
    );
    console.log(chalk.bold("\n  💡 Tips:"));
    console.log(
      chalk.dim(
        "    • Each brief costs ~$0.50–$3.00 depending on complexity"
      )
    );
    console.log(
      chalk.dim(
        "    • Set spending limits in aicib.config.yaml (current: $50/day, $500/month)"
      )
    );
    console.log(
      chalk.dim(
        `    • Run ${chalk.cyan('aicib brief --background "..."')} to work while the team runs`
      )
    );
    console.log(
      chalk.dim(
        `    • Check on progress anytime with ${chalk.cyan("aicib status")}\n`
      )
    );
  } catch (error) {
    spinner.fail("  Initialization failed");
    console.error(
      chalk.red(
        `\n  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
    process.exit(1);
  }
}

/**
 * Legacy init path — for backward compatibility with old-style templates
 * that live as complete directories under src/templates/.
 */
async function legacyInit(
  template: string,
  name: string,
  projectDir: string,
  persona?: string
): Promise<void> {
  console.log(`  Initializing "${name}" with template: ${template}\n`);

  let selectedPreset: PersonaPreset;
  if (persona) {
    if (!VALID_PRESETS.includes(persona as PersonaPreset)) {
      console.log(
        chalk.red(
          `  Error: Invalid persona "${persona}". Available: ${VALID_PRESETS.join(", ")}`
        )
      );
      return;
    }
    selectedPreset = persona as PersonaPreset;
  } else {
    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "selectedPreset",
        message: "What personality style should your AI team use?",
        choices: VALID_PRESETS.map((p) => ({
          name: `${p.charAt(0).toUpperCase() + p.slice(1)} — ${PRESET_DESCRIPTIONS[p]}${p === "professional" ? " (default)" : ""}`,
          value: p,
        })),
        default: "professional",
      },
    ]);
    selectedPreset = answer.selectedPreset;
  }

  // Optional agent personalization step
  const agentPersonas: Record<string, AgentPersonaConfig> = {};
  const cSuiteRoles = ["ceo", "cto", "cfo", "cmo"];

  if (!persona) {
    // Only ask interactively (skip if --persona flag was used for automation)
    const { customize } = await inquirer.prompt([{
      type: "confirm",
      name: "customize",
      message: "Would you like to customize individual agent personalities?",
      default: false,
    }]);

    if (customize) {
      const templateDir = getTemplatePath(template);

      for (const role of cSuiteRoles) {
        console.log(chalk.bold(`\n  Customizing ${role.toUpperCase()}:`));

        // Display name
        const { displayName } = await inquirer.prompt([{
          type: "input",
          name: "displayName",
          message: `  Display name for ${role} (Enter to skip):`,
        }]);

        const personaConfig: AgentPersonaConfig = {};
        if (displayName.trim()) {
          personaConfig.display_name = displayName.trim();
        }

        // Role preset
        const presets = listRolePresets(templateDir, role);
        if (presets.length > 0) {
          const { rolePreset } = await inquirer.prompt([{
            type: "list",
            name: "rolePreset",
            message: `  Role preset for ${role}:`,
            choices: [
              { name: chalk.dim("Skip"), value: "__skip__" },
              ...presets.map((p) => ({
                name: `${p.displayName} — ${p.description}`,
                value: p.name,
              })),
            ],
          }]);
          if (rolePreset !== "__skip__") {
            personaConfig.role_preset = rolePreset;
          }
        }

        if (personaConfig.display_name || personaConfig.role_preset) {
          agentPersonas[role] = personaConfig;
        }
      }

      if (Object.keys(agentPersonas).length > 0) {
        console.log(chalk.green(`\n  Configured ${Object.keys(agentPersonas).length} agent persona(s).`));
        console.log(chalk.dim("  Use 'aicib agent customize' later to add traits and backgrounds.\n"));
      }
    }
  }

  const spinner = ora("  Creating project structure...").start();

  try {
    const templateDir = getTemplatePath(template);
    const templateConfigPath = path.join(templateDir, "config.yaml");
    const configPath = getConfigPath(projectDir);

    let configContent = fs.readFileSync(templateConfigPath, "utf-8");
    configContent = configContent.replace(
      /name:\s*"[^"]*"/,
      `name: "${name}"`
    );
    configContent = configContent.replace(
      /preset:\s*\w+/,
      `preset: ${selectedPreset}`
    );

    fs.writeFileSync(configPath, configContent, "utf-8");

    // Merge agent personas via structured config round-trip
    if (Object.keys(agentPersonas).length > 0) {
      const cfg = loadConfig(projectDir);
      if (!cfg.persona) {
        cfg.persona = { preset: selectedPreset };
      }
      cfg.persona.agents = agentPersonas;
      saveConfig(projectDir, cfg);
    }

    spinner.text = "  Installing agent definitions...";
    installAgentDefinitions(projectDir, templateDir, name);

    const stateDir = path.join(projectDir, ".aicib");
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    const gitignorePath = path.join(stateDir, ".gitignore");
    fs.writeFileSync(
      gitignorePath,
      "state.db\nstate.db-wal\nstate.db-shm\n",
      "utf-8"
    );

    spinner.text = "  Validating agent personas...";
    const agentsDir = path.join(projectDir, ".claude", "agents");
    const agentFiles = fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"));
    const warnings: string[] = [];
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
      const result = validateAgentPersona(content);
      if (!result.valid) {
        warnings.push(`${file}: ${result.errors.join(", ")}`);
      }
    }

    spinner.succeed("  Project initialized!\n");

    console.log(chalk.bold("  Created files:"));
    console.log(
      `    ${chalk.green("✓")} aicib.config.yaml (persona: ${selectedPreset})`
    );
    for (const file of agentFiles) {
      console.log(`    ${chalk.green("✓")} .claude/agents/${file}`);
    }
    console.log(`    ${chalk.green("✓")} .aicib/ (state directory)`);

    if (warnings.length > 0) {
      console.log(chalk.yellow("\n  Persona warnings:"));
      for (const w of warnings) {
        console.log(chalk.yellow(`    ! ${w}`));
      }
    }

    console.log(chalk.bold("\n  Your AI Company:\n"));
    console.log(`    👤 You (Human Founder)`);
    console.log(`     └── 🏢 ${chalk.bold.white("CEO")} (Team Lead)`);
    console.log(
      `           ├── ${chalk.cyan("CTO")} ── ${chalk.dim("Backend Engineer, Frontend Engineer")}`
    );
    console.log(
      `           ├── ${chalk.green("CFO")} ── ${chalk.dim("Financial Analyst")}`
    );
    console.log(
      `           └── ${chalk.magenta("CMO")} ── ${chalk.dim("Content Writer")}`
    );

    console.log(chalk.bold("\n  🚀 Try your first brief:\n"));
    console.log(`    ${chalk.cyan("aicib start")}`);
    console.log(
      `    ${chalk.cyan(`aicib brief "Build a landing page for ${name}. Target: early adopters. MVP scope. Budget: $500/mo."`)}`
    );
    console.log(chalk.bold("\n  💡 Tips:"));
    console.log(
      chalk.dim(
        "    • Each brief costs ~$0.50–$3.00 depending on complexity"
      )
    );
    console.log(
      chalk.dim(
        "    • Set spending limits in aicib.config.yaml (current: $50/day, $500/month)"
      )
    );
    console.log(
      chalk.dim(
        `    • Run ${chalk.cyan('aicib brief --background "..."')} to work while the team runs`
      )
    );
    console.log(
      chalk.dim(
        `    • Check on progress anytime with ${chalk.cyan("aicib status")}\n`
      )
    );
  } catch (error) {
    spinner.fail("  Initialization failed");
    console.error(
      chalk.red(
        `\n  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
    process.exit(1);
  }
}

/**
 * Prints a dynamic org chart based on the structure definition.
 */
function printOrgChart(
  structure: { roles: Record<string, { title: string; reports_to: string; spawns: string[]; department: string }> }
): void {
  console.log(chalk.bold("\n  Your AI Company:\n"));
  console.log(`    👤 You (Human Founder)`);

  // Find CEO (reports_to: human-founder)
  const ceoEntry = Object.entries(structure.roles).find(
    ([_, r]) => r.reports_to === "human-founder"
  );
  if (!ceoEntry) return;

  const [ceoRole, ceoInfo] = ceoEntry;
  console.log(
    `     └── 🏢 ${chalk.bold.white(ceoInfo.title)} (Team Lead)`
  );

  // Find C-suite (reports_to: ceo)
  const csuite = Object.entries(structure.roles).filter(
    ([role, r]) => r.reports_to === ceoRole
  );

  const deptColors: Record<string, (s: string) => string> = {
    engineering: chalk.cyan,
    finance: chalk.green,
    marketing: chalk.magenta,
    executive: chalk.yellow,
  };

  for (let i = 0; i < csuite.length; i++) {
    const [role, info] = csuite[i];
    const isLast = i === csuite.length - 1;
    const connector = isLast ? "└──" : "├──";
    const colorFn = deptColors[info.department] || chalk.white;

    // Find workers under this C-suite role
    const workers = Object.entries(structure.roles).filter(
      ([_, r]) => r.reports_to === role
    );

    const workerText =
      workers.length > 0
        ? ` ── ${chalk.dim(workers.map(([_, w]) => w.title).join(", "))}`
        : "";

    console.log(
      `           ${connector} ${colorFn(info.title)}${workerText}`
    );
  }
}
