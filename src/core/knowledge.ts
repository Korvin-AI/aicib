import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ── Type Definitions ────────────────────────────────────────────────

export type WikiSection =
  | "overview"
  | "products"
  | "policies"
  | "brand"
  | "customers"
  | "competitors"
  | "general";

export type JournalEntryType =
  | "task_outcome"
  | "lesson"
  | "pattern"
  | "mistake"
  | "reflection";

export type DecisionStatus = "active" | "superseded" | "reversed";

export type ArchiveStatus = "completed" | "cancelled" | "on_hold";

export const VALID_WIKI_SECTIONS: WikiSection[] = [
  "overview",
  "products",
  "policies",
  "brand",
  "customers",
  "competitors",
  "general",
];

export const VALID_JOURNAL_ENTRY_TYPES: JournalEntryType[] = [
  "task_outcome",
  "lesson",
  "pattern",
  "mistake",
  "reflection",
];

export const VALID_DECISION_STATUSES: DecisionStatus[] = [
  "active",
  "superseded",
  "reversed",
];

export const VALID_ARCHIVE_STATUSES: ArchiveStatus[] = [
  "completed",
  "cancelled",
  "on_hold",
];

// ── Interfaces ──────────────────────────────────────────────────────

export interface WikiArticle {
  id: number;
  slug: string;
  title: string;
  section: WikiSection;
  content: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface WikiArticleVersion {
  id: number;
  article_id: number;
  version: number;
  title: string;
  content: string;
  edited_by: string;
  created_at: string;
}

export interface AgentJournalEntry {
  id: number;
  agent_role: string;
  session_id: string | null;
  entry_type: JournalEntryType;
  title: string;
  content: string;
  tags: string; // JSON array
  created_at: string;
}

export interface DecisionLogEntry {
  id: number;
  title: string;
  decided_by: string;
  department: string | null;
  options_considered: string; // JSON array
  reasoning: string;
  outcome: string | null;
  status: DecisionStatus;
  session_id: string | null;
  related_task_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectArchive {
  id: number;
  project_name: string;
  description: string;
  status: ArchiveStatus;
  deliverables: string; // JSON array
  lessons_learned: string | null;
  total_cost_usd: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_by: string;
  session_id: string | null;
}

export interface SearchResult {
  type: "wiki" | "journal" | "decision" | "archive";
  id: number;
  title: string;
  snippet: string;
  created_at: string;
}

// ── Input Types ─────────────────────────────────────────────────────

export interface CreateArticleInput {
  slug: string;
  title: string;
  section?: WikiSection;
  content: string;
  created_by?: string;
}

export interface UpdateArticleInput {
  title?: string;
  section?: WikiSection;
  content?: string;
  updated_by?: string;
}

export interface CreateJournalInput {
  agent_role: string;
  session_id?: string;
  entry_type: JournalEntryType;
  title: string;
  content: string;
  tags?: string[];
}

export interface CreateDecisionInput {
  title: string;
  decided_by: string;
  department?: string;
  options_considered?: string[];
  reasoning: string;
  outcome?: string;
  session_id?: string;
  related_task_id?: number;
}

export interface CreateArchiveInput {
  project_name: string;
  description: string;
  status?: ArchiveStatus;
  deliverables?: string[];
  lessons_learned?: string;
  total_cost_usd?: number;
  started_at?: string;
  completed_at?: string;
  created_by?: string;
  session_id?: string;
}

export interface DecisionFilter {
  decided_by?: string;
  department?: string;
  status?: DecisionStatus;
}

export interface SearchOptions {
  types?: Array<"wiki" | "journal" | "decision" | "archive">;
  limit?: number;
}

// ── Config ──────────────────────────────────────────────────────────

export interface KnowledgeConfig {
  enabled: boolean;
  max_wiki_context_chars: number;
  max_journal_entries: number;
  max_decision_entries: number;
  max_search_results: number;
  wiki_edit_roles: string[];
}

export const KNOWLEDGE_CONFIG_DEFAULTS: KnowledgeConfig = {
  enabled: true,
  max_wiki_context_chars: 3000,
  max_journal_entries: 10,
  max_decision_entries: 10,
  max_search_results: 20,
  wiki_edit_roles: ["ceo", "cto", "cfo", "cmo"],
};

// ── KnowledgeManager Class ──────────────────────────────────────────

export class KnowledgeManager {
  private db: Database.Database;

  constructor(projectDir: string) {
    const dataDir = path.join(projectDir, ".aicib");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(path.join(dataDir, "state.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS wiki_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'general'
        CHECK(section IN ('overview','products','policies','brand','customers','competitors','general')),
      content TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT 'ceo',
      updated_by TEXT NOT NULL DEFAULT 'ceo',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS wiki_article_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(article_id, version),
      FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS agent_journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_role TEXT NOT NULL,
      session_id TEXT,
      entry_type TEXT NOT NULL DEFAULT 'lesson'
        CHECK(entry_type IN ('task_outcome','lesson','pattern','mistake','reflection')),
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      department TEXT,
      options_considered TEXT NOT NULL DEFAULT '[]',
      reasoning TEXT NOT NULL DEFAULT '',
      outcome TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','superseded','reversed')),
      session_id TEXT,
      related_task_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();

    this.db.prepare(`CREATE TABLE IF NOT EXISTS project_archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed'
        CHECK(status IN ('completed','cancelled','on_hold')),
      deliverables TEXT NOT NULL DEFAULT '[]',
      lessons_learned TEXT,
      total_cost_usd REAL,
      started_at TEXT,
      completed_at TEXT,
      created_by TEXT NOT NULL DEFAULT 'ceo',
      session_id TEXT
    )`).run();

    // Indexes
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_wiki_section ON wiki_articles(section)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_wiki_slug ON wiki_articles(slug)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_wiki_updated ON wiki_articles(updated_at)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_wiki_versions_article ON wiki_article_versions(article_id)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_role ON agent_journals(agent_role)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_type ON agent_journals(entry_type)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_agent_journal_created ON agent_journals(created_at)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_agent_journal_session ON agent_journals(session_id)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_decision_by ON decision_log(decided_by)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_decision_dept ON decision_log(department)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_decision_status ON decision_log(status)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_decision_created ON decision_log(created_at)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_archive_name ON project_archives(project_name)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_archive_status ON project_archives(status)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_archive_completed ON project_archives(completed_at)").run();
  }

  // ── Wiki Methods ──────────────────────────────────────────────────

  createArticle(input: CreateArticleInput): WikiArticle {
    const result = this.db
      .prepare(
        `INSERT INTO wiki_articles (slug, title, section, content, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.slug,
        input.title,
        input.section || "general",
        input.content,
        input.created_by || "ceo",
        input.created_by || "ceo"
      );

    const article = this.getArticleById(Number(result.lastInsertRowid));
    if (!article) {
      throw new Error("Failed to create wiki article");
    }
    return article;
  }

  getArticle(slug: string): WikiArticle | null {
    return (
      (this.db
        .prepare("SELECT * FROM wiki_articles WHERE slug = ?")
        .get(slug) as WikiArticle | undefined) ?? null
    );
  }

  getArticleById(id: number): WikiArticle | null {
    return (
      (this.db
        .prepare("SELECT * FROM wiki_articles WHERE id = ?")
        .get(id) as WikiArticle | undefined) ?? null
    );
  }

  updateArticle(slug: string, fields: UpdateArticleInput): WikiArticle | null {
    const existing = this.getArticle(slug);
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.title !== undefined) {
      sets.push("title = ?");
      values.push(fields.title);
    }
    if (fields.section !== undefined) {
      sets.push("section = ?");
      values.push(fields.section);
    }
    if (fields.content !== undefined) {
      sets.push("content = ?");
      values.push(fields.content);
    }

    sets.push("updated_by = ?");
    values.push(fields.updated_by || "ceo");
    sets.push("version = version + 1");
    sets.push("updated_at = datetime('now')");

    values.push(slug);

    // Snapshot + update must be atomic to avoid orphan version rows on crash
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO wiki_article_versions (article_id, version, title, content, edited_by)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          existing.id,
          existing.version,
          existing.title,
          existing.content,
          existing.updated_by
        );

      this.db
        .prepare(`UPDATE wiki_articles SET ${sets.join(", ")} WHERE slug = ?`)
        .run(...values);
    })();

    return this.getArticle(slug);
  }

  deleteArticle(slug: string): boolean {
    const result = this.db
      .prepare("DELETE FROM wiki_articles WHERE slug = ?")
      .run(slug);
    return result.changes > 0;
  }

  listArticles(section?: WikiSection): WikiArticle[] {
    if (section) {
      return this.db
        .prepare(
          "SELECT * FROM wiki_articles WHERE section = ? ORDER BY updated_at DESC"
        )
        .all(section) as WikiArticle[];
    }
    return this.db
      .prepare("SELECT * FROM wiki_articles ORDER BY section, updated_at DESC")
      .all() as WikiArticle[];
  }

  getArticleHistory(slug: string): WikiArticleVersion[] {
    const article = this.getArticle(slug);
    if (!article) return [];

    return this.db
      .prepare(
        "SELECT * FROM wiki_article_versions WHERE article_id = ? ORDER BY version DESC"
      )
      .all(article.id) as WikiArticleVersion[];
  }

  canEdit(agentRole: string, config: KnowledgeConfig): boolean {
    return config.wiki_edit_roles.includes(agentRole.toLowerCase());
  }

  // ── Journal Methods ───────────────────────────────────────────────

  createJournalEntry(input: CreateJournalInput): AgentJournalEntry {
    const result = this.db
      .prepare(
        `INSERT INTO agent_journals (agent_role, session_id, entry_type, title, content, tags)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.agent_role,
        input.session_id ?? null,
        input.entry_type,
        input.title,
        input.content,
        JSON.stringify(input.tags || [])
      );

    return this.db
      .prepare("SELECT * FROM agent_journals WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as AgentJournalEntry;
  }

  getJournalEntries(agentRole: string, limit?: number): AgentJournalEntry[] {
    const limitClause = limit != null && limit > 0 ? "LIMIT ?" : "";
    const params: unknown[] = [agentRole];
    if (limit != null && limit > 0) params.push(limit);

    return this.db
      .prepare(
        `SELECT * FROM agent_journals WHERE agent_role = ?
         ORDER BY created_at DESC ${limitClause}`
      )
      .all(...params) as AgentJournalEntry[];
  }

  getJournalEntriesByType(
    agentRole: string,
    type: JournalEntryType
  ): AgentJournalEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM agent_journals
         WHERE agent_role = ? AND entry_type = ?
         ORDER BY created_at DESC`
      )
      .all(agentRole, type) as AgentJournalEntry[];
  }

  // ── Decision Methods ──────────────────────────────────────────────

  recordDecision(input: CreateDecisionInput): DecisionLogEntry {
    const result = this.db
      .prepare(
        `INSERT INTO decision_log (title, decided_by, department, options_considered, reasoning, outcome, session_id, related_task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.title,
        input.decided_by,
        input.department ?? null,
        JSON.stringify(input.options_considered || []),
        input.reasoning,
        input.outcome ?? null,
        input.session_id ?? null,
        input.related_task_id ?? null
      );

    const decision = this.getDecision(Number(result.lastInsertRowid));
    if (!decision) {
      throw new Error("Failed to record decision");
    }
    return decision;
  }

  getDecision(id: number): DecisionLogEntry | null {
    return (
      (this.db
        .prepare("SELECT * FROM decision_log WHERE id = ?")
        .get(id) as DecisionLogEntry | undefined) ?? null
    );
  }

  listDecisions(filter?: DecisionFilter, limit?: number): DecisionLogEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter) {
      if (filter.decided_by) {
        conditions.push("decided_by = ?");
        params.push(filter.decided_by);
      }
      if (filter.department) {
        conditions.push("department = ?");
        params.push(filter.department);
      }
      if (filter.status) {
        conditions.push("status = ?");
        params.push(filter.status);
      }
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = limit != null && limit > 0 ? "LIMIT ?" : "";
    if (limit != null && limit > 0) params.push(limit);

    return this.db
      .prepare(
        `SELECT * FROM decision_log ${where}
         ORDER BY created_at DESC ${limitClause}`
      )
      .all(...params) as DecisionLogEntry[];
  }

  updateDecisionStatus(
    id: number,
    status: DecisionStatus,
    outcome?: string
  ): DecisionLogEntry | null {
    const existing = this.getDecision(id);
    if (!existing) return null;

    const sets = ["status = ?", "updated_at = datetime('now')"];
    const values: unknown[] = [status];

    if (outcome !== undefined) {
      sets.push("outcome = ?");
      values.push(outcome);
    }

    values.push(id);
    this.db
      .prepare(`UPDATE decision_log SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.getDecision(id);
  }

  // ── Archive Methods ───────────────────────────────────────────────

  archiveProject(input: CreateArchiveInput): ProjectArchive {
    const result = this.db
      .prepare(
        `INSERT INTO project_archives (project_name, description, status, deliverables, lessons_learned, total_cost_usd, started_at, completed_at, created_by, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.project_name,
        input.description,
        input.status || "completed",
        JSON.stringify(input.deliverables || []),
        input.lessons_learned ?? null,
        input.total_cost_usd ?? null,
        input.started_at ?? null,
        input.completed_at ?? null,
        input.created_by || "ceo",
        input.session_id ?? null
      );

    const archive = this.getArchive(Number(result.lastInsertRowid));
    if (!archive) {
      throw new Error("Failed to archive project");
    }
    return archive;
  }

  getArchive(id: number): ProjectArchive | null {
    return (
      (this.db
        .prepare("SELECT * FROM project_archives WHERE id = ?")
        .get(id) as ProjectArchive | undefined) ?? null
    );
  }

  listArchives(status?: ArchiveStatus): ProjectArchive[] {
    if (status) {
      return this.db
        .prepare(
          "SELECT * FROM project_archives WHERE status = ? ORDER BY completed_at DESC, id DESC"
        )
        .all(status) as ProjectArchive[];
    }
    return this.db
      .prepare(
        "SELECT * FROM project_archives ORDER BY completed_at DESC, id DESC"
      )
      .all() as ProjectArchive[];
  }

  // ── Search ────────────────────────────────────────────────────────

  search(keyword: string, options?: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];
    const limit = options?.limit ?? 20;
    const types = options?.types ?? ["wiki", "journal", "decision", "archive"];
    const pattern = `%${keyword}%`;

    if (types.includes("wiki")) {
      const wikiRows = this.db
        .prepare(
          `SELECT id, title, content, created_at FROM wiki_articles
           WHERE title LIKE ? OR content LIKE ? OR slug LIKE ?
           ORDER BY updated_at DESC LIMIT ?`
        )
        .all(pattern, pattern, pattern, limit) as Array<{
        id: number;
        title: string;
        content: string;
        created_at: string;
      }>;

      for (const row of wikiRows) {
        results.push({
          type: "wiki",
          id: row.id,
          title: row.title,
          snippet: row.content.slice(0, 150),
          created_at: row.created_at,
        });
      }
    }

    if (types.includes("journal")) {
      const journalRows = this.db
        .prepare(
          `SELECT id, title, content, created_at FROM agent_journals
           WHERE title LIKE ? OR content LIKE ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(pattern, pattern, limit) as Array<{
        id: number;
        title: string;
        content: string;
        created_at: string;
      }>;

      for (const row of journalRows) {
        results.push({
          type: "journal",
          id: row.id,
          title: row.title,
          snippet: row.content.slice(0, 150),
          created_at: row.created_at,
        });
      }
    }

    if (types.includes("decision")) {
      const decisionRows = this.db
        .prepare(
          `SELECT id, title, reasoning, created_at FROM decision_log
           WHERE title LIKE ? OR reasoning LIKE ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(pattern, pattern, limit) as Array<{
        id: number;
        title: string;
        reasoning: string;
        created_at: string;
      }>;

      for (const row of decisionRows) {
        results.push({
          type: "decision",
          id: row.id,
          title: row.title,
          snippet: row.reasoning.slice(0, 150),
          created_at: row.created_at,
        });
      }
    }

    if (types.includes("archive")) {
      const archiveRows = this.db
        .prepare(
          `SELECT id, project_name, description, completed_at, started_at FROM project_archives
           WHERE project_name LIKE ? OR description LIKE ? OR lessons_learned LIKE ?
           ORDER BY completed_at DESC, id DESC LIMIT ?`
        )
        .all(pattern, pattern, pattern, limit) as Array<{
        id: number;
        project_name: string;
        description: string;
        completed_at: string;
        started_at: string;
      }>;

      for (const row of archiveRows) {
        results.push({
          type: "archive",
          id: row.id,
          title: row.project_name,
          snippet: row.description.slice(0, 150),
          created_at: row.completed_at || row.started_at || "",
        });
      }
    }

    // Sort by created_at descending, then limit
    results.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    );

    return results.slice(0, limit);
  }

  // ── Context Formatters ────────────────────────────────────────────

  formatWikiForContext(maxChars: number = 3000): string {
    const articles = this.listArticles();
    if (articles.length === 0) return "";

    const lines: string[] = ["## Company Wiki"];

    // Group by section
    const bySection = new Map<string, WikiArticle[]>();
    for (const article of articles) {
      if (!bySection.has(article.section)) {
        bySection.set(article.section, []);
      }
      bySection.get(article.section)!.push(article);
    }

    let charCount = lines[0].length;

    // Include overview content if space allows
    const overviewArticles = bySection.get("overview") || [];
    if (overviewArticles.length > 0) {
      lines.push("");
      lines.push("### Overview");
      for (const article of overviewArticles) {
        const contentPreview =
          article.content.length > 500
            ? article.content.slice(0, 500) + "..."
            : article.content;
        const line = `- **${article.title}**: ${contentPreview}`;
        charCount += line.length + 1;
        if (charCount > maxChars) break;
        lines.push(line);
      }
    }

    // Other sections: just titles
    for (const [section, sectionArticles] of bySection) {
      if (section === "overview") continue;
      const sectionHeader = `\n### ${section.charAt(0).toUpperCase() + section.slice(1)}`;
      charCount += sectionHeader.length;
      if (charCount > maxChars) break;
      lines.push(sectionHeader);

      for (const article of sectionArticles) {
        const line = `- ${article.title} (v${article.version})`;
        charCount += line.length + 1;
        if (charCount > maxChars) break;
        lines.push(line);
      }
      if (charCount > maxChars) break;
    }

    return lines.join("\n");
  }

  formatJournalForContext(agentRole: string, limit: number = 10): string {
    const entries = this.getJournalEntries(agentRole, limit);
    if (entries.length === 0) return "";

    const lines: string[] = [`## ${agentRole.toUpperCase()} Learning Journal`];

    for (const entry of entries) {
      lines.push(
        `- [${entry.entry_type}] ${entry.title}: ${entry.content.slice(0, 200)}`
      );
    }

    return lines.join("\n");
  }

  formatDecisionLogForContext(limit: number = 10): string {
    const decisions = this.listDecisions({ status: "active" }, limit);
    if (decisions.length === 0) return "";

    const lines: string[] = ["## Active Decisions"];

    for (const decision of decisions) {
      const outcomeStr = decision.outcome ? ` → ${decision.outcome}` : "";
      lines.push(
        `- ${decision.title} (by ${decision.decided_by})${outcomeStr}`
      );
    }

    return lines.join("\n");
  }

  formatArchivesForContext(limit: number = 5): string {
    const archives = this.listArchives();
    if (archives.length === 0) return "";

    const lines: string[] = ["## Project Archives"];

    for (const archive of archives.slice(0, limit)) {
      const statusStr =
        archive.status !== "completed" ? ` [${archive.status}]` : "";
      lines.push(`- ${archive.project_name}${statusStr}: ${archive.description.slice(0, 100)}`);
    }

    return lines.join("\n");
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
