# Knowledge Management System

## Overview

A company-wide knowledge management system that provides shared organizational memory for AICIB agents. Includes a wiki for company knowledge, per-agent learning journals, a decision audit trail, and project archives. Knowledge is injected into agent prompts via a context provider and can be created both manually (CLI) and automatically (agent output markers).

## File Structure

```
src/core/
  knowledge.ts           # KnowledgeManager class — CRUD, search, context formatting
  knowledge-register.ts  # Side-effect registration (config + DB tables + context provider + message handler)

src/cli/
  knowledge.ts           # CLI commands: wiki, decisions, journals, archives, search, dashboard
```

## Integration Pattern

Same hook pattern as Tasks and Intelligence features:

1. **Side-effect import** in `index.ts` loads `knowledge-register.ts`
2. Register.ts calls `registerConfigExtension()` for the `knowledge:` config section
3. Register.ts calls `registerTable()` for 5 tables
4. Register.ts calls `registerContextProvider()` for `company-knowledge` — injects wiki + decisions + archives into agent prompt
5. Register.ts calls `registerMessageHandler()` for `knowledge-actions` — parses KNOWLEDGE:: markers from agent output

**Core files NOT modified:** `agent-runner.ts`, `config.ts`, `cost-tracker.ts`

## Database Schema

### wiki_articles

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| slug | TEXT UNIQUE | URL-friendly identifier |
| title | TEXT | Article title |
| section | TEXT | `overview`, `products`, `policies`, `brand`, `customers`, `competitors`, `general` |
| content | TEXT | Article content |
| version | INTEGER | Current version number |
| created_by | TEXT | Agent role that created |
| updated_by | TEXT | Agent role that last updated |
| created_at | TEXT | ISO 8601 datetime |
| updated_at | TEXT | ISO 8601 datetime |

### wiki_article_versions

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| article_id | INTEGER FK | References wiki_articles.id |
| version | INTEGER | Version number at time of snapshot |
| title | TEXT | Title at that version |
| content | TEXT | Content at that version |
| edited_by | TEXT | Agent role that made this version |
| created_at | TEXT | When snapshot was created |

UNIQUE constraint on (article_id, version).

### agent_journals

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| agent_role | TEXT | Agent that created the entry |
| session_id | TEXT | Session context |
| entry_type | TEXT | `task_outcome`, `lesson`, `pattern`, `mistake`, `reflection` |
| title | TEXT | Entry title |
| content | TEXT | Entry content |
| tags | TEXT | JSON array of tags |
| created_at | TEXT | ISO 8601 datetime |

### decision_log

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| title | TEXT | Decision title |
| decided_by | TEXT | Agent role |
| department | TEXT | Department context |
| options_considered | TEXT | JSON array of options |
| reasoning | TEXT | Why this decision was made |
| outcome | TEXT | Result of the decision |
| status | TEXT | `active`, `superseded`, `reversed` |
| session_id | TEXT | Session context |
| related_task_id | INTEGER | Optional task reference |
| created_at | TEXT | ISO 8601 datetime |
| updated_at | TEXT | ISO 8601 datetime |

### project_archives

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment ID |
| project_name | TEXT | Project name |
| description | TEXT | Project description |
| status | TEXT | `completed`, `cancelled`, `on_hold` |
| deliverables | TEXT | JSON array of deliverable names |
| lessons_learned | TEXT | Retrospective notes |
| total_cost_usd | REAL | Total project cost |
| started_at | TEXT | Project start date |
| completed_at | TEXT | Project completion date |
| created_by | TEXT | Agent role |
| session_id | TEXT | Session context |

## Index Naming

Agent journal indexes use the `idx_agent_journal_` prefix (e.g., `idx_agent_journal_created`, `idx_agent_journal_session`) to avoid collisions with the existing `ceo_journal` table indexes (`idx_journal_created`, `idx_journal_session`) in cost-tracker.ts. SQLite index names are database-global — `CREATE INDEX IF NOT EXISTS` silently no-ops on name collisions.

## Configuration

```yaml
knowledge:
  enabled: true
  max_wiki_context_chars: 3000    # Max chars for wiki content in agent prompts
  max_journal_entries: 10         # Max journal entries per agent in context
  max_decision_entries: 10        # Max active decisions in context
  max_search_results: 20          # Max search results
  wiki_edit_roles:                # Roles allowed to edit wiki
    - ceo
    - cto
    - cfo
    - cmo
```

## Context Provider: company-knowledge

Injects a combined context block into the CEO's prompt:

1. **Wiki summary** (~3000 chars): Section headings with article titles; overview section includes content previews
2. **Active decisions** (~1500 chars): Recent active decisions as bullet points
3. **Project archives** (~1000 chars): Recent project summaries

Total budget: ~5500 chars (~2750 tokens).

**Note:** Agent journals are NOT injected in the global context because the context provider hook doesn't receive `agentRole`. Per-agent journal injection is deferred to when sub-agents get their own context providers.

## Message Handler: knowledge-actions

### Structured Markers

```
KNOWLEDGE::WIKI_CREATE slug="..." section=... title="..." content="..."
KNOWLEDGE::WIKI_UPDATE slug="..." content="..."
KNOWLEDGE::JOURNAL type=lesson title="..." content="..."
KNOWLEDGE::DECISION title="..." options="A,B,C" reasoning="..." outcome="..."
KNOWLEDGE::ARCHIVE project="..." description="..." status=completed deliverables="file1,file2" lessons="..."
```

### Natural Language Fallbacks

- `learned that/about <text>` → creates journal entry (type=lesson)
- `decided to/that <text>` → creates decision entry

Minimum 10 characters to reduce false positives.

## CEO Journal Coexistence

The existing `ceo_journal` table is unchanged. It serves automated session summaries (tied to `generateJournalEntry()` in `agent-runner.ts`). The new `agent_journals` table serves agent-initiated learning entries. Both coexist — no migration needed. The existing `aicib journal` command continues to work.

## Wiki Update Atomicity

`updateArticle()` wraps the version snapshot INSERT and article UPDATE in a `db.transaction()`. This ensures no orphan version rows if a crash occurs between the two statements. The snapshot captures the current title, content, and version before the article is updated in-place.

## Search

`search(keyword, options?)` runs `LIKE` queries across all 4 content tables, merges results in JavaScript, sorts by date, and returns `SearchResult[]` with type, id, title, snippet, and created_at. Archive results fall back to `started_at` when `completed_at` is null to avoid NaN sort values. Simple and sufficient for expected data volumes; FTS5 deferred to a future release.
