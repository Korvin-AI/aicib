/**
 * Hook registration for the Slack integration.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `slack:` section in aicib.config.yaml
 * - Database tables: slack_state, slack_channels
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "../../core/config.js";
import { registerTable } from "../../core/cost-tracker.js";
import { SLACK_CONFIG_DEFAULTS } from "./types.js";

// --- Config extension ---

registerConfigExtension({
  key: "slack",
  defaults: { ...SLACK_CONFIG_DEFAULTS },
  validate: (raw: unknown) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;

      if (obj.channel_prefix !== undefined) {
        if (typeof obj.channel_prefix !== "string" || obj.channel_prefix.length === 0) {
          errors.push("slack.channel_prefix must be a non-empty string");
        } else if (!/^[a-z0-9-]+$/.test(obj.channel_prefix)) {
          errors.push("slack.channel_prefix must contain only lowercase letters, numbers, and hyphens");
        }
      }

      if (obj.debounce_ms !== undefined) {
        if (typeof obj.debounce_ms !== "number" || obj.debounce_ms < 0) {
          errors.push("slack.debounce_ms must be a non-negative number");
        }
      }

      const boolFields = ["enabled", "auto_create_channels", "thread_replies", "show_typing", "chat_enabled"];
      for (const field of boolFields) {
        if (obj[field] !== undefined && typeof obj[field] !== "boolean") {
          errors.push(`slack.${field} must be a boolean`);
        }
      }

      const budgetFields = ["chat_max_budget_head", "chat_max_budget_worker"];
      for (const field of budgetFields) {
        if (obj[field] !== undefined) {
          if (typeof obj[field] !== "number" || (obj[field] as number) < 0) {
            errors.push(`slack.${field} must be a non-negative number`);
          }
        }
      }

      if (obj.confirmation_timeout_ms !== undefined) {
        if (typeof obj.confirmation_timeout_ms !== "number" || obj.confirmation_timeout_ms < 0) {
          errors.push("slack.confirmation_timeout_ms must be a non-negative number");
        }
      }

      if (obj.custom_display_names !== undefined) {
        if (typeof obj.custom_display_names !== "object" || obj.custom_display_names === null || Array.isArray(obj.custom_display_names)) {
          errors.push("slack.custom_display_names must be an object mapping role names to display names");
        } else {
          for (const [, v] of Object.entries(obj.custom_display_names as Record<string, unknown>)) {
            if (typeof v !== "string") {
              errors.push("slack.custom_display_names values must be strings");
              break;
            }
          }
        }
      }
    }
    return errors;
  },
});

// --- Database tables ---

registerTable({
  name: "slack_state",
  createSQL: `CREATE TABLE IF NOT EXISTS slack_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
});

registerTable({
  name: "slack_channels",
  createSQL: `CREATE TABLE IF NOT EXISTS slack_channels (
    department TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
});

registerTable({
  name: "slack_chat_sessions",
  createSQL: `CREATE TABLE IF NOT EXISTS slack_chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aicib_session_id TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    sdk_session_id TEXT,
    channel_id TEXT NOT NULL,
    last_activity TEXT NOT NULL DEFAULT (datetime('now')),
    message_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(aicib_session_id, agent_role)
  )`,
});

