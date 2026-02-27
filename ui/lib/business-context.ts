import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  getActiveBusiness,
  getBusinessById,
  type BusinessRegistryEntry,
} from "./business-registry";

export interface BusinessHealth {
  configExists: boolean;
  dbExists: boolean;
  sessionActive: boolean;
}

function walkUpForConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "aicib.config.yaml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return null;
}

function resolveLegacyProjectDir(): string | null {
  const envDir = process.env.AICIB_PROJECT_DIR;
  if (envDir) return path.resolve(envDir);
  return walkUpForConfig(process.cwd());
}

export function tryGetActiveProjectDir(): string | null {
  const active = getActiveBusiness();
  if (active) return active.projectDir;
  return resolveLegacyProjectDir();
}

export function getActiveProjectDir(): string {
  const projectDir = tryGetActiveProjectDir();
  if (projectDir) return projectDir;
  throw new Error(
    "No active business selected. Create or import a business first."
  );
}

export function getResolvedBusiness(
  businessId?: string | null
): BusinessRegistryEntry | null {
  if (businessId && businessId.trim()) {
    return getBusinessById(businessId.trim());
  }
  return getActiveBusiness();
}

export function getBusinessHealth(projectDir: string): BusinessHealth {
  const configPath = path.join(projectDir, "aicib.config.yaml");
  const dbPath = path.join(projectDir, ".aicib", "state.db");

  const configExists = fs.existsSync(configPath);
  const dbExists = fs.existsSync(dbPath);

  if (!dbExists) {
    return {
      configExists,
      dbExists,
      sessionActive: false,
    };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");

    const hasSessionsTable = !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions' LIMIT 1"
      )
      .get();

    if (!hasSessionsTable) {
      return {
        configExists,
        dbExists,
        sessionActive: false,
      };
    }

    const activeSession = db
      .prepare(
        "SELECT id FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
      )
      .get() as { id: string } | undefined;

    return {
      configExists,
      dbExists,
      sessionActive: !!activeSession,
    };
  } catch {
    return {
      configExists,
      dbExists,
      sessionActive: false,
    };
  } finally {
    db?.close();
  }
}
