# Cost Tracker — Session Data Extension

## What It Does

Added a `session_data` table and three methods to `CostTracker` to bridge local AICIB session IDs with Claude Agent SDK session IDs. This enables `aicib brief` to resume the session that `aicib start` created.

## How It Works

### New Database Table

```sql
CREATE TABLE IF NOT EXISTS session_data (
  session_id TEXT PRIMARY KEY,    -- local AICIB session ID (e.g., "aicib-1707...")
  sdk_session_id TEXT,            -- Claude Agent SDK session ID
  project_dir TEXT,               -- absolute path to project
  company_name TEXT,              -- from config.yaml
  created_at TEXT DEFAULT now()   -- when the mapping was created
);
```

### New Methods

| Method | Purpose |
|--------|---------|
| `saveSDKSessionId(sessionId, sdkSessionId, projectDir, companyName)` | Stores the SDK session ID after `aicib start` |
| `getActiveSDKSessionId()` | Returns `{ sessionId, sdkSessionId }` for the active session, or `null` |
| `clearSDKSessionData(sessionId)` | Deletes the mapping when `aicib stop` is called |

### Flow

1. `aicib start` → creates local session → calls SDK → saves SDK session ID via `saveSDKSessionId()`
2. `aicib brief` → calls `getActiveSDKSessionId()` → uses `sdkSessionId` to resume SDK session
3. `aicib stop` → calls `clearSDKSessionData()` → then `endSession()`

## Concurrency & Safety

- **WAL mode** + **`busy_timeout = 5000`**: SQLite uses Write-Ahead Logging so the CLI and background worker can read/write simultaneously. The 5-second busy timeout means SQLite retries automatically if the database is momentarily locked, instead of failing immediately.
- **`ALLOWED_BG_JOB_FIELDS`**: The `updateBackgroundJob()` method validates column names at runtime against a hardcoded allowlist before building SQL. This prevents unexpected keys from being interpolated into queries (defense-in-depth alongside the compile-time `Pick<>` type).

## Key Files

- `src/core/cost-tracker.ts` — The `CostTracker` class with session, cost, and background job methods
