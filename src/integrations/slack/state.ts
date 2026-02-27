/**
 * Shared SQLite helpers for Slack integration.
 *
 * Used by both the daemon process and CLI commands to read/write
 * the slack_state table without duplicating boilerplate.
 */

import Database from "better-sqlite3";
import path from "node:path";

export function getSlackDb(projectDir: string): Database.Database {
  const dbPath = path.join(projectDir, ".aicib", "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function getStateValue(db: Database.Database, key: string): string | null {
  try {
    const row = db.prepare("SELECT value FROM slack_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setStateValue(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO slack_state (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(key, value);
}
