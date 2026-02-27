# Data Export/Import

## Overview

Export and import your AI company's complete state — config, agents, knowledge base, tasks, HR records, and more. Create full backups, share anonymized templates, or selectively export specific categories.

## Commands

### `aicib export`

Exports company data to a `.tar.gz` archive (or directory with `--no-compress`).

**Full backup (default):**
```bash
aicib export
# → aicib-export-mycompany-20250215-143022.tar.gz
```

**Custom output path:**
```bash
aicib export -o backup.tar.gz
```

**Selective export (specific categories only):**
```bash
aicib export --mode selective --only knowledge,tasks
```

**Anonymized template (for sharing):**
```bash
aicib export --mode anonymized -o template.tar.gz
```

**Include secrets (integration tokens/keys):**
```bash
aicib export --include-secrets
```

**Uncompressed directory output:**
```bash
aicib export --no-compress
```

**Available categories:** configs, agents, costs, tasks, knowledge, hr, projects, safeguards, scheduler, integrations, runtime

**What you see:**
```
  Export Summary
  ──────────────────────────────────────────────────
  Mode:         full
  Company:      MyStartup
  Categories:   configs, agents, costs, tasks, knowledge, hr, projects, safeguards, scheduler, integrations, runtime
  Agents:       5
  Tables:       18
  Total rows:   342
  Size:         45.2 KB
  Output:       aicib-export-mystartup-20250215-143022.tar.gz
```

### `aicib import <path>`

Imports company data from an export archive or directory.

**Full restore (with confirmation prompt):**
```bash
aicib import backup.tar.gz
```

**Force overwrite (skip confirmation):**
```bash
aicib import backup.tar.gz --force
```

**Merge into existing company (skip conflicts):**
```bash
aicib import knowledge-export.tar.gz --merge --only knowledge
```

**Import anonymized template with a new company name:**
```bash
aicib import template.tar.gz --force --company-name "NewCo"
```

**Overwrite existing agent definitions:**
```bash
aicib import backup.tar.gz --force --overwrite-agents
```

**What you see:**
```
  Import Summary
  ──────────────────────────────────────────────────
  Config restored:    yes
  Agents restored:    5
  Tables imported:    18
  Rows imported:      342
```

## What Can Go Wrong

- **Import without `--force` when config exists** — Prompts for confirmation. Answer "No" to cancel.
- **Source archive not found** — Check the path to the `.tar.gz` file.
- **Target directory doesn't exist** — Create the project directory first (or use `aicib init`).
- **Version mismatch** — The export package was created with a newer version. Update aicib.
- **Missing tables during import** — Tables not present in the target DB are silently skipped. Run the appropriate feature once to create them.

## Template Sharing Workflow

1. Set up your company with `aicib init`, customize agents and config
2. Export as anonymized template: `aicib export --mode anonymized -o my-template.tar.gz`
3. Share the `.tar.gz` file
4. Others import it: `aicib import my-template.tar.gz --force --company-name "TheirCompany"`

The anonymized export preserves your company's structure (schedules, task categories, HR onboarding setup) while stripping all proprietary content (task descriptions, wiki articles, journal entries, decision reasoning).
