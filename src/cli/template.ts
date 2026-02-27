import chalk from "chalk";
import {
  listStructures,
  listIndustries,
  getStructure,
  getIndustry,
  getIndustryAgentsDir,
} from "../core/template-registry.js";
import {
  exportTemplate,
  importTemplate,
} from "../core/template-packager.js";
import { listIndustryAgents } from "../core/template-composer.js";
import fs from "node:fs";

// --- aicib template list ---

export async function templateListCommand(): Promise<void> {
  console.log(chalk.bold("\n  Available Structures:\n"));

  const structures = listStructures();
  if (structures.length === 0) {
    console.log(chalk.dim("    No structures found."));
  } else {
    // Table header
    console.log(
      `    ${chalk.dim("Name".padEnd(18))}${chalk.dim("Agents".padEnd(10))}${chalk.dim("Description")}`
    );
    console.log(chalk.dim(`    ${"─".repeat(60)}`));

    for (const name of structures) {
      const structure = getStructure(name);
      console.log(
        `    ${chalk.cyan(name.padEnd(18))}${String(structure.agent_count).padEnd(10)}${structure.description}`
      );
    }
  }

  console.log(chalk.bold("\n  Available Industries:\n"));

  const industries = listIndustries();
  if (industries.length === 0) {
    console.log(chalk.dim("    No industries found."));
  } else {
    console.log(
      `    ${chalk.dim("Name".padEnd(22))}${chalk.dim("Description")}`
    );
    console.log(chalk.dim(`    ${"─".repeat(60)}`));

    for (const name of industries) {
      const industry = getIndustry(name);
      console.log(
        `    ${chalk.green(name.padEnd(22))}${industry.description}`
      );
    }
  }

  console.log(
    chalk.dim(
      `\n  Use ${chalk.cyan("aicib template info <name>")} for details.\n`
    )
  );
}

// --- aicib template info <name> ---

interface InfoOptions {
  name: string;
}

export async function templateInfoCommand(
  name: string,
  _options?: InfoOptions
): Promise<void> {
  // Try as structure first
  const structures = listStructures();
  if (structures.includes(name)) {
    const structure = getStructure(name);
    console.log(chalk.bold(`\n  Structure: ${structure.display_name}\n`));
    console.log(`  ${chalk.dim("Description:")} ${structure.description}`);
    console.log(`  ${chalk.dim("Agent count:")} ${structure.agent_count}`);
    console.log(chalk.bold("\n  Roles:\n"));

    for (const [roleName, role] of Object.entries(structure.roles)) {
      const spawnsText =
        role.spawns.length > 0
          ? chalk.dim(` → ${role.spawns.join(", ")}`)
          : "";
      console.log(
        `    ${chalk.cyan(roleName.padEnd(22))}${role.title.padEnd(28)}${chalk.dim(role.model)}${spawnsText}`
      );
    }
    console.log();
    return;
  }

  // Try as industry
  const industries = listIndustries();
  if (industries.includes(name)) {
    const industry = getIndustry(name);
    console.log(chalk.bold(`\n  Industry: ${industry.display_name}\n`));
    console.log(`  ${chalk.dim("Description:")} ${industry.description}`);

    if (industry.recommended_structure) {
      console.log(
        `  ${chalk.dim("Recommended structure:")} ${industry.recommended_structure}`
      );
    }
    if (industry.recommended_preset) {
      console.log(
        `  ${chalk.dim("Recommended preset:")} ${industry.recommended_preset}`
      );
    }

    if (industry.industry_knowledge && industry.industry_knowledge.length > 0) {
      console.log(chalk.bold("\n  Domain expertise:\n"));
      for (const k of industry.industry_knowledge) {
        console.log(`    ${chalk.green("•")} ${k}`);
      }
    }

    // Show available agents
    const agents = listIndustryAgents(name);
    if (agents.length > 0) {
      console.log(chalk.bold("\n  Agent templates:\n"));
      for (const a of agents) {
        console.log(`    ${chalk.cyan("•")} ${a}`);
      }
    }

    console.log();
    return;
  }

  console.log(
    chalk.red(
      `\n  Error: "${name}" not found as a structure or industry.\n`
    )
  );
  console.log(
    chalk.dim(
      `  Run ${chalk.cyan("aicib template list")} to see available options.\n`
    )
  );
}

// --- aicib template import <path> ---

interface ImportOptions {
  path: string;
}

export async function templateImportCommand(
  sourcePath: string,
  _options?: ImportOptions
): Promise<void> {
  try {
    const name = importTemplate(sourcePath);
    console.log(
      chalk.green(`\n  Template "${name}" imported successfully.\n`)
    );
    console.log(
      chalk.dim(
        `  Use it with: ${chalk.cyan(`aicib init --industry ${name}`)}\n`
      )
    );
  } catch (error) {
    console.log(
      chalk.red(
        `\n  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
  }
}

// --- aicib template export ---

interface ExportOptions {
  dir: string;
  output?: string;
}

export async function templateExportCommand(
  options: ExportOptions
): Promise<void> {
  const projectDir = options.dir;
  const outputPath = options.output || "template-export";

  try {
    exportTemplate(projectDir, outputPath);
    console.log(
      chalk.green(
        `\n  Template exported to ${chalk.bold(outputPath)}/\n`
      )
    );
    console.log(chalk.dim("  Share this directory or import it elsewhere with:"));
    console.log(
      chalk.dim(
        `  ${chalk.cyan(`aicib template import ${outputPath}`)}\n`
      )
    );
  } catch (error) {
    console.log(
      chalk.red(
        `\n  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
  }
}
