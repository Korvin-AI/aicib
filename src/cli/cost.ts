import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import {
  header,
  createTable,
  agentColor,
  formatUSD,
  costColor,
  formatPercent,
} from "./ui.js";

interface CostOptions {
  dir: string;
  session?: string;
  history?: boolean;
}

export async function costCommand(options: CostOptions): Promise<void> {
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
  }

  console.log(header("Cost Report"));

  try {
    const costTracker = new CostTracker(projectDir);

    // --history flag: show daily cost history
    if (options.history) {
      const history = costTracker.getCostHistory(7);
      if (history.length === 0) {
        console.log(chalk.yellow("  No cost history available.\n"));
        costTracker.close();
        return;
      }

      const histTable = createTable(["Date", "Cost", "Entries"], [16, 14, 10]);
      for (const day of history) {
        histTable.push([
          day.date,
          formatUSD(day.total_cost_usd),
          String(day.entry_count),
        ]);
      }
      console.log(histTable.toString());
      console.log();
      costTracker.close();
      return;
    }

    const costs = costTracker.getCostByAgent(options.session);
    const todayCost = costTracker.getTotalCostToday();
    const monthCost = costTracker.getTotalCostThisMonth();

    if (costs.length === 0) {
      console.log(chalk.yellow("  No cost data recorded yet.\n"));
      costTracker.close();
      return;
    }

    // Per-agent breakdown table
    const table = createTable(
      ["Agent", "Input Tokens", "Output Tokens", "Cost (USD)", "Calls"],
      [22, 16, 16, 14, 8]
    );

    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const entry of costs) {
      const colorFn = agentColor(entry.role);
      table.push([
        colorFn(entry.role),
        String(entry.total_input_tokens),
        String(entry.total_output_tokens),
        formatUSD(entry.total_cost_usd),
        String(entry.entry_count),
      ]);
      totalCost += entry.total_cost_usd;
      totalInput += entry.total_input_tokens;
      totalOutput += entry.total_output_tokens;
    }

    table.push([
      chalk.bold("Total"),
      chalk.bold(String(totalInput)),
      chalk.bold(String(totalOutput)),
      chalk.bold(formatUSD(totalCost)),
      "",
    ]);

    console.log(table.toString());

    // Limits
    console.log(chalk.bold("\n  Spending Limits:"));

    const dailyClr = costColor(todayCost, config.settings.cost_limit_daily);
    const monthlyClr = costColor(monthCost, config.settings.cost_limit_monthly);

    console.log(
      `    Today:  ${dailyClr(formatUSD(todayCost, 2))} / $${config.settings.cost_limit_daily} (${formatPercent(todayCost, config.settings.cost_limit_daily)})`
    );
    console.log(
      `    Month:  ${monthlyClr(formatUSD(monthCost, 2))} / $${config.settings.cost_limit_monthly} (${formatPercent(monthCost, config.settings.cost_limit_monthly)})\n`
    );

    costTracker.close();
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}\n`
      )
    );
    process.exit(1);
  }
}
