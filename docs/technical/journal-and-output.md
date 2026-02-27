# Journal System, Colored Output & Org Chart

## What It Does

Three features in one sub-phase:
1. **CEO Journal** — auto-generates a session summary after each brief so the CEO "remembers" past work
2. **Colored Output** — each agent's messages show in a distinct color in the terminal
3. **Org Chart** — Unicode box-drawing visualization of the company hierarchy

---

## CEO Journal

### How It Works

After every `aicib brief`, the system automatically:

1. Resumes the CEO's SDK session using the **Haiku** model (cheapest, ~$0.01)
2. Asks: "Generate a concise journal entry (3-5 sentences) covering what was requested, how you delegated, key decisions, what was produced, and context for future sessions"
3. Stores the summary in the `ceo_journal` SQLite table with the directive, cost, turns, and duration

On the next session, `startCEOSession()` loads the last 10 journal entries and injects them into the CEO's system prompt as a `## Recent Session History` block. Token safety: if the formatted text exceeds ~6000 characters (~3000 tokens), it trims to 5 entries.

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS ceo_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    directive TEXT NOT NULL,
    summary TEXT NOT NULL,
    deliverables TEXT,            -- JSON array (currently always null)
    total_cost_usd REAL DEFAULT 0,
    num_turns INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
```

Indexed on `session_id` and `created_at`.

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `generateJournalEntry()` | `agent-runner.ts` | Resumes CEO session with Haiku, gets summary, saves to DB |
| `createJournalEntry(entry)` | `cost-tracker.ts` | Inserts into `ceo_journal` table |
| `getRecentJournalEntries(limit)` | `cost-tracker.ts` | Fetches last N entries, newest first |
| `searchJournalByKeyword(keyword)` | `cost-tracker.ts` | LIKE search on directive and summary |
| `formatJournalForContext(entries)` | `cost-tracker.ts` | Formats entries as Markdown for CEO prompt injection |

---

## Colored Output

### Color Scheme

| Role | Color |
|------|-------|
| CEO | Magenta bold |
| CTO | Blue bold |
| CFO | Green bold |
| CMO | Yellow bold |
| Backend Engineer | Cyan |
| Frontend Engineer | Blue bright |
| Financial Analyst | Green bright |
| Content Writer | Yellow bright |
| System | Gray |
| Unknown subagent | White |

Colors are defined once in `output-formatter.ts` (`AGENT_COLORS` map). The `ui.ts` helper `agentColor()` delegates to `getAgentColor()` — single source of truth.

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `getAgentColor(role)` | `output-formatter.ts` | Returns chalk color for a role |
| `formatAgentTag(role)` | `output-formatter.ts` | Returns colored `[ROLE]` tag |
| `formatMessageWithColor(message)` | `output-formatter.ts` | Full SDK message → colored terminal string |
| `agentColor(role)` | `ui.ts` | Delegates to `getAgentColor()` |

---

## Org Chart

Renders a Unicode tree showing the company hierarchy:

```
  ┌──────────────────────────────────────────┐
  │  CEO — Chief Executive Officer (opus)    │
  └────────────────────┬─────────────────────┘
         ┌─────────────┼─────────────────┐
    ┌────┴────┐   ┌────┴────┐   ┌────┴────┐
    │CTO(opus)│   │CFO(son) │   │CMO(son) │
    └────┬────┘   └────┬────┘   └────┬────┘
      ┌──┴──┐      ┌──┴──┐      ┌──┴──┐
      │ BE  │      │ FA  │      │ CW  │
      │ FE  │      └─────┘      └─────┘
      └─────┘
```

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `buildOrgTree(projectDir, config)` | `org-chart.ts` | Reads agent defs, builds tree from `reports_to`/`spawns` |
| `renderOrgChart(tree)` | `org-chart.ts` | Renders tree as Unicode box-drawing art |
| `abbreviateRole(role)` | `org-chart.ts` | Maps roles to 2-letter codes (BE, FE, FA, CW) |

Shown on `aicib start` and `aicib status` when a session is active.

---

## Key Files

- `src/core/agent-runner.ts` — `generateJournalEntry()`, journal loading in `startCEOSession()`
- `src/core/cost-tracker.ts` — `ceo_journal` table, journal CRUD methods
- `src/core/output-formatter.ts` — `AGENT_COLORS`, `formatMessageWithColor()`
- `src/core/org-chart.ts` — `buildOrgTree()`, `renderOrgChart()`
- `src/cli/journal.ts` — `aicib journal` command handler
- `src/cli/brief.ts` — calls `generateJournalEntry()` after each brief
- `src/cli/start.ts` — renders org chart on startup

## Related

- Linear: COM-8
- User-facing docs: `docs/flows/journal.md`
