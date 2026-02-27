import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import type { JournalEntry } from "../core/cost-tracker.js";

interface JournalOptions {
  dir: string;
  search?: string;
  limit?: string;
}

function formatEntry(entry: JournalEntry): string {
  const lines: string[] = [];

  // Date header
  const date = entry.created_at;
  lines.push(chalk.bold(chalk.white(`  ${date}`)));

  // Directive
  const directiveSnippet =
    entry.directive.length > 100
      ? entry.directive.slice(0, 100) + "..."
      : entry.directive;
  lines.push(chalk.cyan(`  Directive: "${directiveSnippet}"`));

  // Summary
  lines.push(`  ${entry.summary}`);

  // Deliverables
  if (entry.deliverables) {
    try {
      const files = JSON.parse(entry.deliverables) as string[];
      if (files.length > 0) {
        lines.push(chalk.dim(`  Files: ${files.join(", ")}`));
      }
    } catch { /* ignore */ }
  }

  // Cost line
  lines.push(
    chalk.dim(
      `  Cost: $${entry.total_cost_usd.toFixed(4)} | Turns: ${entry.num_turns} | Duration: ${(entry.duration_ms / 1000).toFixed(1)}s`
    )
  );

  // Separator
  lines.push(chalk.dim("  " + "─".repeat(60)));

  return lines.join("\n");
}

export async function journalCommand(options: JournalOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  try {
    loadConfig(projectDir); // validate project exists
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  const costTracker = new CostTracker(projectDir);

  try {
    let entries: JournalEntry[];

    if (options.search) {
      entries = costTracker.searchJournalByKeyword(options.search);
      console.log(
        chalk.bold(
          `\n  AI Company-in-a-Box — Journal (search: "${options.search}")\n`
        )
      );
    } else {
      const limit = options.limit ? Number(options.limit) : 10;
      if (Number.isNaN(limit) || limit <= 0) {
        console.error(chalk.red("  Error: --limit must be a positive number.\n"));
        costTracker.close();
        process.exit(1);
      }
      entries = costTracker.getRecentJournalEntries(limit);
      console.log(chalk.bold("\n  AI Company-in-a-Box — CEO Journal\n"));
    }

    if (entries.length === 0) {
      console.log(
        chalk.yellow("  No journal entries found.")
      );
      console.log(
        chalk.dim(
          "  Journal entries are created automatically after each brief.\n"
        )
      );
    } else {
      // Display in chronological order (oldest first)
      const sorted = [...entries].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      console.log(chalk.dim(`  Showing ${sorted.length} entries:\n`));
      for (const entry of sorted) {
        console.log(formatEntry(entry));
      }
      console.log();
    }
  } catch (error) {
    console.error(
      chalk.red(
        `\n  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
  } finally {
    costTracker.close();
  }
}
