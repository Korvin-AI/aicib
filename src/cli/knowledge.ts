import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import {
  KnowledgeManager,
  VALID_WIKI_SECTIONS,
  VALID_JOURNAL_ENTRY_TYPES,
  VALID_DECISION_STATUSES,
  VALID_ARCHIVE_STATUSES,
  type WikiSection,
  type JournalEntryType,
  type DecisionStatus,
  type ArchiveStatus,
} from "../core/knowledge.js";
import {
  header,
  createTable,
  agentColor,
  formatTimeAgo,
} from "./ui.js";

// ── Helpers ───────────────────────────────────────────────────────

function getKnowledgeManager(dir: string): KnowledgeManager {
  const projectDir = path.resolve(dir);

  try {
    loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  return new KnowledgeManager(projectDir);
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function formatSection(section: string): string {
  switch (section) {
    case "overview":
      return chalk.cyan("overview");
    case "products":
      return chalk.green("products");
    case "policies":
      return chalk.yellow("policies");
    case "brand":
      return chalk.magenta("brand");
    case "customers":
      return chalk.blue("customers");
    case "competitors":
      return chalk.red("competitors");
    default:
      return chalk.dim(section);
  }
}

function formatDecisionStatus(status: string): string {
  switch (status) {
    case "active":
      return chalk.green("active");
    case "superseded":
      return chalk.yellow("superseded");
    case "reversed":
      return chalk.red("reversed");
    default:
      return chalk.dim(status);
  }
}

function formatArchiveStatus(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green("completed");
    case "cancelled":
      return chalk.red("cancelled");
    case "on_hold":
      return chalk.yellow("on_hold");
    default:
      return chalk.dim(status);
  }
}

function formatEntryType(type: string): string {
  switch (type) {
    case "task_outcome":
      return chalk.cyan("outcome");
    case "lesson":
      return chalk.green("lesson");
    case "pattern":
      return chalk.blue("pattern");
    case "mistake":
      return chalk.red("mistake");
    case "reflection":
      return chalk.yellow("reflect");
    default:
      return chalk.dim(type);
  }
}

// ── Commands ──────────────────────────────────────────────────────

interface KnowledgeOptions {
  dir: string;
}

/**
 * Default `aicib knowledge` — shows a dashboard summary.
 */
export async function knowledgeCommand(
  options: KnowledgeOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    console.log(header("Knowledge"));

    const articles = km.listArticles();
    const decisions = km.listDecisions(undefined, 5);
    const archives = km.listArchives();

    if (
      articles.length === 0 &&
      decisions.length === 0 &&
      archives.length === 0
    ) {
      console.log(chalk.dim("  No knowledge entries yet."));
      console.log(
        chalk.dim(
          "  Agents create knowledge automatically, or use subcommands to manage manually.\n"
        )
      );
      return;
    }

    // Wiki summary
    if (articles.length > 0) {
      console.log(chalk.bold("  Wiki Articles:"));
      const bySection = new Map<string, number>();
      for (const article of articles) {
        bySection.set(
          article.section,
          (bySection.get(article.section) || 0) + 1
        );
      }
      const sectionStrs = Array.from(bySection.entries())
        .map(([s, c]) => `${s}: ${c}`)
        .join("  ");
      console.log(`    ${articles.length} total — ${sectionStrs}`);
      console.log();
    }

    // Decisions summary
    if (decisions.length > 0) {
      console.log(chalk.bold("  Recent Decisions:"));
      for (const d of decisions.slice(0, 3)) {
        console.log(
          `    ${formatDecisionStatus(d.status)} ${truncate(d.title, 50)} (${agentColor(d.decided_by)(d.decided_by)})`
        );
      }
      console.log();
    }

    // Archives summary
    if (archives.length > 0) {
      console.log(chalk.bold("  Project Archives:"));
      for (const a of archives.slice(0, 3)) {
        console.log(
          `    ${formatArchiveStatus(a.status)} ${truncate(a.project_name, 50)}`
        );
      }
      console.log();
    }

    console.log(
      chalk.dim("  Use subcommands: wiki, decisions, journals, archives, search\n")
    );
  } finally {
    km.close();
  }
}

// ── Wiki ──────────────────────────────────────────────────────────

export async function knowledgeWikiCommand(
  options: KnowledgeOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    console.log(header("Wiki"));

    const articles = km.listArticles();

    if (articles.length === 0) {
      console.log(chalk.dim("  No wiki articles yet.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Slug", "Title", "Section", "Ver", "Updated"],
      [6, 20, 26, 12, 5, 10]
    );

    for (const article of articles) {
      table.push([
        String(article.id),
        truncate(article.slug, 18),
        truncate(article.title, 24),
        formatSection(article.section),
        String(article.version),
        chalk.dim(formatTimeAgo(article.updated_at)),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  ${articles.length} articles total.\n`));
  } finally {
    km.close();
  }
}

interface WikiShowOptions extends KnowledgeOptions {}

export async function knowledgeWikiShowCommand(
  slug: string,
  options: WikiShowOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    const article = km.getArticle(slug);
    if (!article) {
      console.error(chalk.red(`  Error: Article "${slug}" not found.\n`));
      return;
    }

    console.log(header(`Wiki: ${article.title}`));
    console.log(chalk.dim("  " + "\u2500".repeat(60)));
    console.log(`  Section:  ${formatSection(article.section)}`);
    console.log(`  Version:  ${article.version}`);
    console.log(
      `  Created:  ${formatTimeAgo(article.created_at)} by ${agentColor(article.created_by)(article.created_by)}`
    );
    console.log(
      `  Updated:  ${formatTimeAgo(article.updated_at)} by ${agentColor(article.updated_by)(article.updated_by)}`
    );
    console.log(chalk.dim("  " + "\u2500".repeat(60)));
    console.log();

    for (const line of article.content.split("\n")) {
      console.log(`  ${line}`);
    }
    console.log();
  } finally {
    km.close();
  }
}

interface WikiCreateOptions extends KnowledgeOptions {
  slug?: string;
  title?: string;
  section?: string;
  content?: string;
}

export async function knowledgeWikiCreateCommand(
  options: WikiCreateOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    if (!options.slug || !options.title) {
      console.error(
        chalk.red(
          "  Error: --slug and --title are required.\n  Usage: aicib knowledge wiki create --slug <slug> --title <title> --content <text>\n"
        )
      );
      return;
    }

    if (
      options.section &&
      !VALID_WIKI_SECTIONS.includes(options.section as WikiSection)
    ) {
      console.error(
        chalk.red(
          `  Error: Invalid section "${options.section}". Valid: ${VALID_WIKI_SECTIONS.join(", ")}\n`
        )
      );
      return;
    }

    const existing = km.getArticle(options.slug);
    if (existing) {
      console.error(
        chalk.red(
          `  Error: Article with slug "${options.slug}" already exists.\n`
        )
      );
      return;
    }

    const article = km.createArticle({
      slug: options.slug,
      title: options.title,
      section: (options.section as WikiSection) || "general",
      content: options.content || "",
      created_by: "human-founder",
    });

    console.log(header("Article Created"));
    console.log(`  ${chalk.green("\u2713")} "${article.title}" (${article.slug})`);
    console.log(`  ${chalk.green("\u2713")} Section: ${formatSection(article.section)}`);
    console.log();
  } finally {
    km.close();
  }
}

export async function knowledgeWikiHistoryCommand(
  slug: string,
  options: KnowledgeOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    const article = km.getArticle(slug);
    if (!article) {
      console.error(chalk.red(`  Error: Article "${slug}" not found.\n`));
      return;
    }

    console.log(header(`Wiki History: ${article.title}`));
    console.log(
      `  Current version: ${article.version} (by ${agentColor(article.updated_by)(article.updated_by)})\n`
    );

    const history = km.getArticleHistory(slug);

    if (history.length === 0) {
      console.log(chalk.dim("  No previous versions.\n"));
      return;
    }

    const table = createTable(
      ["Ver", "Title", "Edited By", "Date"],
      [6, 30, 14, 12]
    );

    for (const version of history) {
      table.push([
        String(version.version),
        truncate(version.title, 28),
        agentColor(version.edited_by)(version.edited_by),
        chalk.dim(formatTimeAgo(version.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log();
  } finally {
    km.close();
  }
}

// ── Decisions ─────────────────────────────────────────────────────

interface DecisionsOptions extends KnowledgeOptions {
  status?: string;
  limit?: string;
}

export async function knowledgeDecisionsCommand(
  options: DecisionsOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    console.log(header("Decisions"));

    const limit = options.limit ? parseInt(options.limit, 10) : 20;
    const filter: { status?: DecisionStatus } = {};

    if (options.status) {
      if (
        !VALID_DECISION_STATUSES.includes(options.status as DecisionStatus)
      ) {
        console.error(
          chalk.red(
            `  Error: Invalid status "${options.status}". Valid: ${VALID_DECISION_STATUSES.join(", ")}\n`
          )
        );
        return;
      }
      filter.status = options.status as DecisionStatus;
    }

    const decisions = km.listDecisions(filter, limit);

    if (decisions.length === 0) {
      console.log(chalk.dim("  No decisions recorded yet.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Title", "By", "Status", "Date"],
      [6, 32, 10, 12, 10]
    );

    for (const d of decisions) {
      table.push([
        String(d.id),
        truncate(d.title, 30),
        agentColor(d.decided_by)(truncate(d.decided_by, 8)),
        formatDecisionStatus(d.status),
        chalk.dim(formatTimeAgo(d.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  ${decisions.length} decisions shown.\n`));
  } finally {
    km.close();
  }
}

interface DecisionShowOptions extends KnowledgeOptions {}

export async function knowledgeDecisionsShowCommand(
  id: string,
  options: DecisionShowOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    const decisionId = parseInt(id, 10);
    if (Number.isNaN(decisionId)) {
      console.error(chalk.red("  Error: Decision ID must be a number.\n"));
      return;
    }

    const decision = km.getDecision(decisionId);
    if (!decision) {
      console.error(
        chalk.red(`  Error: Decision #${decisionId} not found.\n`)
      );
      return;
    }

    console.log(header(`Decision #${decision.id}`));
    console.log(chalk.bold(`  ${decision.title}`));
    console.log(chalk.dim("  " + "\u2500".repeat(60)));
    console.log(
      `  Status:    ${formatDecisionStatus(decision.status)}`
    );
    console.log(
      `  Decided by: ${agentColor(decision.decided_by)(decision.decided_by)}`
    );
    if (decision.department) {
      console.log(`  Department: ${decision.department}`);
    }
    console.log(`  Date:       ${formatTimeAgo(decision.created_at)}`);

    // Options considered
    try {
      const options_list = JSON.parse(decision.options_considered) as string[];
      if (options_list.length > 0) {
        console.log();
        console.log(chalk.bold("  Options Considered:"));
        for (const opt of options_list) {
          console.log(`    - ${opt}`);
        }
      }
    } catch {
      /* ignore */
    }

    // Reasoning
    if (decision.reasoning) {
      console.log();
      console.log(chalk.bold("  Reasoning:"));
      for (const line of decision.reasoning.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    // Outcome
    if (decision.outcome) {
      console.log();
      console.log(chalk.bold("  Outcome:"));
      console.log(`    ${decision.outcome}`);
    }

    console.log();
  } finally {
    km.close();
  }
}

// ── Journals ──────────────────────────────────────────────────────

interface JournalsOptions extends KnowledgeOptions {
  agent?: string;
  type?: string;
  limit?: string;
}

export async function knowledgeJournalsCommand(
  options: JournalsOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    const filterLabel = options.agent ? ` (agent: ${options.agent})` : "";
    console.log(header(`Agent Journals${filterLabel}`));

    let entries;
    const limit = options.limit ? parseInt(options.limit, 10) : 20;

    if (options.agent && options.type) {
      if (
        !VALID_JOURNAL_ENTRY_TYPES.includes(
          options.type as JournalEntryType
        )
      ) {
        console.error(
          chalk.red(
            `  Error: Invalid type "${options.type}". Valid: ${VALID_JOURNAL_ENTRY_TYPES.join(", ")}\n`
          )
        );
        return;
      }
      entries = km
        .getJournalEntriesByType(options.agent, options.type as JournalEntryType)
        .slice(0, limit);
    } else if (options.agent) {
      entries = km.getJournalEntries(options.agent, limit);
    } else {
      // All agents — use search with empty string which matches everything via LIKE '%%'
      const searchResults = km.search("", {
        types: ["journal"],
        limit,
      });

      if (searchResults.length === 0) {
        console.log(chalk.dim("  No journal entries yet.\n"));
        return;
      }

      const table = createTable(
        ["ID", "Title", "Date"],
        [6, 50, 12]
      );

      for (const r of searchResults) {
        table.push([
          String(r.id),
          truncate(r.title, 48),
          chalk.dim(r.created_at ? formatTimeAgo(r.created_at) : "--"),
        ]);
      }

      console.log(table.toString());
      console.log(chalk.dim(`\n  ${searchResults.length} entries shown.\n`));
      return;
    }

    if (entries.length === 0) {
      console.log(chalk.dim("  No journal entries found.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Type", "Title", "Date"],
      [6, 10, 40, 12]
    );

    for (const entry of entries) {
      table.push([
        String(entry.id),
        formatEntryType(entry.entry_type),
        truncate(entry.title, 38),
        chalk.dim(formatTimeAgo(entry.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  ${entries.length} entries shown.\n`));
  } finally {
    km.close();
  }
}

// ── Archives ──────────────────────────────────────────────────────

interface ArchivesOptions extends KnowledgeOptions {
  status?: string;
}

export async function knowledgeArchivesCommand(
  options: ArchivesOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    console.log(header("Project Archives"));

    let statusFilter: ArchiveStatus | undefined;
    if (options.status) {
      if (
        !VALID_ARCHIVE_STATUSES.includes(options.status as ArchiveStatus)
      ) {
        console.error(
          chalk.red(
            `  Error: Invalid status "${options.status}". Valid: ${VALID_ARCHIVE_STATUSES.join(", ")}\n`
          )
        );
        return;
      }
      statusFilter = options.status as ArchiveStatus;
    }

    const archives = km.listArchives(statusFilter);

    if (archives.length === 0) {
      console.log(chalk.dim("  No project archives yet.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Project", "Status", "Cost", "Completed"],
      [6, 30, 12, 10, 12]
    );

    for (const a of archives) {
      table.push([
        String(a.id),
        truncate(a.project_name, 28),
        formatArchiveStatus(a.status),
        a.total_cost_usd != null
          ? `$${a.total_cost_usd.toFixed(2)}`
          : chalk.dim("--"),
        a.completed_at
          ? chalk.dim(formatTimeAgo(a.completed_at))
          : chalk.dim("--"),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  ${archives.length} archives.\n`));
  } finally {
    km.close();
  }
}

interface ArchiveShowOptions extends KnowledgeOptions {}

export async function knowledgeArchivesShowCommand(
  id: string,
  options: ArchiveShowOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    const archiveId = parseInt(id, 10);
    if (Number.isNaN(archiveId)) {
      console.error(chalk.red("  Error: Archive ID must be a number.\n"));
      return;
    }

    const archive = km.getArchive(archiveId);
    if (!archive) {
      console.error(
        chalk.red(`  Error: Archive #${archiveId} not found.\n`)
      );
      return;
    }

    console.log(header(`Archive: ${archive.project_name}`));
    console.log(chalk.dim("  " + "\u2500".repeat(60)));
    console.log(`  Status:    ${formatArchiveStatus(archive.status)}`);
    console.log(
      `  Created by: ${agentColor(archive.created_by)(archive.created_by)}`
    );
    if (archive.total_cost_usd != null) {
      console.log(`  Cost:      $${archive.total_cost_usd.toFixed(4)}`);
    }
    if (archive.started_at) {
      console.log(`  Started:   ${archive.started_at}`);
    }
    if (archive.completed_at) {
      console.log(`  Completed: ${archive.completed_at}`);
    }

    // Description
    if (archive.description) {
      console.log();
      console.log(chalk.bold("  Description:"));
      for (const line of archive.description.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    // Deliverables
    try {
      const deliverables = JSON.parse(archive.deliverables) as string[];
      if (deliverables.length > 0) {
        console.log();
        console.log(chalk.bold("  Deliverables:"));
        for (const d of deliverables) {
          console.log(`    - ${d}`);
        }
      }
    } catch {
      /* ignore */
    }

    // Lessons learned
    if (archive.lessons_learned) {
      console.log();
      console.log(chalk.bold("  Lessons Learned:"));
      for (const line of archive.lessons_learned.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    console.log();
  } finally {
    km.close();
  }
}

// ── Search ────────────────────────────────────────────────────────

interface SearchCLIOptions extends KnowledgeOptions {
  limit?: string;
}

export async function knowledgeSearchCommand(
  keyword: string,
  options: SearchCLIOptions
): Promise<void> {
  const km = getKnowledgeManager(options.dir);

  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 20;
    console.log(header(`Knowledge Search: "${keyword}"`));

    const results = km.search(keyword, { limit });

    if (results.length === 0) {
      console.log(chalk.dim("  No results found.\n"));
      return;
    }

    const table = createTable(
      ["Type", "ID", "Title", "Snippet", "Date"],
      [10, 6, 24, 26, 10]
    );

    for (const r of results) {
      const typeStr =
        r.type === "wiki"
          ? chalk.cyan("wiki")
          : r.type === "journal"
            ? chalk.green("journal")
            : r.type === "decision"
              ? chalk.yellow("decision")
              : chalk.blue("archive");

      table.push([
        typeStr,
        String(r.id),
        truncate(r.title, 22),
        chalk.dim(truncate(r.snippet.replace(/\n/g, " "), 24)),
        chalk.dim(r.created_at ? formatTimeAgo(r.created_at) : "--"),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  ${results.length} results found.\n`));
  } finally {
    km.close();
  }
}
