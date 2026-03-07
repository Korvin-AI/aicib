import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

/**
 * Open a SQLite DB for a specific project directory (not tied to the active business).
 * Creates the .aicib directory and state.db if they don't exist.
 */
export function getDbForProject(projectDir: string): Database.Database {
  const dbDir = path.join(projectDir, ".aicib");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "state.db");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

/**
 * Ensure the wiki_articles table exists in the given database.
 * Schema matches knowledge-register.ts.
 */
export function ensureWikiTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS wiki_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL DEFAULT 'ceo',
    updated_by TEXT NOT NULL DEFAULT 'ceo',
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_wiki_section ON wiki_articles(section)"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_wiki_slug ON wiki_articles(slug)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_wiki_updated ON wiki_articles(updated_at)"
  );
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_wiki_session ON wiki_articles(session_id)"
    );
  } catch {
    // Older DBs may lack session_id column — add it then retry
    try {
      db.exec("ALTER TABLE wiki_articles ADD COLUMN session_id TEXT");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_wiki_session ON wiki_articles(session_id)"
      );
    } catch {
      // Column may already exist or table is fresh — safe to ignore
    }
  }
}
