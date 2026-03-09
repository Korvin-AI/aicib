/**
 * Shared SQLite helpers for the Cloud Agent daemon.
 *
 * Used by both the daemon process and CLI commands to read/write
 * the cloud_agent_state table without duplicating boilerplate.
 * Pattern: src/core/scheduler-state.ts
 */

import Database from "better-sqlite3";
import path from "node:path";

export function getCloudAgentDb(projectDir: string): Database.Database {
  const dbPath = path.join(projectDir, ".aicib", "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function getStateValue(db: Database.Database, key: string): string | null {
  try {
    const row = db
      .prepare("SELECT value FROM cloud_agent_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setStateValue(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO cloud_agent_state (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(key, value);
}

export const CLOUD_AGENT_STATE_KEYS = {
  DAEMON_PID: "daemon_pid",
  DAEMON_HEARTBEAT: "daemon_heartbeat",
  CONNECTION_STATE: "connection_state",
  CURRENT_JOB_ID: "current_job_id",
  LAST_POLL_AT: "last_poll_at",
  LAST_ERROR: "last_error",
} as const;
