# Knowledge Management Workflows

## Overview

The knowledge system gives AICIB agents shared organizational memory: a company wiki, per-agent learning journals, a decision audit trail, and project archives.

## Quick Reference

```bash
# Dashboard
aicib knowledge

# Wiki
aicib knowledge wiki                          # List all articles
aicib knowledge wiki show <slug>              # Read an article
aicib knowledge wiki create --slug ... --title ... --content ...
aicib knowledge wiki history <slug>           # Version history

# Decisions
aicib knowledge decisions                     # List recent decisions
aicib knowledge decisions show <id>           # Decision detail
aicib knowledge decisions --status active     # Filter by status

# Journals
aicib knowledge journals                      # All agent entries
aicib knowledge journals --agent ceo          # Filter by agent
aicib knowledge journals --agent cto --type lesson

# Archives
aicib knowledge archives                      # List projects
aicib knowledge archives show <id>            # Archive detail
aicib knowledge archives --status completed   # Filter by status

# Search
aicib knowledge search <keyword>              # Unified search
```

## How Knowledge Gets Created

### 1. Agent Output Markers (Automatic)

During a brief, agents can create knowledge entries by outputting structured markers:

```
KNOWLEDGE::WIKI_CREATE slug="pricing-strategy" section=products title="Pricing Strategy" content="Our pricing model is..."
KNOWLEDGE::JOURNAL type=lesson title="API rate limits" content="Discovered that the Stripe API..."
KNOWLEDGE::DECISION title="Use PostgreSQL" options="PostgreSQL,MySQL,SQLite" reasoning="Need JSONB support" outcome="PostgreSQL selected"
```

These are parsed by the message handler and debounced (500ms) before writing to the database.

### 2. Natural Language (Automatic)

Agents saying things like "I learned that customers prefer monthly billing" or "I decided to use React for the frontend" will automatically create journal/decision entries.

### 3. CLI (Manual)

The human founder can create and manage knowledge directly:

```bash
aicib knowledge wiki create --slug "brand-voice" --title "Brand Voice Guide" --section brand --content "Our brand voice is..."
```

## Wiki Versioning

When a wiki article is updated, the previous content is automatically snapshotted to the `wiki_article_versions` table. This preserves full history while keeping current reads fast (no joins needed).

View version history with:
```bash
aicib knowledge wiki history <slug>
```

## Context Injection

The knowledge system automatically injects relevant context into agent prompts:

- **Wiki**: Section headings + article titles (overview content included if space allows)
- **Decisions**: Recent active decisions as bullet points
- **Archives**: Recent project summaries

This gives agents awareness of company knowledge without requiring them to search.

## Configuration

In `aicib.config.yaml`:

```yaml
knowledge:
  enabled: true                    # Enable/disable the whole system
  max_wiki_context_chars: 3000     # Wiki content budget in agent prompts
  max_decision_entries: 10         # Active decisions shown in context
  wiki_edit_roles:                 # Who can edit wiki via markers
    - ceo
    - cto
    - cfo
    - cmo
```

Set `enabled: false` to completely disable knowledge management (no context injection, no marker parsing).
