import chalk, { type ChalkInstance } from "chalk";
import Table from "cli-table3";
import { getAgentColor } from "../core/output-formatter.js";

/**
 * Returns a chalk color function for a given agent role.
 * Delegates to output-formatter.ts (single source of truth for agent colors).
 */
export function agentColor(role: string): ChalkInstance {
  return getAgentColor(role.toLowerCase());
}

// ── Header ───────────────────────────────────────────────────────────

/**
 * Standard command header: bold title with consistent spacing.
 */
export function header(title: string): string {
  return chalk.bold(`\n  AI Company-in-a-Box \u2014 ${title}\n`);
}

// ── Table Factory ────────────────────────────────────────────────────

/**
 * Creates a cli-table3 table with minimal borders and 2-space indentation.
 */
export function createTable(
  headings: string[],
  colWidths?: number[]
): Table.Table {
  return new Table({
    head: headings.map((h) => chalk.bold(h)),
    ...(colWidths ? { colWidths } : {}),
    chars: {
      top: "\u2500",
      "top-mid": "\u252C",
      "top-left": "  \u250C",
      "top-right": "\u2510",
      bottom: "\u2500",
      "bottom-mid": "\u2534",
      "bottom-left": "  \u2514",
      "bottom-right": "\u2518",
      left: "  \u2502",
      "left-mid": "  \u251C",
      mid: "\u2500",
      "mid-mid": "\u253C",
      right: "\u2502",
      "right-mid": "\u2524",
      middle: "\u2502",
    },
    style: {
      head: [],
      border: ["dim"],
      "padding-left": 1,
      "padding-right": 1,
    },
  });
}

// ── Cost Formatting ──────────────────────────────────────────────────

/**
 * Formats a dollar amount like $1.2345
 */
export function formatUSD(amount: number, decimals: number = 4): string {
  return `$${amount.toFixed(decimals)}`;
}

/**
 * Returns green (<50%), yellow (50-80%), or red (>80%) color function
 * based on how close current is to limit.
 */
export function costColor(current: number, limit: number): ChalkInstance {
  if (limit <= 0) return chalk.green;
  const ratio = current / limit;
  if (ratio >= 0.8) return chalk.red;
  if (ratio >= 0.5) return chalk.yellow;
  return chalk.green;
}

/**
 * Returns percentage string like "42.5%"
 */
export function formatPercent(current: number, limit: number): string {
  if (limit <= 0) return "N/A";
  if (!Number.isFinite(current) || current < 0) return "N/A";
  return `${((current / limit) * 100).toFixed(1)}%`;
}

// ── Time Formatting ──────────────────────────────────────────────────

/**
 * Formats a timestamp into a human-readable "time ago" string.
 * Moved from status.ts for shared use across commands.
 */
export function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

