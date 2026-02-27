# Journal — CEO Memory Across Sessions

## Overview

The journal gives your CEO a "memory" of past work sessions. After each brief, the system automatically writes a short summary of what happened. Next time the CEO starts up, it reads these summaries so it knows what was done before.

## How It Works

1. You send a brief → CEO delegates → work gets done
2. After the brief finishes, the system auto-generates a 3-5 sentence summary
3. The summary is saved to the database
4. Next time the CEO starts, it loads recent summaries into its context — like reading notes before a meeting

You don't need to do anything — this happens automatically.

## Commands

### View recent journal entries

```
aicib journal
```

Shows the last 10 session summaries with dates, directives, and costs.

**What you see:**
```
AI Company-in-a-Box — CEO Journal

  Date       | Directive                        | Summary                                | Cost
  2026-02-15 | Build a landing page for our...  | Delegated landing page to CTO and CMO. | $1.47
  2026-02-14 | Create a pricing strategy        | CFO analyzed competitor pricing...      | $2.31
```

### Search by keyword

```
aicib journal --search "pricing"
```

Finds all journal entries where the directive or summary mentions "pricing."

### Limit entries shown

```
aicib journal --limit 5
```

Shows only the 5 most recent entries.

## What Can Go Wrong

- **"No journal entries found"** → No briefs have been completed yet. Run a brief first.
- **Journal generation silently skipped** → If the summary call to Claude fails (API error, budget exceeded), the brief still completes normally. You'll see a warning in the console but won't lose any work.
- **Journal loading fails on startup** → If the database is corrupted or inaccessible, the CEO starts without memory. A warning is logged but the session proceeds normally.

## Technical Notes

- Summaries are generated using the Haiku model (cheapest) — costs about $0.01 per summary
- The CEO gets the last 10 entries injected into its context, trimmed to 5 if the text is too long
- Journal entries are stored in the `ceo_journal` table in SQLite
- Keyword search uses SQL LIKE matching on both the directive and summary text
