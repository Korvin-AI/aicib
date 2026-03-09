/**
 * Hook registration for the Cloud Agent daemon.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `cloud_agent:` section in aicib.config.yaml
 * - Database table: cloud_agent_state
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";

// --- Config extension ---

registerConfigExtension({
  key: "cloud_agent",
  defaults: {
    api_url: "",
    api_key: "",
    poll_interval_seconds: 5,
  },
  validate: (raw) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object" && "poll_interval_seconds" in raw) {
      const interval = (raw as Record<string, unknown>).poll_interval_seconds;
      if (typeof interval === "number" && (interval < 1 || interval > 300)) {
        errors.push("cloud_agent.poll_interval_seconds must be between 1 and 300");
      }
    }
    return errors;
  },
});

// --- Database table ---

registerTable({
  name: "cloud_agent_state",
  createSQL: `CREATE TABLE IF NOT EXISTS cloud_agent_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
});
