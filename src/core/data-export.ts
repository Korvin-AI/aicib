import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import yaml from "js-yaml";
import { CostTracker } from "./cost-tracker.js";

const require = createRequire(import.meta.url);
const { version: AICIB_VERSION } = require("../../package.json") as { version: string };

// --- Types ---

export type ExportMode = "full" | "selective" | "anonymized";

export type ExportCategory =
  | "configs"
  | "agents"
  | "costs"
  | "tasks"
  | "knowledge"
  | "hr"
  | "projects"
  | "safeguards"
  | "scheduler"
  | "integrations"
  | "runtime";

export interface ExportManifest {
  version: "1.0.0";
  aicib_version: string;
  export_mode: ExportMode;
  company_name: string;
  timestamp: string;
  categories: ExportCategory[];
  tables: string[];
  agent_count: number;
  table_row_counts: Record<string, number>;
}

export interface ExportOptions {
  projectDir: string;
  outputPath?: string;
  mode: ExportMode;
  categories?: ExportCategory[];
  compress: boolean;
  includeSecrets: boolean;
}

export interface ExportResult {
  outputPath: string;
  manifest: ExportManifest;
  fileCount: number;
  totalSize: number;
}

export interface ImportOptions {
  sourcePath: string;
  projectDir: string;
  merge: boolean;
  categories?: ExportCategory[];
  overwriteAgents: boolean;
  force: boolean;
  companyName?: string;
}

export interface ImportResult {
  tablesImported: number;
  rowsImported: number;
  agentsRestored: number;
  configRestored: boolean;
  conflictsSkipped: number;
}

// --- Category-to-table mapping ---

const CATEGORY_TABLES: Record<ExportCategory, string[]> = {
  configs: [],
  agents: [],
  costs: ["cost_entries", "sessions", "session_data"],
  tasks: ["tasks", "task_blockers", "task_comments"],
  knowledge: [
    "wiki_articles", "wiki_article_versions", "agent_journals",
    "decision_log", "project_archives",
  ],
  hr: ["hr_events", "hr_onboarding", "hr_reviews", "hr_improvement_plans"],
  projects: [
    "projects", "project_phases", "background_jobs",
    "background_logs", "ceo_journal",
  ],
  safeguards: ["safeguard_pending", "external_actions"],
  scheduler: ["schedules", "schedule_executions", "scheduler_state"],
  integrations: ["mcp_integrations", "slack_channels", "slack_chat_sessions", "slack_state"],
  runtime: ["agent_status", "escalation_events"],
};

const ALL_CATEGORIES: ExportCategory[] = [
  "configs", "agents", "costs", "tasks", "knowledge", "hr",
  "projects", "safeguards", "scheduler", "integrations", "runtime",
];

// --- Anonymization rules ---

type AnonymizeAction = "include" | "exclude" | "anonymize";

interface AnonymizeRule {
  action: AnonymizeAction;
  redact?: (row: Record<string, unknown>, index: number) => Record<string, unknown>;
}

const ANONYMIZE_RULES: Record<string, AnonymizeRule> = {
  // Fully preserved (structural)
  task_blockers: { action: "include" },
  hr_onboarding: { action: "include" },

  // Anonymized tables
  tasks: {
    action: "anonymize",
    redact: (row, i) => ({
      ...row,
      title: `Task #${row.id ?? i}`,
      description: "",
      project: "Project",
    }),
  },
  wiki_articles: {
    action: "anonymize",
    redact: (row) => ({
      ...row,
      title: `Article: ${row.slug ?? "untitled"}`,
      content: "",
    }),
  },
  agent_journals: {
    action: "anonymize",
    redact: (row) => ({
      ...row,
      title: "Journal entry",
      content: "",
    }),
  },
  decision_log: {
    action: "anonymize",
    redact: (row) => ({
      ...row,
      title: `Decision #${row.id ?? 0}`,
      reasoning: "",
      options_considered: "[]",
      outcome: null,
    }),
  },
  hr_events: {
    action: "anonymize",
    redact: (row) => ({ ...row, details: "{}" }),
  },
  hr_reviews: {
    action: "anonymize",
    redact: (row) => ({ ...row, summary: "" }),
  },
  hr_improvement_plans: {
    action: "anonymize",
    redact: (row) => ({ ...row, goals: "[]" }),
  },
  schedules: {
    action: "anonymize",
    redact: (row) => ({ ...row, directive: "Scheduled task" }),
  },

  // Excluded tables
  task_comments: { action: "exclude" },
  wiki_article_versions: { action: "exclude" },
  project_archives: { action: "exclude" },
  cost_entries: { action: "exclude" },
  sessions: { action: "exclude" },
  session_data: { action: "exclude" },
  background_jobs: { action: "exclude" },
  background_logs: { action: "exclude" },
  ceo_journal: { action: "exclude" },
  agent_status: { action: "exclude" },
  escalation_events: { action: "exclude" },
  slack_state: { action: "exclude" },
  slack_channels: { action: "exclude" },
  slack_chat_sessions: { action: "exclude" },
  mcp_integrations: { action: "exclude" },
  safeguard_pending: { action: "exclude" },
  external_actions: { action: "exclude" },
  schedule_executions: { action: "exclude" },
  scheduler_state: { action: "exclude" },
  projects: { action: "exclude" },
  project_phases: { action: "exclude" },
};

// --- Secret stripping ---

const SECRET_PATTERNS = [
  /token/i, /secret/i, /api_key/i, /apikey/i,
  /password/i, /credential/i,
  /auth_token/i, /auth_secret/i, /oauth_token/i, /oauth_secret/i,
];

function isSecretKey(key: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(key));
}

export function stripConfigSecrets(
  configRaw: Record<string, unknown>
): Record<string, unknown> {
  return deepStripSecrets(structuredClone(configRaw)) as Record<string, unknown>;
}

function deepStripSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => deepStripSecrets(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSecretKey(key) && typeof value === "string" && value.length > 0) {
      result[key] = "{{REDACTED}}";
    } else if (typeof value === "object" && value !== null) {
      result[key] = deepStripSecrets(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// --- Helpers ---

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function dirSize(dirPath: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(entryPath);
    } else {
      total += fs.statSync(entryPath).size;
    }
  }
  return total;
}

function countFiles(dirPath: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(entryPath);
    } else {
      count++;
    }
  }
  return count;
}

const VALID_TABLE_NAME = /^[a-z0-9_]+$/;

function getTablesForCategories(categories: ExportCategory[]): string[] {
  const tables = new Set<string>();
  for (const cat of categories) {
    for (const t of CATEGORY_TABLES[cat]) {
      tables.add(t);
    }
  }
  return [...tables];
}

// --- Export ---

export function exportCompanyData(options: ExportOptions): ExportResult {
  const { projectDir, mode, compress, includeSecrets } = options;

  const configPath = path.join(projectDir, "aicib.config.yaml");
  const agentsDir = path.join(projectDir, ".claude", "agents");
  const presetsDir = path.join(projectDir, ".aicib", "presets");
  const dbPath = path.join(projectDir, ".aicib", "state.db");

  // Determine company name from config (if exists)
  let companyName = "unknown";
  let configRaw: Record<string, unknown> | null = null;
  if (fs.existsSync(configPath)) {
    const rawYaml = fs.readFileSync(configPath, "utf-8");
    configRaw = yaml.load(rawYaml) as Record<string, unknown>;
    const company = configRaw?.company as Record<string, string> | undefined;
    companyName = company?.name || "unknown";
  }

  const slug = slugify(companyName);
  const ts = getTimestamp();
  const exportDirName = `aicib-export-${slug}-${ts}`;

  // Determine output paths
  const outputBase = options.outputPath
    ? options.outputPath.replace(/\.tar\.gz$/, "")
    : path.join(projectDir, exportDirName);

  const exportDir = compress ? path.join(path.dirname(outputBase), exportDirName) : outputBase;

  // Create export directory structure
  fs.mkdirSync(path.join(exportDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(exportDir, "agents"), { recursive: true });

  try {
  // Determine categories
  const categories: ExportCategory[] = options.categories && options.categories.length > 0
    ? options.categories
    : ALL_CATEGORIES;

  // 1. Export config.yaml
  // Non-selective modes always include config regardless of category selection
  if (configRaw && (categories.includes("configs") || mode !== "selective")) {
    const configToWrite = includeSecrets
      ? configRaw
      : stripConfigSecrets(configRaw);

    if (mode === "anonymized") {
      // Replace company name with placeholder
      let configStr = yaml.dump(configToWrite, { lineWidth: -1 });
      if (companyName && companyName !== "unknown") {
        configStr = configStr.replace(
          new RegExp(escapeRegex(companyName), "g"),
          "{{company_name}}"
        );
      }
      fs.writeFileSync(path.join(exportDir, "config.yaml"), configStr, "utf-8");
    } else {
      fs.writeFileSync(
        path.join(exportDir, "config.yaml"),
        yaml.dump(configToWrite, { lineWidth: -1 }),
        "utf-8"
      );
    }
  }

  // 2. Export agent .md files
  let agentCount = 0;
  if (fs.existsSync(agentsDir) && (categories.includes("agents") || mode !== "selective")) {
    const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    for (const file of agentFiles) {
      let content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
      if (mode === "anonymized" && companyName && companyName !== "unknown") {
        content = content.replace(
          new RegExp(escapeRegex(companyName), "g"),
          "{{company_name}}"
        );
      }
      fs.writeFileSync(path.join(exportDir, "agents", file), content, "utf-8");
      agentCount++;
    }
  }

  // 3. Export presets
  if (fs.existsSync(presetsDir)) {
    const presetFiles = fs.readdirSync(presetsDir).filter((f) => f.endsWith(".md"));
    if (presetFiles.length > 0) {
      const outputPresetsDir = path.join(exportDir, "presets");
      fs.mkdirSync(outputPresetsDir, { recursive: true });
      for (const file of presetFiles) {
        fs.copyFileSync(
          path.join(presetsDir, file),
          path.join(outputPresetsDir, file)
        );
      }
    }
  }

  // 4. Export database tables
  const tablesToExport = getTablesForCategories(categories);
  const tableRowCounts: Record<string, number> = {};
  const exportedTables: string[] = [];

  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });

    try {
    // Get list of tables that actually exist in the DB
    const existingTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const existingTableNames = new Set(existingTables.map((t) => t.name));

    for (const tableName of tablesToExport) {
      if (!existingTableNames.has(tableName)) continue;
      if (!VALID_TABLE_NAME.test(tableName)) continue;

      // In anonymized mode, check anonymization rules
      if (mode === "anonymized") {
        const rule = ANONYMIZE_RULES[tableName];
        if (rule?.action === "exclude") continue;
      }

      const rows = db
        .prepare(`SELECT * FROM "${tableName}"`)
        .all() as Record<string, unknown>[];

      let outputRows = rows;
      if (mode === "anonymized") {
        outputRows = anonymizeTableRows(tableName, rows);
      }

      fs.writeFileSync(
        path.join(exportDir, "data", `${tableName}.json`),
        JSON.stringify(outputRows, null, 2),
        "utf-8"
      );
      tableRowCounts[tableName] = outputRows.length;
      exportedTables.push(tableName);
    }
    } finally {
      db.close();
    }
  }

  // 5. Write manifest
  const manifest: ExportManifest = {
    version: "1.0.0",
    aicib_version: AICIB_VERSION,
    export_mode: mode,
    company_name: mode === "anonymized" ? "{{company_name}}" : companyName,
    timestamp: new Date().toISOString(),
    categories,
    tables: exportedTables,
    agent_count: agentCount,
    table_row_counts: tableRowCounts,
  };

  fs.writeFileSync(
    path.join(exportDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  // 6. Compress if requested
  let finalPath = exportDir;
  if (compress) {
    const archiveName = options.outputPath
      ? (options.outputPath.endsWith(".tar.gz") ? path.basename(options.outputPath) : `${path.basename(outputBase)}.tar.gz`)
      : `${exportDirName}.tar.gz`;
    const archivePath = path.join(path.dirname(exportDir), archiveName);
    const parentDir = path.dirname(exportDir);
    const dirName = path.basename(exportDir);

    execFileSync("tar", ["-czf", archivePath, "-C", parentDir, dirName]);

    // Clean up uncompressed directory
    fs.rmSync(exportDir, { recursive: true, force: true });
    finalPath = archivePath;
  }

  const fileCount = compress ? 1 : countFiles(finalPath);
  const totalSize = compress
    ? fs.statSync(finalPath).size
    : dirSize(finalPath);

  return {
    outputPath: finalPath,
    manifest,
    fileCount,
    totalSize,
  };
  } catch (err) {
    // Clean up partial export directory on failure
    if (fs.existsSync(exportDir)) {
      fs.rmSync(exportDir, { recursive: true, force: true });
    }
    throw err;
  }
}

// --- Import ---

export function importCompanyData(options: ImportOptions): ImportResult {
  const { sourcePath, projectDir, merge, overwriteAgents, force, companyName } = options;

  // Validate project directory exists
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Target project directory does not exist: ${projectDir}`);
  }

  // Determine import source directory
  let importDir = sourcePath;
  let tempDir: string | null = null;

  try {
    if (sourcePath.endsWith(".tar.gz") || sourcePath.endsWith(".tgz")) {
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source archive not found: ${sourcePath}`);
      }
      tempDir = path.join(projectDir, `.aicib-import-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      execFileSync("tar", ["-xzf", sourcePath, "-C", tempDir]);

      // Find the extracted directory
      const entries = fs.readdirSync(tempDir);
      if (entries.length === 1 && fs.statSync(path.join(tempDir, entries[0])).isDirectory()) {
        importDir = path.join(tempDir, entries[0]);
      } else {
        importDir = tempDir;
      }
    }

    // Validate manifest
    const errors = validateExportPackage(importDir);
    if (errors.length > 0) {
      throw new Error(`Invalid export package:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }

    const manifestRaw = fs.readFileSync(path.join(importDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw) as ExportManifest;

    // Determine which categories to import
    const categories = options.categories && options.categories.length > 0
      ? options.categories
      : manifest.categories;

    const result: ImportResult = {
      tablesImported: 0,
      rowsImported: 0,
      agentsRestored: 0,
      configRestored: false,
      conflictsSkipped: 0,
    };

    // 1. Restore config.yaml
    const configSource = path.join(importDir, "config.yaml");
    const configDest = path.join(projectDir, "aicib.config.yaml");

    if (fs.existsSync(configSource) && (categories.includes("configs") || !options.categories)) {
      if (fs.existsSync(configDest) && !force && !merge) {
        throw new Error(
          `Config already exists at ${configDest}. Use --force to overwrite or --merge to keep existing.`
        );
      }

      if (!merge || !fs.existsSync(configDest)) {
        let configContent = fs.readFileSync(configSource, "utf-8");

        // Replace placeholder with company name if provided
        if (manifest.export_mode === "anonymized" && companyName) {
          configContent = configContent.replace(
            /\{\{company_name\}\}/g,
            companyName
          );
        }

        fs.writeFileSync(configDest, configContent, "utf-8");
        result.configRestored = true;
      }
    }

    // 2. Restore agent .md files
    const agentsSource = path.join(importDir, "agents");
    const agentsDest = path.join(projectDir, ".claude", "agents");

    if (fs.existsSync(agentsSource) && (categories.includes("agents") || !options.categories)) {
      fs.mkdirSync(agentsDest, { recursive: true });
      const agentFiles = fs.readdirSync(agentsSource).filter((f) => f.endsWith(".md"));

      for (const file of agentFiles) {
        const destFile = path.join(agentsDest, file);
        if (fs.existsSync(destFile) && !overwriteAgents) {
          result.conflictsSkipped++;
          continue;
        }

        let content = fs.readFileSync(path.join(agentsSource, file), "utf-8");
        if (manifest.export_mode === "anonymized" && companyName) {
          content = content.replace(/\{\{company_name\}\}/g, companyName);
        }

        fs.writeFileSync(destFile, content, "utf-8");
        result.agentsRestored++;
      }
    }

    // 3. Restore presets
    const presetsSource = path.join(importDir, "presets");
    const presetsDest = path.join(projectDir, ".aicib", "presets");

    if (fs.existsSync(presetsSource)) {
      fs.mkdirSync(presetsDest, { recursive: true });
      const presetFiles = fs.readdirSync(presetsSource).filter((f) => f.endsWith(".md"));
      for (const file of presetFiles) {
        const destFile = path.join(presetsDest, file);
        if (!fs.existsSync(destFile) || overwriteAgents) {
          fs.copyFileSync(path.join(presetsSource, file), destFile);
        }
      }
    }

    // 4. Restore database tables
    const dataDir = path.join(importDir, "data");
    if (fs.existsSync(dataDir)) {
      const tablesToImport = getTablesForCategories(categories);
      const dataFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));

      if (dataFiles.length > 0) {
        // Bootstrap DB schema: CostTracker.init() creates all core tables
        // plus every table registered via registerTable() from *-register.ts files.
        // Without this, importing into a fresh DB silently skips all tables.
        const bootstrapTracker = new CostTracker(projectDir);
        bootstrapTracker.close();

        const dbDir = path.join(projectDir, ".aicib");
        fs.mkdirSync(dbDir, { recursive: true });
        const dbPath = path.join(dbDir, "state.db");
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("busy_timeout = 5000");

        try {
        // Get existing tables
        const existingTables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>;
        const existingTableNames = new Set(existingTables.map((t) => t.name));

        const importTransaction = db.transaction(() => {
          for (const file of dataFiles) {
            const tableName = file.replace(/\.json$/, "");

            // Only import tables that are in the selected categories
            if (!tablesToImport.includes(tableName)) continue;

            // Only import into tables that exist in the DB
            if (!existingTableNames.has(tableName)) continue;

            if (!VALID_TABLE_NAME.test(tableName)) continue;

            const rowsRaw = fs.readFileSync(path.join(dataDir, file), "utf-8");
            const rows = JSON.parse(rowsRaw) as Record<string, unknown>[];

            if (rows.length === 0) continue;

            // Clear table for full import, skip for merge
            if (!merge) {
              db.prepare(`DELETE FROM "${tableName}"`).run();
            }

            // Get column info for the table
            const columns = db
              .prepare(`PRAGMA table_info("${tableName}")`)
              .all() as Array<{ name: string }>;
            const columnNames = columns.map((c) => c.name);

            // Insert rows with cached prepared statement per table
            const verb = merge ? "INSERT OR IGNORE" : "INSERT OR REPLACE";
            let cachedStmt: Database.Statement | null = null;
            let cachedColKey = "";

            for (const row of rows) {
              const cols = columnNames.filter((c) => c in row);
              if (cols.length === 0) continue;

              const colKey = cols.join(",");
              if (colKey !== cachedColKey) {
                const placeholders = cols.map(() => "?").join(", ");
                const sql = `${verb} INTO "${tableName}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
                cachedStmt = db.prepare(sql);
                cachedColKey = colKey;
              }

              const values = cols.map((c) => {
                const val = row[c];
                if (val === null || val === undefined) return null;
                if (typeof val === "object") return JSON.stringify(val);
                return val;
              });

              try {
                const info = cachedStmt!.run(values);
                if (info.changes > 0) {
                  result.rowsImported++;
                } else {
                  result.conflictsSkipped++;
                }
              } catch {
                result.conflictsSkipped++;
              }
            }

            result.tablesImported++;
          }
        });

        importTransaction();
        } finally {
          db.close();
        }
      }
    }

    return result;
  } finally {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// --- Validation ---

export function validateExportPackage(dirPath: string): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(dirPath)) {
    errors.push(`Directory does not exist: ${dirPath}`);
    return errors;
  }

  const manifestPath = path.join(dirPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push("Missing manifest.json");
    return errors;
  }

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    if (!manifest.version) {
      errors.push("manifest.json missing 'version' field");
    } else if (manifest.version !== "1.0.0") {
      errors.push(
        `Unsupported manifest version: ${manifest.version}. This tool supports version 1.0.0.`
      );
    }

    if (!manifest.export_mode) {
      errors.push("manifest.json missing 'export_mode' field");
    }

    if (!manifest.timestamp) {
      errors.push("manifest.json missing 'timestamp' field");
    }
  } catch (e) {
    errors.push(
      `manifest.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return errors;
}

// --- Anonymization ---

export function anonymizeTableRows(
  tableName: string,
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const rule = ANONYMIZE_RULES[tableName];

  // Default: include as-is if no rule
  if (!rule) return rows;
  if (rule.action === "exclude") return [];
  if (rule.action === "include") return rows;

  // Anonymize
  if (rule.redact) {
    return rows.map((row, i) => rule.redact!(row, i));
  }

  return rows;
}
