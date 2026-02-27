import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { getProjectDir } from "./config";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;

function resolveDbPath(projectDir: string): string {
  const dbDir = path.join(projectDir, ".aicib");
  fs.mkdirSync(dbDir, { recursive: true });
  return path.join(dbDir, "state.db");
}

/**
 * Get a shared SQLite database connection to .aicib/state.db.
 * Sets WAL mode and 5s busy timeout. Connection is cached since
 * the Next.js dev server is long-lived.
 */
export function getDb(): Database.Database {
  const projectDir = getProjectDir();
  const dbPath = resolveDbPath(projectDir);

  if (cachedDb && cachedDbPath === dbPath) {
    return cachedDb;
  }

  if (cachedDb && cachedDbPath !== dbPath) {
    try {
      cachedDb.close();
    } catch {
      // Ignore close errors and replace stale handle.
    }
    cachedDb = null;
    cachedDbPath = null;
  }

  // Opening write-mode will create an empty DB when missing.
  cachedDb = new Database(dbPath);
  cachedDb.pragma("journal_mode = WAL");
  cachedDb.pragma("busy_timeout = 5000");
  cachedDbPath = dbPath;

  return cachedDb;
}

/**
 * Open a fresh read-only database connection (for SSE streams that
 * need their own connection lifecycle).
 */
export function openReadOnlyDb(): Database.Database {
  const projectDir = getProjectDir();
  const dbPath = resolveDbPath(projectDir);

  if (!fs.existsSync(dbPath)) {
    // Create an empty file first, then reopen in readonly mode.
    const warmup = new Database(dbPath);
    warmup.close();
  }

  const db = new Database(dbPath, { readonly: true });
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  return db;
}
