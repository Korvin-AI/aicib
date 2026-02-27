import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../core/config.js";
import { getAgentsDir } from "../core/team.js";

interface RemoveAgentOptions {
  dir: string;
}

const PROTECTED_ROLES = ["ceo", "cto", "cfo", "cmo"];

export async function removeAgentCommand(
  role: string,
  options: RemoveAgentOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);
  const normalizedRole = role
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");

  // Can't remove C-suite
  if (PROTECTED_ROLES.includes(normalizedRole)) {
    console.error(
      chalk.red(
        `\n  Error: Cannot remove ${normalizedRole}. C-suite agents (CEO, CTO, CFO, CMO) can be disabled but not removed.`
      )
    );
    console.error(
      chalk.yellow(
        `  Use 'aicib config' to disable an agent instead.\n`
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

  // Find and remove from config
  let found = false;
  let department = "";

  for (const [deptName, deptConfig] of Object.entries(config.agents)) {
    if (!deptConfig.workers) continue;

    const initialLength = deptConfig.workers.length;
    deptConfig.workers = deptConfig.workers.filter((entry) => {
      return !(normalizedRole in entry);
    });

    if (deptConfig.workers.length < initialLength) {
      found = true;
      department = deptName;
      break;
    }
  }

  if (!found) {
    console.error(
      chalk.red(
        `\n  Error: Agent "${normalizedRole}" not found in any department.\n`
      )
    );
    process.exit(1);
  }

  // Save updated config
  saveConfig(projectDir, config);

  // Remove agent definition file (if exists)
  const agentFile = path.join(
    getAgentsDir(projectDir),
    `${normalizedRole}.md`
  );
  if (fs.existsSync(agentFile)) {
    fs.unlinkSync(agentFile);
  }

  console.log(chalk.bold("\n  AI Company-in-a-Box — Agent Removed\n"));
  console.log(
    `  ${chalk.green("✓")} Removed ${chalk.bold(normalizedRole)} from ${department} department`
  );
  console.log(`  ${chalk.green("✓")} Config updated: aicib.config.yaml`);
  console.log(`  ${chalk.green("✓")} Agent file removed: .claude/agents/${normalizedRole}.md\n`);
}
