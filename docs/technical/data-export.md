# Data Export/Import

## What It Does

Full backup, restore, and template sharing for an AI company. Exports the complete company state (config, agent definitions, database tables) to a portable archive. Supports three modes: full backup, selective category export, and anonymized template sharing.

## How It Works

### Architecture

```
aicib export → data-export.ts (core)
                ├── Read aicib.config.yaml
                ├── Copy .claude/agents/*.md
                ├── Copy .aicib/presets/*.md
                ├── Open state.db (read-only)
                ├── SELECT * from each table → JSON files
                ├── Write manifest.json
                └── tar -czf archive.tar.gz

aicib import → data-export.ts (core)
                ├── Extract .tar.gz (if compressed)
                ├── Validate manifest.json
                ├── Restore config.yaml
                ├── Restore agent .md files
                ├── Restore presets
                └── Open state.db → INSERT rows per table
```

### Export Modes

- **full** — Everything: config, agents, presets, all database tables
- **selective** — Only specified categories (e.g., `--only knowledge,tasks`)
- **anonymized** — Strips proprietary content while preserving structure. Company name replaced with `{{company_name}}` placeholder. Table content redacted per anonymization rules.

### Category System

Each category maps to specific database tables:

| Category | Tables |
|----------|--------|
| configs | *(none — config.yaml exported as whole)* |
| agents | *(none — .md files exported directly)* |
| costs | cost_entries, sessions, session_data |
| tasks | tasks, task_blockers, task_comments |
| knowledge | wiki_articles, wiki_article_versions, agent_journals, decision_log, project_archives |
| hr | hr_events, hr_onboarding, hr_reviews, hr_improvement_plans |
| projects | projects, project_phases, background_jobs, background_logs, ceo_journal |
| safeguards | safeguard_pending, external_actions |
| scheduler | schedules, schedule_executions, scheduler_state |
| integrations | mcp_integrations, slack_channels, slack_chat_sessions, slack_state |
| runtime | agent_status, escalation_events |

### Anonymization Rules

Tables fall into three categories during anonymized export:

- **include** — Fully preserved (structural data only): `task_blockers`, `hr_onboarding`
- **anonymize** — Content redacted but structure preserved: `tasks`, `wiki_articles`, `agent_journals`, `decision_log`, `hr_events`, `hr_reviews`, `hr_improvement_plans`, `schedules`
- **exclude** — Entirely omitted: cost data, runtime state, logs, integrations, chat sessions, safeguard actions

### Secret Stripping

By default, config export strips values from keys matching secret patterns (token, secret, api_key, apikey, password, credential, auth_token, auth_secret, oauth_token, oauth_secret). Use `--include-secrets` to override. The `/auth/i` broad pattern was replaced with specific auth-related patterns to avoid false positives on structural fields like "author", "authorized_at", and "auth_method".

### Import Strategies

- **Full import** (default) — Clears target tables before inserting. Requires `--force` if config already exists.
- **Merge import** (`--merge`) — Uses `INSERT OR IGNORE` to skip conflicting rows. Preserves existing config.
- **Template import** — For anonymized packages, use `--company-name` to replace `{{company_name}}` placeholders.

### Compression

Uses `execFileSync("tar", [...])` (array form, no shell injection). Archives are `.tar.gz` by default; use `--no-compress` for directory output.

### DB Access

Opens `state.db` directly via `better-sqlite3` in read-only mode for exports. For imports, opens writable with WAL mode and wraps all inserts in a single transaction. Both export and import DB connections are wrapped in `try/finally` to ensure `db.close()` on errors.

### Safety

- **Table name validation:** `^[a-z0-9_]+$` regex check before SQL construction in both export and import
- **Export cleanup:** Partial export directory is cleaned up on failure (try/catch with rmSync)
- **Import cleanup:** Temp directory from tar extraction is always cleaned up in finally block, even if extraction itself fails
- **Prepared statement caching:** Import caches prepared statements per table, re-preparing only when column set changes across rows
- **Version tracking:** `aicib_version` in manifest reads from `package.json` via `createRequire` instead of hardcoded string

## Key Files

- `src/core/data-export.ts` — Core logic: types, `exportCompanyData()`, `importCompanyData()`, `validateExportPackage()`, `stripConfigSecrets()`, `anonymizeTableRows()`, category-to-table mapping, anonymization rules
- `src/cli/data-export.ts` — CLI handlers: `exportCommand()`, `importCommand()` with chalk output, ora spinners, inquirer confirmation
- `src/index.ts` — Wired `aicib export` and `aicib import` commands

## Export Package Format

```
aicib-export-<company-slug>-<YYYYMMDD-HHmmss>/
  manifest.json      ← Version, mode, timestamp, categories, table list, row counts
  config.yaml        ← Company config (secrets stripped by default)
  agents/            ← .claude/agents/*.md files
  data/              ← JSON dump per included table
  presets/            ← Custom persona presets (if any)
```

## Edge Cases

- Export when no DB exists: exports config + agents only, zero table rows
- Import when target directory doesn't exist: fails with clear error
- Import when config exists without `--force`: prompts for confirmation (full import) or fails (non-interactive)
- Anonymized mode strips content but preserves IDs and structural relationships
- Tables not present in DB are silently skipped during export
- Tables not present in target DB are silently skipped during import
