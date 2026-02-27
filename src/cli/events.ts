/**
 * CLI commands for Company Events: dashboard, list, create, show, delete,
 * enable/disable, minutes, setup, history.
 *
 * Pattern follows src/cli/schedule.ts.
 */

import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import cronParser from "cron-parser";
const { parseExpression: parseExpressionSync } = cronParser;

import { loadConfig } from "../core/config.js";
import { header, createTable, formatTimeAgo } from "./ui.js";
import {
  EventManager,
  EVENT_TEMPLATES,
  type EventConfig,
  type EventType,
  type DiscussionFormat,
} from "../core/events.js";

// --- Helpers ---

interface EventOptions {
  dir: string;
}

function getEventManager(dir: string): EventManager {
  const projectDir = path.resolve(dir);
  loadConfig(projectDir);
  return new EventManager(projectDir);
}

function statusIcon(status: string): string {
  switch (status) {
    case "scheduled":
      return chalk.cyan("scheduled");
    case "in_progress":
      return chalk.yellow("in progress");
    case "completed":
      return chalk.green("completed");
    case "cancelled":
      return chalk.red("cancelled");
    case "skipped":
      return chalk.dim("skipped");
    default:
      return status;
  }
}

// --- Dashboard (bare `aicib events`) ---

export async function eventsCommand(options: EventOptions): Promise<void> {
  console.log(header("Company Events"));

  const em = getEventManager(options.dir);
  try {
    const events = em.listEvents();
    const enabled = events.filter((e) => e.enabled);

    console.log(
      `  Events: ${enabled.length} enabled, ${events.length} total\n`
    );

    // Upcoming events
    const upcoming = events
      .filter((e) => e.enabled && e.next_run_at)
      .sort((a, b) =>
        (a.next_run_at || "").localeCompare(b.next_run_at || "")
      )
      .slice(0, 5);

    if (upcoming.length > 0) {
      console.log(chalk.bold("  Upcoming Events:"));
      const table = createTable([
        "ID",
        "Name",
        "Type",
        "Next Run",
        "Runs",
      ]);
      for (const e of upcoming) {
        table.push([
          `#${e.id}`,
          e.name,
          e.event_type,
          e.next_run_at || "-",
          String(e.run_count),
        ]);
      }
      console.log(table.toString());
    }

    // Recent meeting summaries
    const history = em.getAllInstanceHistory(5);
    const completedHistory = history.filter(
      (h) => h.status === "completed"
    );
    if (completedHistory.length > 0) {
      console.log(chalk.bold("\n  Recent Meetings:"));
      const table = createTable([
        "ID",
        "Event",
        "Status",
        "Completed",
        "Cost",
      ]);
      for (const inst of completedHistory) {
        table.push([
          `#${inst.id}`,
          inst.event_name,
          statusIcon(inst.status),
          inst.completed_at
            ? formatTimeAgo(inst.completed_at)
            : "-",
          `$${inst.cost_usd.toFixed(4)}`,
        ]);
      }
      console.log(table.toString());
    }

    if (events.length === 0) {
      console.log(
        chalk.dim(
          "  No events yet. Create one with: aicib events create --type standup\n"
        )
      );
    }
    console.log();
  } finally {
    em.close();
  }
}

// --- List ---

interface EventListOptions extends EventOptions {
  type?: string;
  enabled?: boolean;
}

export async function eventsListCommand(
  options: EventListOptions
): Promise<void> {
  console.log(header("Company Events"));

  const em = getEventManager(options.dir);
  try {
    const events = em.listEvents({
      event_type: options.type as EventType | undefined,
      enabled: options.enabled,
    });

    if (events.length === 0) {
      console.log(chalk.dim("  No events found.\n"));
      return;
    }

    const table = createTable([
      "ID",
      "Name",
      "Type",
      "Cron",
      "Format",
      "Enabled",
      "Next Run",
      "Runs",
    ]);

    for (const e of events) {
      table.push([
        `#${e.id}`,
        e.name,
        e.event_type,
        e.cron_expression || "-",
        e.discussion_format,
        e.enabled ? chalk.green("yes") : chalk.dim("no"),
        e.next_run_at || "-",
        String(e.run_count),
      ]);
    }

    console.log(table.toString());
    console.log();
  } finally {
    em.close();
  }
}

// --- Create ---

interface EventCreateOptions extends EventOptions {
  type?: string;
  name?: string;
  cron?: string;
  participants?: string;
  format?: string;
  interactive?: boolean;
}

export async function eventsCreateCommand(
  options: EventCreateOptions
): Promise<void> {
  let eventType = options.type;
  let name = options.name;
  let cron = options.cron;
  let participants = options.participants;
  let format = options.format;

  if (options.interactive || !eventType) {
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "type",
        message: "Event type:",
        choices: Object.keys(EVENT_TEMPLATES).map((k) => ({
          name: `${k} — ${EVENT_TEMPLATES[k as EventType].name}`,
          value: k,
        })),
        default: eventType,
      },
      {
        type: "input",
        name: "name",
        message: "Event name:",
        default: (a: Record<string, string>) =>
          name || EVENT_TEMPLATES[a.type as EventType]?.name || "",
      },
      {
        type: "input",
        name: "cron",
        message:
          "Cron expression (e.g., 0 9 * * 1-5 for weekday 9am, blank for manual):",
        default: cron,
        validate: (input: string) => {
          if (!input.trim()) return true;
          try {
            parseExpressionSync(input.trim());
            return true;
          } catch {
            return "Invalid cron expression";
          }
        },
      },
      {
        type: "list",
        name: "participants",
        message: "Participants mode:",
        choices: [
          { name: "All agents", value: "all" },
          { name: "Department", value: "department" },
          { name: "Hierarchy (manager + reports)", value: "hierarchy" },
          { name: "Custom roles", value: "custom" },
        ],
        default: participants || "all",
      },
      {
        type: "list",
        name: "format",
        message: "Discussion format:",
        choices: [
          { name: "Structured (agenda-driven)", value: "structured" },
          { name: "Free-form", value: "free_form" },
          { name: "Async", value: "async" },
        ],
        default: format || "structured",
      },
    ]);

    eventType = answers.type;
    name = answers.name;
    cron = answers.cron || cron;
    participants = answers.participants;
    format = answers.format;
  }

  if (!eventType) {
    console.error(chalk.red("  Error: --type is required.\n"));
    process.exit(1);
  }

  const em = getEventManager(options.dir);
  try {
    const event = em.createEvent({
      event_type: eventType as EventType,
      name: name || undefined,
      cron_expression: cron || undefined,
      discussion_format: (format as DiscussionFormat) || undefined,
      participants_config: participants
        ? {
            mode: participants as
              | "all"
              | "department"
              | "hierarchy"
              | "custom",
          }
        : undefined,
    });

    // Create schedule if cron is specified
    if (event.cron_expression) {
      try {
        const projectDir = path.resolve(options.dir);
        const scheduleId = em.createEventSchedule(event, projectDir);
        console.log(
          chalk.dim(`  Associated schedule #${scheduleId} created`)
        );
      } catch (e) {
        console.log(
          chalk.yellow(
            `  Warning: Could not create schedule: ${e instanceof Error ? e.message : String(e)}`
          )
        );
      }
    }

    console.log(header("Event Created"));
    console.log(`  ID:           #${event.id}`);
    console.log(`  Name:         ${event.name}`);
    console.log(`  Type:         ${event.event_type}`);
    console.log(`  Format:       ${event.discussion_format}`);
    if (event.cron_expression) {
      console.log(`  Cron:         ${event.cron_expression}`);
    }
    if (event.next_run_at) {
      console.log(`  Next run:     ${event.next_run_at}`);
    }
    console.log();
  } finally {
    em.close();
  }
}

// --- Show ---

export async function eventsShowCommand(
  id: string,
  options: EventOptions
): Promise<void> {
  const em = getEventManager(options.dir);
  try {
    const event = em.getEvent(parseInt(id, 10));
    if (!event) {
      console.error(chalk.red(`  Event #${id} not found.\n`));
      process.exit(1);
    }

    console.log(header(`Event #${event.id}`));
    console.log(`  Name:         ${event.name}`);
    console.log(`  Type:         ${event.event_type}`);
    if (event.description) {
      console.log(`  Description:  ${event.description}`);
    }
    console.log(`  Format:       ${event.discussion_format}`);
    console.log(
      `  Enabled:      ${event.enabled ? chalk.green("yes") : chalk.red("no")}`
    );
    if (event.cron_expression) {
      console.log(`  Cron:         ${event.cron_expression}`);
    }
    if (event.schedule_id) {
      console.log(`  Schedule:     #${event.schedule_id}`);
    }
    console.log(`  Next run:     ${event.next_run_at || "-"}`);
    console.log(
      `  Last run:     ${event.last_run_at ? formatTimeAgo(event.last_run_at) : "-"}`
    );
    console.log(`  Runs:         ${event.run_count}`);
    console.log(`  Created:      ${formatTimeAgo(event.created_at)}`);

    // Participants config
    try {
      const pConfig = JSON.parse(event.participants_config);
      console.log(`  Participants: ${pConfig.mode}${pConfig.departments ? ` (${pConfig.departments.join(", ")})` : ""}${pConfig.roles ? ` (${pConfig.roles.join(", ")})` : ""}`);
    } catch {
      console.log(`  Participants: ${event.participants_config}`);
    }

    // Agenda
    if (event.agenda_template) {
      console.log(chalk.bold("\n  Agenda Template:"));
      for (const line of event.agenda_template.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    // Recent instances
    const instances = em.getInstancesForEvent(event.id, 5);
    if (instances.length > 0) {
      console.log(chalk.bold("\n  Recent Instances:"));
      const table = createTable([
        "ID",
        "Status",
        "Started",
        "Completed",
        "Cost",
      ]);
      for (const inst of instances) {
        table.push([
          `#${inst.id}`,
          statusIcon(inst.status),
          inst.started_at
            ? formatTimeAgo(inst.started_at)
            : "-",
          inst.completed_at
            ? formatTimeAgo(inst.completed_at)
            : "-",
          `$${inst.cost_usd.toFixed(4)}`,
        ]);
      }
      console.log(table.toString());
    }

    console.log();
  } finally {
    em.close();
  }
}

// --- Delete ---

export async function eventsDeleteCommand(
  id: string,
  options: EventOptions
): Promise<void> {
  const em = getEventManager(options.dir);
  try {
    const event = em.getEvent(parseInt(id, 10));
    if (!event) {
      console.error(chalk.red(`  Event #${id} not found.\n`));
      process.exit(1);
    }

    em.deleteEvent(event.id);
    console.log(
      chalk.green(`  Deleted event #${id}: ${event.name}\n`)
    );
  } finally {
    em.close();
  }
}

// --- Enable / Disable ---

export async function eventsEnableCommand(
  id: string,
  options: EventOptions
): Promise<void> {
  const em = getEventManager(options.dir);
  try {
    const event = em.getEvent(parseInt(id, 10));
    if (!event) {
      console.error(chalk.red(`  Event #${id} not found.\n`));
      process.exit(1);
    }

    em.enableEvent(event.id);
    const updated = em.getEvent(event.id);
    console.log(
      chalk.green(`  Enabled event #${id}: ${event.name}`)
    );
    if (updated?.next_run_at) {
      console.log(`  Next run: ${updated.next_run_at}`);
    }
    console.log();
  } finally {
    em.close();
  }
}

export async function eventsDisableCommand(
  id: string,
  options: EventOptions
): Promise<void> {
  const em = getEventManager(options.dir);
  try {
    const event = em.getEvent(parseInt(id, 10));
    if (!event) {
      console.error(chalk.red(`  Event #${id} not found.\n`));
      process.exit(1);
    }

    em.disableEvent(event.id);
    console.log(
      chalk.green(`  Disabled event #${id}: ${event.name}\n`)
    );
  } finally {
    em.close();
  }
}

// --- Minutes ---

interface MinutesOptions extends EventOptions {
  event?: string;
  limit?: string;
}

export async function eventsMinutesCommand(
  instanceId: string | undefined,
  options: MinutesOptions
): Promise<void> {
  const em = getEventManager(options.dir);
  try {
    if (instanceId) {
      // Show specific instance minutes
      const instance = em.getInstance(parseInt(instanceId, 10));
      if (!instance) {
        console.error(
          chalk.red(`  Instance #${instanceId} not found.\n`)
        );
        process.exit(1);
      }

      console.log(header(`Meeting Minutes — Instance #${instance.id}`));
      if (instance.minutes) {
        console.log(instance.minutes);
      } else {
        console.log(chalk.dim("  No minutes recorded.\n"));
      }

      // Show action items
      try {
        const items = JSON.parse(instance.action_items || "[]");
        if (items.length > 0) {
          console.log(chalk.bold("\n  Action Items:"));
          for (const item of items) {
            console.log(
              `  - ${item.assignee}: ${item.description}${item.deadline ? ` (by ${item.deadline})` : ""}`
            );
          }
        }
      } catch {
        // Invalid JSON — skip
      }

      console.log();
      return;
    }

    // List recent minutes
    const eventId = options.event
      ? parseInt(options.event, 10)
      : undefined;
    const limit = options.limit
      ? parseInt(options.limit, 10)
      : 10;

    let instances;
    if (eventId) {
      instances = em.getInstancesForEvent(eventId, limit);
    } else {
      instances = em.getAllInstanceHistory(limit);
    }

    const completed = instances.filter(
      (i) =>
        i.status === "completed" && i.minutes
    );

    if (completed.length === 0) {
      console.log(
        chalk.dim("  No meeting minutes found.\n")
      );
      return;
    }

    console.log(header("Meeting Minutes"));
    const table = createTable([
      "Instance",
      "Event",
      "Completed",
      "Summary",
    ]);
    for (const inst of completed) {
      const summary =
        inst.summary && inst.summary.length > 50
          ? inst.summary.slice(0, 50) + "..."
          : inst.summary || "-";
      table.push([
        `#${inst.id}`,
        "event_name" in inst
          ? (inst as unknown as { event_name: string }).event_name
          : `Event #${inst.event_id}`,
        inst.completed_at
          ? formatTimeAgo(inst.completed_at)
          : "-",
        summary,
      ]);
    }
    console.log(table.toString());
    console.log();
  } finally {
    em.close();
  }
}

// --- Setup ---

export async function eventsSetupCommand(
  options: EventOptions
): Promise<void> {
  console.log(header("Setting Up Default Events"));

  const projectDir = path.resolve(options.dir);
  const config = loadConfig(projectDir);
  const eventConfig = (config.extensions?.events || {}) as EventConfig;

  const defaultEvents = eventConfig.default_events || [];

  if (defaultEvents.length === 0) {
    console.log(
      chalk.dim(
        "  No default events configured in aicib.config.yaml.\n"
      )
    );
    console.log(
      chalk.dim(
        "  Add events to `events.default_events` in your config, or create manually:\n"
      )
    );
    console.log(
      chalk.dim("    aicib events create --type standup --cron \"0 9 * * 1-5\"\n")
    );
    return;
  }

  const em = getEventManager(options.dir);
  try {
    const created = em.setupDefaultEvents(
      defaultEvents,
      projectDir,
      config
    );

    console.log(
      chalk.green(`  Created ${created.length} events:\n`)
    );
    for (const event of created) {
      console.log(
        `  #${event.id} ${event.name} (${event.event_type})${event.cron_expression ? ` — ${event.cron_expression}` : ""}`
      );
    }
    console.log();
  } finally {
    em.close();
  }
}

// --- History ---

interface HistoryOptions extends EventOptions {
  event?: string;
  limit?: string;
}

export async function eventsHistoryCommand(
  options: HistoryOptions
): Promise<void> {
  console.log(header("Event History"));

  const em = getEventManager(options.dir);
  try {
    const limit = options.limit
      ? parseInt(options.limit, 10)
      : 20;

    let instances;
    if (options.event) {
      const eventId = parseInt(options.event, 10);
      instances = em.getInstancesForEvent(eventId, limit);
    } else {
      instances = em.getAllInstanceHistory(limit);
    }

    if (instances.length === 0) {
      console.log(chalk.dim("  No event history found.\n"));
      return;
    }

    const table = createTable([
      "ID",
      "Event",
      "Status",
      "Started",
      "Completed",
      "Duration",
      "Cost",
    ]);

    for (const inst of instances) {
      const durationStr =
        inst.duration_ms > 0
          ? `${(inst.duration_ms / 1000 / 60).toFixed(1)}m`
          : "-";
      table.push([
        `#${inst.id}`,
        "event_name" in inst
          ? (inst as unknown as { event_name: string }).event_name
          : `Event #${inst.event_id}`,
        statusIcon(inst.status),
        inst.started_at
          ? formatTimeAgo(inst.started_at)
          : "-",
        inst.completed_at
          ? formatTimeAgo(inst.completed_at)
          : "-",
        durationStr,
        `$${inst.cost_usd.toFixed(4)}`,
      ]);
    }

    console.log(table.toString());
    console.log();
  } finally {
    em.close();
  }
}
