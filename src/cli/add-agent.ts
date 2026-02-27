import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  type ModelName,
} from "../core/config.js";
import { ensureAgentsDir } from "../core/team.js";
import {
  validateAgentPersona,
  type PersonaPreset,
} from "../core/persona.js";

interface AddAgentOptions {
  role: string;
  department: string;
  model: string;
  dir: string;
}

const VALID_DEPARTMENTS = ["cto", "cfo", "cmo"];
const VALID_MODELS = ["opus", "sonnet", "haiku"];

export async function addAgentCommand(options: AddAgentOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);
  const { role, department, model } = options;

  // Validate
  if (!VALID_DEPARTMENTS.includes(department)) {
    console.error(
      chalk.red(
        `\n  Error: Department must be one of: ${VALID_DEPARTMENTS.join(", ")}\n`
      )
    );
    process.exit(1);
  }

  if (!VALID_MODELS.includes(model)) {
    console.error(
      chalk.red(
        `\n  Error: Model must be one of: ${VALID_MODELS.join(", ")}\n`
      )
    );
    process.exit(1);
  }

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

  // Normalize role name
  const normalizedRole = role
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");

  // Check if agent already exists
  const deptConfig = config.agents[department];
  if (!deptConfig) {
    console.error(
      chalk.red(`\n  Error: Department "${department}" not found in config.\n`)
    );
    process.exit(1);
  }

  const existingWorkers = deptConfig.workers || [];
  for (const entry of existingWorkers) {
    if (normalizedRole in entry) {
      console.error(
        chalk.red(
          `\n  Error: Agent "${normalizedRole}" already exists in ${department} department.\n`
        )
      );
      process.exit(1);
    }
  }

  // Add to config
  if (!config.agents[department].workers) {
    config.agents[department].workers = [];
  }
  config.agents[department].workers!.push({
    [normalizedRole]: { model: model as ModelName },
  });

  saveConfig(projectDir, config);

  // Create agent definition file
  const agentsDir = ensureAgentsDir(projectDir);
  const agentFilePath = path.join(agentsDir, `${normalizedRole}.md`);

  const deptTitles: Record<string, string> = {
    cto: "Chief Technology Officer",
    cfo: "Chief Financial Officer",
    cmo: "Chief Marketing Officer",
  };

  const deptNames: Record<string, string> = {
    cto: "engineering",
    cfo: "finance",
    cmo: "marketing",
  };

  const titleCase = normalizedRole
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const deptName = deptNames[department] || department;
  const deptHead = deptTitles[department] || department.toUpperCase();

  const presetName = (config.persona?.preset || "professional") as PersonaPreset;

  const agentContent = `---
role: ${normalizedRole}
title: ${titleCase}
model: ${model}
reports_to: ${department}
department: ${deptName}
spawns: []
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - TodoWrite
escalation_threshold: low
---

# ${titleCase}

You are a ${titleCase} at {{company_name}}. You are spawned by the ${deptHead} as a subagent to execute specific tasks within the ${deptName} department.

## Your Role

You receive task assignments from your department head and execute them with focus and precision. You are expected to deliver high-quality, well-structured output that aligns with the team's standards and conventions.

## How You Think

- **Task-focused**: Understand the full scope of your assignment before starting work
- **Convention-driven**: Study existing patterns in the codebase or project and match them
- **Quality-conscious**: Deliver work that's ready for review, not a rough draft
- **Clear communicator**: When you encounter ambiguity, flag it immediately rather than guessing

## Decision Authority

### You decide autonomously:
- Implementation details within the given task spec
- Approach and methodology for your specific task
- File organization and naming within the task scope
- How to structure your output for maximum clarity

### Escalate to ${department.toUpperCase()} (return in your response):
- Ambiguity in the task requirements
- Decisions that affect other parts of the system
- Dependencies on work outside your assigned scope
- Anything that changes the public interface or API

## Working Style

- Read the full task spec before starting any work
- Check existing code and conventions — follow them consistently
- Build incrementally — get the core working, then refine
- Keep changes focused to your assigned task — don't touch unrelated code
- Return clear, structured results: what was done, files changed, open questions
`;

  fs.writeFileSync(agentFilePath, agentContent, "utf-8");

  // Validate the generated persona
  const validation = validateAgentPersona(agentContent);

  console.log(chalk.bold("\n  AI Company-in-a-Box — Agent Added\n"));
  console.log(`  ${chalk.green("✓")} Added ${chalk.bold(titleCase)} to ${department} department`);
  console.log(`  ${chalk.green("✓")} Model: ${model}`);
  console.log(`  ${chalk.green("✓")} Persona: ${presetName} preset (applied at runtime)`);
  console.log(`  ${chalk.green("✓")} Agent file: .claude/agents/${normalizedRole}.md`);
  console.log(`  ${chalk.green("✓")} Config updated: aicib.config.yaml`);

  if (!validation.valid) {
    console.log(chalk.yellow("\n  Persona warnings:"));
    for (const err of validation.errors) {
      console.log(chalk.yellow(`    ! ${err}`));
    }
  }

  console.log(
    chalk.dim(
      `\n  Edit .claude/agents/${normalizedRole}.md to customize the agent's persona.\n`
    )
  );
}
