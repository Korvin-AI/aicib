/**
 * Hook registration for the Knowledge Management system.
 *
 * Importing this module (side-effect import) registers:
 * - Config extension: `knowledge:` section in aicib.config.yaml
 * - Database tables: wiki_articles, wiki_article_versions, agent_journals,
 *   decision_log, project_archives
 * - Context provider: company-knowledge (injects wiki + decisions + archives)
 * - Message handler: knowledge-actions (detects KNOWLEDGE:: markers in agent output)
 *
 * Must be imported BEFORE loadConfig() and CostTracker construction.
 */

import { registerConfigExtension } from "./config.js";
import { registerTable } from "./cost-tracker.js";
import {
  registerContextProvider,
  registerMessageHandler,
} from "./agent-runner.js";
import {
  KnowledgeManager,
  KNOWLEDGE_CONFIG_DEFAULTS,
  VALID_WIKI_SECTIONS,
  VALID_JOURNAL_ENTRY_TYPES,
  VALID_DECISION_STATUSES,
  VALID_ARCHIVE_STATUSES,
  type KnowledgeConfig,
  type WikiSection,
  type JournalEntryType,
  type DecisionStatus,
  type ArchiveStatus,
} from "./knowledge.js";

// ============================================
// CONFIG EXTENSION
// ============================================

registerConfigExtension({
  key: "knowledge",
  defaults: { ...KNOWLEDGE_CONFIG_DEFAULTS },
  validate: (raw: unknown) => {
    const errors: string[] = [];
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;

      if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
        errors.push("knowledge.enabled must be a boolean");
      }

      if (obj.max_wiki_context_chars !== undefined) {
        if (
          typeof obj.max_wiki_context_chars !== "number" ||
          obj.max_wiki_context_chars < 0
        ) {
          errors.push(
            "knowledge.max_wiki_context_chars must be a non-negative number"
          );
        }
      }

      if (obj.max_journal_entries !== undefined) {
        if (
          typeof obj.max_journal_entries !== "number" ||
          obj.max_journal_entries < 0
        ) {
          errors.push(
            "knowledge.max_journal_entries must be a non-negative number"
          );
        }
      }

      if (obj.max_decision_entries !== undefined) {
        if (
          typeof obj.max_decision_entries !== "number" ||
          obj.max_decision_entries < 0
        ) {
          errors.push(
            "knowledge.max_decision_entries must be a non-negative number"
          );
        }
      }

      if (obj.max_search_results !== undefined) {
        if (
          typeof obj.max_search_results !== "number" ||
          obj.max_search_results < 0
        ) {
          errors.push(
            "knowledge.max_search_results must be a non-negative number"
          );
        }
      }

      if (obj.wiki_edit_roles !== undefined) {
        if (!Array.isArray(obj.wiki_edit_roles)) {
          errors.push("knowledge.wiki_edit_roles must be an array of strings");
        } else {
          for (const role of obj.wiki_edit_roles) {
            if (typeof role !== "string") {
              errors.push(
                "knowledge.wiki_edit_roles must contain only strings"
              );
              break;
            }
          }
        }
      }
    }
    return errors;
  },
});

// ============================================
// DATABASE TABLES
// ============================================

registerTable({
  name: "wiki_articles",
  createSQL: `CREATE TABLE IF NOT EXISTS wiki_articles (
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
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_wiki_section ON wiki_articles(section)",
    "CREATE INDEX IF NOT EXISTS idx_wiki_slug ON wiki_articles(slug)",
    "CREATE INDEX IF NOT EXISTS idx_wiki_updated ON wiki_articles(updated_at)",
  ],
});

registerTable({
  name: "wiki_article_versions",
  createSQL: `CREATE TABLE IF NOT EXISTS wiki_article_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    edited_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(article_id, version),
    FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_wiki_versions_article ON wiki_article_versions(article_id)",
  ],
});

registerTable({
  name: "agent_journals",
  createSQL: `CREATE TABLE IF NOT EXISTS agent_journals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_role TEXT NOT NULL,
    session_id TEXT,
    entry_type TEXT NOT NULL DEFAULT 'lesson'
      CHECK(entry_type IN ('task_outcome','lesson','pattern','mistake','reflection')),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_journal_role ON agent_journals(agent_role)",
    "CREATE INDEX IF NOT EXISTS idx_journal_type ON agent_journals(entry_type)",
    "CREATE INDEX IF NOT EXISTS idx_agent_journal_created ON agent_journals(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_agent_journal_session ON agent_journals(session_id)",
  ],
});

registerTable({
  name: "decision_log",
  createSQL: `CREATE TABLE IF NOT EXISTS decision_log (
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
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_decision_by ON decision_log(decided_by)",
    "CREATE INDEX IF NOT EXISTS idx_decision_dept ON decision_log(department)",
    "CREATE INDEX IF NOT EXISTS idx_decision_status ON decision_log(status)",
    "CREATE INDEX IF NOT EXISTS idx_decision_created ON decision_log(created_at)",
  ],
});

registerTable({
  name: "project_archives",
  createSQL: `CREATE TABLE IF NOT EXISTS project_archives (
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
  )`,
  indexes: [
    "CREATE INDEX IF NOT EXISTS idx_archive_name ON project_archives(project_name)",
    "CREATE INDEX IF NOT EXISTS idx_archive_status ON project_archives(status)",
    "CREATE INDEX IF NOT EXISTS idx_archive_completed ON project_archives(completed_at)",
  ],
});

// ============================================
// CONTEXT PROVIDER
// ============================================

registerContextProvider("company-knowledge", (config, projectDir) => {
  // Set module-level projectDir so the message handler can use it.
  lastProjectDir = projectDir;

  const knowledgeConfig = config.extensions?.knowledge as
    | KnowledgeConfig
    | undefined;
  if (knowledgeConfig && !knowledgeConfig.enabled) return "";

  const maxWikiChars = knowledgeConfig?.max_wiki_context_chars ?? 3000;
  const maxDecisions = knowledgeConfig?.max_decision_entries ?? 10;

  let km: KnowledgeManager | undefined;
  try {
    km = new KnowledgeManager(projectDir);

    const parts: string[] = [];

    const wikiContext = km.formatWikiForContext(maxWikiChars);
    if (wikiContext) parts.push(wikiContext);

    const decisionsContext = km.formatDecisionLogForContext(maxDecisions);
    if (decisionsContext) parts.push(decisionsContext);

    const archivesContext = km.formatArchivesForContext(5);
    if (archivesContext) parts.push(archivesContext);

    if (parts.length === 0) return "";

    return parts.join("\n\n");
  } catch (e) {
    console.warn("Knowledge context error:", e);
    return "";
  } finally {
    km?.close();
  }
});

// ============================================
// MESSAGE HANDLER
// ============================================

// Debounced knowledge update queue to avoid per-message DB churn
interface PendingKnowledgeUpdate {
  type: "wiki_create" | "wiki_update" | "journal" | "decision" | "archive";
  data: Record<string, string>;
}

let pendingUpdates: PendingKnowledgeUpdate[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Module-level projectDir set by the context provider and read by the message handler.
// Safe: AICIB runs one session per CLI process; background workers are separate Node processes.
let lastProjectDir: string | null = null;

function queueUpdate(
  update: PendingKnowledgeUpdate,
  projectDir: string
): void {
  lastProjectDir = projectDir;
  pendingUpdates.push(update);
  if (!flushTimer) {
    flushTimer = setTimeout(() => flushPendingUpdates(), 500);
  }
}

function flushPendingUpdates(): void {
  flushTimer = null;
  if (pendingUpdates.length === 0 || !lastProjectDir) return;

  const updates = pendingUpdates;
  pendingUpdates = [];

  let km: KnowledgeManager | undefined;
  try {
    km = new KnowledgeManager(lastProjectDir);

    for (const update of updates) {
      try {
        switch (update.type) {
          case "wiki_create": {
            const { slug, section, title, content } = update.data;
            if (!slug?.trim() || !title?.trim()) break;
            const validSection = VALID_WIKI_SECTIONS.includes(
              section as WikiSection
            )
              ? (section as WikiSection)
              : "general";
            km.createArticle({
              slug,
              title,
              section: validSection,
              content: content || "",
              created_by: "ceo",
            });
            break;
          }
          case "wiki_update": {
            const { slug, content, title } = update.data;
            if (!slug?.trim()) break;
            const fields: Record<string, string> = {};
            if (content) fields.content = content;
            if (title) fields.title = title;
            if (Object.keys(fields).length > 0) {
              km.updateArticle(slug, { ...fields, updated_by: "ceo" });
            }
            break;
          }
          case "journal": {
            const { type: entryType, title, content } = update.data;
            if (!title?.trim()) break;
            const validType = VALID_JOURNAL_ENTRY_TYPES.includes(
              entryType as JournalEntryType
            )
              ? (entryType as JournalEntryType)
              : "lesson";
            km.createJournalEntry({
              agent_role: "ceo",
              entry_type: validType,
              title,
              content: content || title,
            });
            break;
          }
          case "decision": {
            const { title, options, reasoning, outcome } = update.data;
            if (!title?.trim()) break;
            km.recordDecision({
              title,
              decided_by: "ceo",
              options_considered: options
                ? options.split(",").map((o) => o.trim())
                : [],
              reasoning: reasoning || "",
              outcome: outcome || undefined,
            });
            break;
          }
          case "archive": {
            const {
              project,
              description,
              status,
              deliverables,
              lessons,
            } = update.data;
            if (!project?.trim()) break;
            const validStatus = VALID_ARCHIVE_STATUSES.includes(
              status as ArchiveStatus
            )
              ? (status as ArchiveStatus)
              : "completed";
            km.archiveProject({
              project_name: project,
              description: description || "",
              status: validStatus,
              deliverables: deliverables
                ? deliverables.split(",").map((d) => d.trim())
                : [],
              lessons_learned: lessons || undefined,
              created_by: "ceo",
            });
            break;
          }
        }
      } catch (e) {
        console.warn("Knowledge update failed:", e);
      }
    }
  } catch (e) {
    console.warn("Knowledge flush DB error:", e);
  } finally {
    km?.close();
  }
}

registerMessageHandler("knowledge-actions", (msg, config) => {
  const knowledgeConfig = config.extensions?.knowledge as
    | KnowledgeConfig
    | undefined;
  if (knowledgeConfig && !knowledgeConfig.enabled) return;

  if (msg.type !== "assistant") return;

  const content = msg.message?.content;
  if (!content) return;

  let text = "";
  for (const block of content) {
    if ("text" in block && block.text) {
      text += block.text + "\n";
    }
  }
  if (!text) return;

  if (!lastProjectDir) return;

  // Parse structured KNOWLEDGE:: markers
  const wikiCreateMatches = text.matchAll(
    /KNOWLEDGE::WIKI_CREATE\s+slug="([^"]+)"\s+section=(\S+)\s+title="([^"]+)"\s+content="([^"]+)"/g
  );
  for (const match of wikiCreateMatches) {
    queueUpdate(
      {
        type: "wiki_create",
        data: {
          slug: match[1],
          section: match[2],
          title: match[3],
          content: match[4],
        },
      },
      lastProjectDir
    );
  }

  const wikiUpdateMatches = text.matchAll(
    /KNOWLEDGE::WIKI_UPDATE\s+slug="([^"]+)"\s+content="([^"]+)"/g
  );
  for (const match of wikiUpdateMatches) {
    queueUpdate(
      {
        type: "wiki_update",
        data: { slug: match[1], content: match[2] },
      },
      lastProjectDir
    );
  }

  const journalMatches = text.matchAll(
    /KNOWLEDGE::JOURNAL\s+type=(\S+)\s+title="([^"]+)"\s+content="([^"]+)"/g
  );
  for (const match of journalMatches) {
    queueUpdate(
      {
        type: "journal",
        data: { type: match[1], title: match[2], content: match[3] },
      },
      lastProjectDir
    );
  }

  const decisionMatches = text.matchAll(
    /KNOWLEDGE::DECISION\s+title="([^"]+)"\s+options="([^"]+)"\s+reasoning="([^"]+)"\s+outcome="([^"]+)"/g
  );
  for (const match of decisionMatches) {
    queueUpdate(
      {
        type: "decision",
        data: {
          title: match[1],
          options: match[2],
          reasoning: match[3],
          outcome: match[4],
        },
      },
      lastProjectDir
    );
  }

  const archiveMatches = text.matchAll(
    /KNOWLEDGE::ARCHIVE\s+project="([^"]+)"\s+description="([^"]+)"\s+status=(\S+)\s+deliverables="([^"]*)"\s+lessons="([^"]*)"/g
  );
  for (const match of archiveMatches) {
    queueUpdate(
      {
        type: "archive",
        data: {
          project: match[1],
          description: match[2],
          status: match[3],
          deliverables: match[4],
          lessons: match[5],
        },
      },
      lastProjectDir
    );
  }

  // Natural language fallback patterns — low false-positive
  const learnedMatches = text.matchAll(
    /learned (?:that|about)\s+(.+)/gi
  );
  for (const match of learnedMatches) {
    const lesson = match[1].trim().replace(/[.!]+$/, "");
    if (lesson.length < 10) continue; // Skip very short matches
    queueUpdate(
      {
        type: "journal",
        data: { type: "lesson", title: lesson.slice(0, 100), content: lesson },
      },
      lastProjectDir
    );
  }

  const decidedMatches = text.matchAll(
    /decided (?:to|that)\s+(.+)/gi
  );
  for (const match of decidedMatches) {
    const decision = match[1].trim().replace(/[.!]+$/, "");
    if (decision.length < 10) continue;
    queueUpdate(
      {
        type: "decision",
        data: {
          title: decision.slice(0, 100),
          options: "",
          reasoning: decision,
          outcome: "",
        },
      },
      lastProjectDir
    );
  }
});
