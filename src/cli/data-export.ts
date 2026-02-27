import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import {
  exportCompanyData,
  importCompanyData,
  type ExportMode,
  type ExportCategory,
  type ExportOptions,
  type ImportOptions,
} from "../core/data-export.js";

// --- aicib export ---

interface ExportCLIOptions {
  dir: string;
  output?: string;
  mode?: string;
  only?: string;
  compress: boolean;
  includeSecrets?: boolean;
}

const VALID_MODES: ExportMode[] = ["full", "selective", "anonymized"];

const VALID_CATEGORIES: ExportCategory[] = [
  "configs", "agents", "costs", "tasks", "knowledge",
  "hr", "projects", "safeguards", "scheduler",
  "integrations", "runtime",
];

function parseCategories(raw: string): ExportCategory[] {
  const cats = raw.split(",").map((s) => s.trim().toLowerCase());
  const invalid = cats.filter((c) => !VALID_CATEGORIES.includes(c as ExportCategory));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid categories: ${invalid.join(", ")}. Valid categories: ${VALID_CATEGORIES.join(", ")}`
    );
  }
  return cats as ExportCategory[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function exportCommand(options: ExportCLIOptions): Promise<void> {
  const mode = (options.mode || "full") as ExportMode;

  if (!VALID_MODES.includes(mode)) {
    console.log(
      chalk.red(`\n  Error: Invalid mode "${mode}". Use: ${VALID_MODES.join(", ")}\n`)
    );
    return;
  }

  let categories: ExportCategory[] | undefined;
  if (options.only) {
    try {
      categories = parseCategories(options.only);
    } catch (err) {
      console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      return;
    }
  }

  // If mode is selective but no categories specified, prompt
  if (mode === "selective" && !categories) {
    console.log(
      chalk.red("\n  Error: --only <categories> is required for selective mode.\n")
    );
    console.log(
      chalk.dim(`  Example: aicib export --mode selective --only knowledge,tasks\n`)
    );
    return;
  }

  const exportOpts: ExportOptions = {
    projectDir: options.dir,
    outputPath: options.output,
    mode,
    categories,
    compress: options.compress !== false,
    includeSecrets: options.includeSecrets || false,
  };

  const modeLabel = mode === "anonymized"
    ? "anonymized template"
    : mode === "selective"
      ? "selective"
      : "full";

  const spinner = ora(`Exporting ${modeLabel} data...`).start();

  try {
    const result = exportCompanyData(exportOpts);
    spinner.succeed("Export complete");

    console.log();
    console.log(chalk.bold("  Export Summary"));
    console.log(chalk.dim(`  ${"─".repeat(50)}`));
    console.log(`  ${chalk.dim("Mode:")}         ${chalk.cyan(mode)}`);
    console.log(`  ${chalk.dim("Company:")}      ${result.manifest.company_name}`);
    console.log(`  ${chalk.dim("Categories:")}   ${result.manifest.categories.join(", ")}`);
    console.log(`  ${chalk.dim("Agents:")}       ${result.manifest.agent_count}`);
    console.log(`  ${chalk.dim("Tables:")}       ${result.manifest.tables.length}`);

    const totalRows = Object.values(result.manifest.table_row_counts)
      .reduce((sum, n) => sum + n, 0);
    console.log(`  ${chalk.dim("Total rows:")}   ${totalRows}`);
    console.log(`  ${chalk.dim("Size:")}         ${formatSize(result.totalSize)}`);
    console.log(`  ${chalk.dim("Output:")}       ${chalk.green(result.outputPath)}`);

    if (result.manifest.tables.length > 0) {
      console.log();
      console.log(chalk.dim("  Table row counts:"));
      for (const [table, count] of Object.entries(result.manifest.table_row_counts)) {
        console.log(`    ${chalk.dim("•")} ${table}: ${count}`);
      }
    }

    console.log();
  } catch (err) {
    spinner.fail("Export failed");
    console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
  }
}

// --- aicib import ---

interface ImportCLIOptions {
  dir: string;
  merge?: boolean;
  only?: string;
  overwriteAgents?: boolean;
  force?: boolean;
  companyName?: string;
}

export async function importCommand(
  sourcePath: string,
  options: ImportCLIOptions
): Promise<void> {
  let categories: ExportCategory[] | undefined;
  if (options.only) {
    try {
      categories = parseCategories(options.only);
    } catch (err) {
      console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      return;
    }
  }

  // Confirmation for full import without --force
  if (!options.merge && !options.force && !categories) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        message: "Full import will overwrite existing data. Continue?",
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.dim("\n  Import cancelled.\n"));
      return;
    }
  }

  const importOpts: ImportOptions = {
    sourcePath,
    projectDir: options.dir,
    merge: options.merge || false,
    categories,
    overwriteAgents: options.overwriteAgents || false,
    force: options.force || false,
    companyName: options.companyName,
  };

  const spinner = ora("Importing data...").start();

  try {
    const result = importCompanyData(importOpts);
    spinner.succeed("Import complete");

    console.log();
    console.log(chalk.bold("  Import Summary"));
    console.log(chalk.dim(`  ${"─".repeat(50)}`));
    console.log(`  ${chalk.dim("Config restored:")}    ${result.configRestored ? chalk.green("yes") : chalk.dim("no")}`);
    console.log(`  ${chalk.dim("Agents restored:")}    ${result.agentsRestored}`);
    console.log(`  ${chalk.dim("Tables imported:")}    ${result.tablesImported}`);
    console.log(`  ${chalk.dim("Rows imported:")}      ${result.rowsImported}`);

    if (result.conflictsSkipped > 0) {
      console.log(`  ${chalk.dim("Conflicts skipped:")} ${chalk.yellow(String(result.conflictsSkipped))}`);
    }

    console.log();
  } catch (err) {
    spinner.fail("Import failed");
    console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
  }
}
