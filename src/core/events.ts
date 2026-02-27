/**
 * Core business logic for the Company Events system.
 *
 * Provides types, templates, and the EventManager class that handles
 * event CRUD, participant resolution, agenda generation, minutes formatting,
 * action item extraction, and scheduler integration.
 */

import Database from "better-sqlite3";
import path from "node:path";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;

import { buildOrgTree, type OrgNode } from "./org-chart.js";
import { ScheduleManager } from "./scheduler.js";
import type { AicibConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType =
  | "standup"
  | "all_hands"
  | "sprint_planning"
  | "quarterly_review"
  | "one_on_one"
  | "retrospective"
  | "custom";
export type DiscussionFormat = "async" | "structured" | "free_form";
export type EventInstanceStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "skipped";

export interface ParticipantsConfig {
  mode: "all" | "department" | "hierarchy" | "custom";
  departments?: string[];
  roles?: string[];
  include_reports?: boolean;
  manager_role?: string;
}

export interface ActionItem {
  description: string;
  assignee: string;
  deadline?: string;
  task_id?: number;
}

export interface CompanyEvent {
  id: number;
  name: string;
  event_type: EventType;
  description: string;
  schedule_id: number | null;
  cron_expression: string | null;
  discussion_format: DiscussionFormat;
  participants_config: string; // JSON
  agenda_template: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface EventInstance {
  id: number;
  event_id: number;
  status: EventInstanceStatus;
  participants: string; // JSON
  agenda: string;
  minutes: string;
  action_items: string; // JSON
  summary: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  cost_usd: number;
  created_at: string;
}

export interface CreateEventInput {
  name?: string;
  event_type: EventType;
  description?: string;
  cron_expression?: string;
  discussion_format?: DiscussionFormat;
  participants_config?: ParticipantsConfig;
  agenda_template?: string;
}

export interface EventFilter {
  event_type?: EventType;
  enabled?: boolean;
}

export interface EventConfig {
  enabled: boolean;
  default_events: CreateEventInput[];
  max_context_events: number;
  auto_create_action_items: boolean;
  minutes_format: "structured" | "narrative" | "bullet";
}

export const EVENTS_CONFIG_DEFAULTS: EventConfig = {
  enabled: true,
  default_events: [],
  max_context_events: 5,
  auto_create_action_items: true,
  minutes_format: "structured",
};

// ---------------------------------------------------------------------------
// Event Templates
// ---------------------------------------------------------------------------

export interface EventTemplate {
  name: string;
  event_type: EventType;
  discussion_format: DiscussionFormat;
  participants_config: ParticipantsConfig;
  agenda_template: string;
}

export const EVENT_TEMPLATES: Record<EventType, EventTemplate> = {
  standup: {
    name: "Daily Standup",
    event_type: "standup",
    discussion_format: "structured",
    participants_config: { mode: "department" },
    agenda_template: [
      "1. Progress since last standup",
      "2. Plan for today",
      "3. Blockers and escalations",
    ].join("\n"),
  },
  all_hands: {
    name: "Monthly All-Hands",
    event_type: "all_hands",
    discussion_format: "structured",
    participants_config: { mode: "all" },
    agenda_template: [
      "1. Company metrics and KPIs",
      "2. Department updates",
      "3. Strategic initiatives",
      "4. Open floor / Q&A",
    ].join("\n"),
  },
  sprint_planning: {
    name: "Sprint Planning",
    event_type: "sprint_planning",
    discussion_format: "structured",
    participants_config: { mode: "department", departments: ["engineering"] },
    agenda_template: [
      "1. Sprint retrospective summary",
      "2. Backlog review and prioritization",
      "3. Sprint goal and commitments",
      "4. Task assignments and estimates",
    ].join("\n"),
  },
  quarterly_review: {
    name: "Quarterly Business Review",
    event_type: "quarterly_review",
    discussion_format: "structured",
    participants_config: {
      mode: "custom",
      roles: ["ceo", "cto", "cfo", "cmo"],
    },
    agenda_template: [
      "1. Revenue and financial overview",
      "2. Product milestones",
      "3. Customer acquisition and retention",
      "4. Team and organizational health",
      "5. Next quarter objectives and key results",
    ].join("\n"),
  },
  one_on_one: {
    name: "One-on-One",
    event_type: "one_on_one",
    discussion_format: "free_form",
    participants_config: { mode: "hierarchy", include_reports: true },
    agenda_template: [
      "1. Wins and accomplishments",
      "2. Challenges and support needed",
      "3. Growth and development goals",
      "4. Feedback (both directions)",
    ].join("\n"),
  },
  retrospective: {
    name: "Retrospective",
    event_type: "retrospective",
    discussion_format: "structured",
    participants_config: { mode: "department" },
    agenda_template: [
      "1. What went well",
      "2. What could be improved",
      "3. Action items for next sprint",
    ].join("\n"),
  },
  custom: {
    name: "Custom Meeting",
    event_type: "custom",
    discussion_format: "free_form",
    participants_config: { mode: "all" },
    agenda_template: "1. Discussion items",
  },
};

// ---------------------------------------------------------------------------
// EventManager
// ---------------------------------------------------------------------------

export class EventManager {
  private db: Database.Database;

  constructor(projectDir: string) {
    const dbPath = path.join(projectDir, ".aicib", "state.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
  }

  close(): void {
    this.db.close();
  }

  // --- Event CRUD ---

  createEvent(input: CreateEventInput): CompanyEvent {
    const template = EVENT_TEMPLATES[input.event_type] || EVENT_TEMPLATES.custom;

    const name = input.name || template.name;
    const format = input.discussion_format || template.discussion_format;
    const participantsConfig =
      input.participants_config || template.participants_config;
    const agendaTemplate =
      input.agenda_template || template.agenda_template;

    if (input.cron_expression) {
      try {
        parseExpression(input.cron_expression);
      } catch (e) {
        throw new Error(
          `Invalid cron expression "${input.cron_expression}": ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const nextRun = input.cron_expression
      ? this.computeNextRun(input.cron_expression)
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO company_events (name, event_type, description, cron_expression,
        discussion_format, participants_config, agenda_template, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      input.event_type,
      input.description || "",
      input.cron_expression || null,
      format,
      JSON.stringify(participantsConfig),
      agendaTemplate,
      nextRun
    );

    return this.getEvent(Number(result.lastInsertRowid))!;
  }

  getEvent(id: number): CompanyEvent | undefined {
    return this.db
      .prepare("SELECT * FROM company_events WHERE id = ?")
      .get(id) as CompanyEvent | undefined;
  }

  listEvents(filter?: EventFilter): CompanyEvent[] {
    let sql = "SELECT * FROM company_events WHERE 1=1";
    const params: unknown[] = [];

    if (filter?.event_type) {
      sql += " AND event_type = ?";
      params.push(filter.event_type);
    }
    if (filter?.enabled !== undefined) {
      sql += " AND enabled = ?";
      params.push(filter.enabled ? 1 : 0);
    }

    sql += " ORDER BY id ASC";
    return this.db.prepare(sql).all(...params) as CompanyEvent[];
  }

  updateEvent(
    id: number,
    fields: Partial<
      Pick<
        CompanyEvent,
        | "name"
        | "description"
        | "cron_expression"
        | "discussion_format"
        | "participants_config"
        | "agenda_template"
        | "schedule_id"
        | "last_run_at"
        | "next_run_at"
        | "run_count"
      >
    > & { enabled?: number }
  ): void {
    const ALLOWED_COLUMNS = new Set([
      "name",
      "description",
      "cron_expression",
      "discussion_format",
      "participants_config",
      "agenda_template",
      "enabled",
      "schedule_id",
      "last_run_at",
      "next_run_at",
      "run_count",
    ]);

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED_COLUMNS.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE company_events SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  deleteEvent(id: number): boolean {
    const result = this.db
      .prepare("DELETE FROM company_events WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  enableEvent(id: number): void {
    const event = this.getEvent(id);
    if (!event) return;

    const nextRun = event.cron_expression
      ? this.computeNextRun(event.cron_expression)
      : null;

    this.db
      .prepare(
        "UPDATE company_events SET enabled = 1, next_run_at = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(nextRun, id);
  }

  disableEvent(id: number): void {
    this.db
      .prepare(
        "UPDATE company_events SET enabled = 0, updated_at = datetime('now') WHERE id = ?"
      )
      .run(id);
  }

  // --- Event Instances ---

  createInstance(
    eventId: number,
    participants: string[]
  ): EventInstance {
    const stmt = this.db.prepare(`
      INSERT INTO event_instances (event_id, status, participants, agenda, minutes, action_items, summary)
      VALUES (?, 'scheduled', ?, '', '', '[]', '')
    `);

    const result = stmt.run(eventId, JSON.stringify(participants));
    return this.getInstance(Number(result.lastInsertRowid))!;
  }

  getInstance(id: number): EventInstance | undefined {
    return this.db
      .prepare("SELECT * FROM event_instances WHERE id = ?")
      .get(id) as EventInstance | undefined;
  }

  getInstancesForEvent(eventId: number, limit = 10): EventInstance[] {
    return this.db
      .prepare(
        `SELECT * FROM event_instances
         WHERE event_id = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(eventId, limit) as EventInstance[];
  }

  getLatestInstance(eventId: number): EventInstance | undefined {
    return this.db
      .prepare(
        `SELECT * FROM event_instances
         WHERE event_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(eventId) as EventInstance | undefined;
  }

  updateInstance(
    id: number,
    fields: Partial<
      Pick<
        EventInstance,
        | "status"
        | "participants"
        | "agenda"
        | "minutes"
        | "action_items"
        | "summary"
        | "started_at"
        | "completed_at"
        | "duration_ms"
        | "cost_usd"
      >
    >
  ): void {
    const ALLOWED_COLUMNS = new Set([
      "status",
      "participants",
      "agenda",
      "minutes",
      "action_items",
      "summary",
      "started_at",
      "completed_at",
      "duration_ms",
      "cost_usd",
    ]);

    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (!ALLOWED_COLUMNS.has(key)) continue;
      sets.push(`${key} = ?`);
      values.push(value);
    }

    if (sets.length === 0) return;
    values.push(id);

    this.db
      .prepare(`UPDATE event_instances SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  // --- Participant Resolution ---

  resolveParticipants(
    config: ParticipantsConfig,
    projectDir: string,
    aicibConfig: AicibConfig
  ): string[] {
    const tree = buildOrgTree(projectDir, aicibConfig);

    switch (config.mode) {
      case "all":
        return flattenTree(tree);

      case "department": {
        const departments = config.departments || [];
        if (departments.length === 0) return flattenTree(tree);

        const roles: string[] = [];
        for (const child of tree.children) {
          if (
            departments.includes(child.role) ||
            departments.some((d) =>
              child.role.toLowerCase().includes(d.toLowerCase())
            )
          ) {
            roles.push(child.role);
            for (const worker of child.children) {
              roles.push(worker.role);
            }
          }
        }
        return roles.length > 0 ? roles : flattenTree(tree);
      }

      case "hierarchy": {
        const managerRole = config.manager_role || "ceo";
        const roles: string[] = [managerRole];
        if (config.include_reports) {
          const manager = findNode(tree, managerRole);
          if (manager) {
            for (const child of manager.children) {
              roles.push(child.role);
            }
          }
        }
        return roles;
      }

      case "custom":
        return config.roles || flattenTree(tree);

      default:
        return flattenTree(tree);
    }
  }

  // --- Agenda Generation ---

  generateAgenda(
    event: CompanyEvent,
    _participants: string[],
    _projectDir: string
  ): string {
    // For now, return the template. Future: populate with real context
    return event.agenda_template;
  }

  // --- Event Directive ---

  buildEventDirective(
    event: CompanyEvent,
    instance: EventInstance
  ): string {
    let participantList: string[] = [];
    try {
      participantList = JSON.parse(instance.participants || "[]") as string[];
    } catch {
      participantList = [];
    }
    const participantStr = participantList.join(", ");

    return [
      `[EVENT::${event.id}::${instance.id}] You are facilitating a ${event.name} (${event.event_type}).`,
      `Format: ${event.discussion_format}`,
      `Participants: ${participantStr}`,
      "",
      "Agenda:",
      instance.agenda || event.agenda_template,
      "",
      "Instructions:",
      "- Gather input from each participant based on the agenda items",
      "- Synthesize responses into structured meeting minutes",
      "- Identify action items using: ACTION_ITEM:: assignee=<role> description=\"<text>\" [deadline=<date>]",
      "- Provide a brief executive summary at the end",
    ].join("\n");
  }

  // --- Action Item Extraction ---

  extractActionItems(text: string): ActionItem[] {
    const items: ActionItem[] = [];
    const seen = new Set<string>();

    // Parse structured markers: ACTION_ITEM:: assignee=<role> description="<text>" [deadline=<date>]
    const markerRegex =
      /ACTION_ITEM::\s+assignee=(\S+)\s+description="([^"]+)"(?:\s+deadline=(\S+))?/g;
    for (const match of text.matchAll(markerRegex)) {
      const key = `${match[1]}:${match[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          assignee: match[1],
          description: match[2],
          deadline: match[3] || undefined,
        });
      }
    }

    // NL pattern: "<role> will <action>"
    const nlRegex =
      /\b(ceo|cto|cfo|cmo|[\w-]+(?:-engineer|analyst|writer|scientist|manager))\s+will\s+([^.]+)\./gi;
    for (const match of text.matchAll(nlRegex)) {
      const key = `${match[1].toLowerCase()}:${match[2].trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          assignee: match[1].toLowerCase(),
          description: match[2].trim(),
        });
      }
    }

    return items;
  }

  // --- Minutes Formatting ---

  formatMinutes(
    event: CompanyEvent,
    _instanceId: number,
    rawOutput: string,
    format: "structured" | "narrative" | "bullet"
  ): string {
    const header = `# ${event.name} Minutes\n\nDate: ${new Date().toISOString().split("T")[0]}\nType: ${event.event_type}\n\n`;

    switch (format) {
      case "structured":
        return `${header}## Summary\n\n${rawOutput}`;
      case "bullet":
        return `${header}${rawOutput
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => `- ${l.trim()}`)
          .join("\n")}`;
      case "narrative":
      default:
        return `${header}${rawOutput}`;
    }
  }

  // --- Scheduler Integration ---

  createEventSchedule(event: CompanyEvent, projectDir: string): number {
    if (!event.cron_expression) {
      throw new Error("Event has no cron expression — cannot create schedule");
    }

    let participantsConfig: ParticipantsConfig;
    try {
      participantsConfig = JSON.parse(event.participants_config) as ParticipantsConfig;
    } catch {
      participantsConfig = { mode: "all" };
    }

    // Create a placeholder instance — actual instance created at execution time
    const directive = [
      `[EVENT::${event.id}::0]`,
      `Facilitate ${event.name} (${event.event_type}).`,
      `Participants mode: ${participantsConfig.mode}`,
      `Agenda:\n${event.agenda_template}`,
    ].join(" ");

    const sm = new ScheduleManager(projectDir);
    try {
      const schedule = sm.createSchedule({
        name: `Event: ${event.name}`,
        description: `Auto-created schedule for ${event.event_type} event`,
        cron_expression: event.cron_expression,
        directive,
        agent_target: "ceo",
      });

      this.updateEvent(event.id, { schedule_id: schedule.id });
      return schedule.id;
    } finally {
      sm.close();
    }
  }

  // --- Default Events Setup ---

  setupDefaultEvents(
    eventConfigs: CreateEventInput[],
    projectDir: string,
    _aicibConfig: AicibConfig
  ): CompanyEvent[] {
    const created: CompanyEvent[] = [];

    for (const input of eventConfigs) {
      const event = this.createEvent(input);

      if (event.cron_expression) {
        try {
          this.createEventSchedule(event, projectDir);
        } catch {
          // Schedule creation is best-effort
        }
      }

      created.push(event);
    }

    return created;
  }

  // --- Cron Computation ---

  computeNextRun(cronExpression: string, fromDate?: Date): string | null {
    try {
      const interval = parseExpression(cronExpression, {
        currentDate: fromDate || new Date(),
        utc: false,
      });
      const next = interval.next().toDate();
      return next.toISOString().replace("T", " ").slice(0, 19);
    } catch {
      return null;
    }
  }

  // --- Context Formatting ---

  formatForContext(maxEvents?: number): string {
    const max = maxEvents || 5;
    const events = this.listEvents({ enabled: true });
    if (events.length === 0) return "";

    const lines: string[] = ["## Company Events"];

    // Upcoming events
    const upcoming = events
      .filter((e) => e.next_run_at)
      .sort((a, b) => (a.next_run_at || "").localeCompare(b.next_run_at || ""))
      .slice(0, max);

    if (upcoming.length > 0) {
      lines.push("\nUpcoming:");
      for (const e of upcoming) {
        lines.push(
          `- [Event #${e.id}] "${e.name}" (${e.event_type}) → next: ${e.next_run_at}`
        );
      }
    }

    // Recent meeting summaries
    const recentInstances = this.db
      .prepare(
        `SELECT ei.*, ce.name as event_name, ce.event_type
         FROM event_instances ei
         JOIN company_events ce ON ei.event_id = ce.id
         WHERE ei.status = 'completed' AND ei.summary != ''
         ORDER BY ei.completed_at DESC LIMIT 3`
      )
      .all() as (EventInstance & { event_name: string; event_type: string })[];

    if (recentInstances.length > 0) {
      lines.push("\nRecent meetings:");
      for (const inst of recentInstances) {
        const summary =
          inst.summary.length > 100
            ? inst.summary.slice(0, 100) + "..."
            : inst.summary;
        lines.push(`- ${inst.event_name}: ${summary}`);
      }
    }

    // Pending action items from recent instances
    const actionInstances = this.db
      .prepare(
        `SELECT action_items FROM event_instances
         WHERE status = 'completed' AND action_items != '[]'
         ORDER BY completed_at DESC LIMIT 5`
      )
      .all() as { action_items: string }[];

    const allActions: ActionItem[] = [];
    for (const inst of actionInstances) {
      try {
        const items = JSON.parse(inst.action_items) as ActionItem[];
        allActions.push(...items.filter((a) => !a.task_id));
      } catch {
        // Invalid JSON — skip
      }
    }

    if (allActions.length > 0) {
      lines.push("\nPending action items from meetings:");
      for (const item of allActions.slice(0, 5)) {
        lines.push(`- ${item.assignee}: ${item.description}`);
      }
    }

    lines.push(
      "\nTo manage events, use EVENT:: markers:",
      'EVENT::CREATE type=<type> name="<name>" [cron="<expr>"] [participants=<mode>] [format=<fmt>]',
      'EVENT::COMPLETE id=<n> [summary="<text>"]',
      "EVENT::CANCEL id=<n>",
      'EVENT::ACTION_ITEM assignee=<role> description="<text>" [deadline=<date>]'
    );

    return lines.join("\n");
  }

  // --- History ---

  getAllInstanceHistory(limit = 20): (EventInstance & { event_name: string })[] {
    return this.db
      .prepare(
        `SELECT ei.*, ce.name as event_name
         FROM event_instances ei
         JOIN company_events ce ON ei.event_id = ce.id
         ORDER BY ei.id DESC LIMIT ?`
      )
      .all(limit) as (EventInstance & { event_name: string })[];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenTree(node: OrgNode): string[] {
  const roles: string[] = [node.role];
  for (const child of node.children) {
    roles.push(...flattenTree(child));
  }
  return roles;
}

function findNode(tree: OrgNode, role: string): OrgNode | undefined {
  if (tree.role === role) return tree;
  for (const child of tree.children) {
    const found = findNode(child, role);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function validateEventConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
      errors.push("events.enabled must be a boolean");
    }

    if (obj.max_context_events !== undefined) {
      if (
        typeof obj.max_context_events !== "number" ||
        obj.max_context_events < 1 ||
        obj.max_context_events > 20
      ) {
        errors.push(
          "events.max_context_events must be a number between 1 and 20"
        );
      }
    }

    if (obj.auto_create_action_items !== undefined) {
      if (typeof obj.auto_create_action_items !== "boolean") {
        errors.push("events.auto_create_action_items must be a boolean");
      }
    }

    if (obj.minutes_format !== undefined) {
      const valid = ["structured", "narrative", "bullet"];
      if (!valid.includes(obj.minutes_format as string)) {
        errors.push(
          `events.minutes_format must be one of: ${valid.join(", ")}`
        );
      }
    }
  }
  return errors;
}
