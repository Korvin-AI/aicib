/**
 * Shared SQLite helpers for the Scheduler daemon.
 *
 * Used by both the daemon process and CLI commands to read/write
 * the scheduler_state table without duplicating boilerplate.
 * Pattern: src/integrations/slack/state.ts
 */

import Database from "better-sqlite3";
import path from "node:path";

export function getSchedulerDb(projectDir: string): Database.Database {
  const dbPath = path.join(projectDir, ".aicib", "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function getStateValue(db: Database.Database, key: string): string | null {
  try {
    const row = db.prepare("SELECT value FROM scheduler_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setStateValue(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO scheduler_state (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(key, value);
}

export const SCHEDULER_STATE_KEYS = {
  DAEMON_PID: "daemon_pid",
  DAEMON_HEARTBEAT: "daemon_heartbeat",
  CONNECTION_STATE: "connection_state",
} as const;
