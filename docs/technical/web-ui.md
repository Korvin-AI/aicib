# Web UI — Technical Documentation

## What It Does

A local Next.js 16 web app (`aicib/ui/`) that provides a visual dashboard for the AI company. Reads directly from the same SQLite database the CLI uses. Launched via `aicib ui`.

## Architecture

```
Browser (localhost:3000)
     │
     │  HTTP + SSE
     │
     ▼
┌─────────────────────────┐
│  Next.js 16 (Turbopack)  │
│  aicib/ui/               │
│                          │
│  API routes read SQLite  │  ← Direct SQL queries (no core module imports)
│  Brief API shells out    │  ← Spawns `aicib brief -b` as subprocess
│  to CLI                  │
└────────────┬─────────────┘
             │
             ▼
       .aicib/state.db
       (same database)
```

**Key design decision:** The UI does NOT import from `../src/core/`. Turbopack can't resolve `.js` → `.ts` extension aliases used in core source files. Instead, API routes query SQLite directly and the brief endpoint shells out to the CLI. This makes the UI a pure read layer + command launcher.

## Tech Stack

| Layer | Choice | Version |
|-------|--------|---------|
| Framework | Next.js (App Router, Turbopack) | 16.1.6 |
| React | React | 19.x |
| UI Components | shadcn/ui (new-york style) | latest |
| Styling | Tailwind CSS | v4 (CSS-based config) |
| Icons | lucide-react | latest |
| Database | better-sqlite3 | latest |
| Theme | Dark mode default | `<html className="dark">` |

**Not used (from original plan):**
- Tremor — requires React 18, incompatible with React 19
- React Flow — deferred (org chart visualization)

## Key Files

### Library Layer (`lib/`)

- `lib/config.ts` — Detects project directory. Checks `AICIB_PROJECT_DIR` env var (set by `aicib ui`), then walks up from cwd looking for `aicib.config.yaml`. Caches result.
- `lib/db.ts` — SQLite connection factory. `getDb()` returns a cached read-write connection with WAL mode + 5s busy timeout. `openReadOnlyDb()` creates a fresh read-only connection for SSE streams.
- `lib/sse.ts` — Client-side `useSSE()` React hook. Wraps browser `EventSource`, auto-reconnects after 3s on error. Returns `{ lastEvent, connected }`.
- `lib/agent-colors.ts` — Maps agent roles to Tailwind CSS classes (`bg`, `text`, `border`, `dot`). Mirrors `src/core/output-formatter.ts` color scheme.
- `lib/utils.ts` — shadcn's `cn()` utility (clsx + tailwind-merge).
- `lib/init-core.ts` — No-op placeholder. Originally intended for side-effect imports of register modules, but unnecessary since we use direct SQL.

### API Routes (`app/api/`)

**`GET /api/status`** — Returns all dashboard data in one call:
- `company` — name and template parsed from `aicib.config.yaml` via regex (avoids importing js-yaml)
- `session` — active session check from `sessions` table
- `agents` — config agents merged with `agent_status` table. Falls back to DB-only if no config agents found. YAML agents section parsed with `/^agents:\s*\n((?:[ ]{2,}.*\n)*)/m` — uses `[ ]{2,}` (2+ literal spaces) to capture all indented lines including properties (model, enabled) and workers.
- `costs` — today + month totals from `cost_entries`, limits from config
- `tasks` — status counts from `tasks` table (try/catch for missing table)
- `recentLogs` — last 20 rows from `background_logs`
- `recentJobs` — last 5 from `background_jobs`

**`GET /api/stream`** — SSE endpoint for live updates:
- Opens its own read-only SQLite connection
- Polls every 2 seconds with watermark-based change detection:
  - `agent_status` — JSON hash comparison
  - `cost_entries` — SUM comparison for today
  - `background_logs` — `id > lastId` watermark
  - `tasks` — `MAX(updated_at)` comparison
- Sends events only when data changes: `agent_status`, `cost_update`, `new_logs`, `task_update`
- Cleans up DB connection on client disconnect

**`POST /api/brief`** — Submit a directive:
- Validates directive string (non-empty)
- Checks for active session in `sessions` table
- Checks for running background job (verifies PID is alive via `process.kill(pid, 0)`)
- Spawns `npx aicib brief -b -d <projectDir> <directive>` as detached subprocess
- Returns `{ success, pid, message }`

### Components (`components/`)

- `sidebar.tsx` — 10 nav items with Lucide icons, highlights active route via `usePathname()`
- `topbar.tsx` — Breadcrumb title + SSE connection indicator (green/red dot)
- `brief-input.tsx` — Persistent bottom bar, POSTs to `/api/brief`, shows error inline
- `kpi-cards.tsx` — 4 metric cards, fetches from `/api/status`, updates on SSE events
- `agent-status-grid.tsx` — Card per agent with role-colored left border, status dot, model badge
- `activity-feed.tsx` — ScrollArea with last 50 log entries, appends from SSE `new_logs` events
- `quick-actions.tsx` — 4 link cards to Tasks, Costs, Activity, Settings

### Setup Wizard (`components/setup/`, `app/setup/`, `app/api/setup/`)

The setup wizard provides a browser-based first-run experience. When a user opens `localhost:3000` with no `aicib.config.yaml`, the dashboard redirects them to `/setup`.

**Wizard Steps** (4-step flow in `setup-wizard.tsx`):
1. **Company Info** (`step-company.tsx`) — name, template selector (card-based), persona picker
2. **Team Builder** (`step-team.tsx`) — agent grid with model dropdowns (haiku/sonnet/opus) and enable/disable toggles
3. **Budget** (`step-budget.tsx`) — daily + monthly cost limit sliders with live cost estimates
4. **Review & Launch** (`step-review.tsx`) — summary of all choices, progress bar during init/start/redirect

**API Routes:**
- `POST /api/setup/init` — Creates config + DB. Shells out to `npx aicib init`. Validates company name (2-100 chars), template (allowlist: `saas-startup`), persona (allowlist: `professional`, `startup`, `technical`, `creative`). After init, patches `aicib.config.yaml` with custom agent models and budget settings via regex. Uses `escapeRegex()` for safe role name interpolation. Budget checks use `!== undefined` to allow `$0` values.
- `POST /api/setup/start` — Starts agent session. Spawns `npx aicib start -d <dir>` as detached subprocess (same pattern as brief API). Returns PID.
- `GET /api/setup/status` — Returns `{ configExists, dbExists, sessionActive }`. Uses `try/finally` to prevent SQLite connection leaks. Does NOT expose internal filesystem paths.
- `GET /api/setup/templates` — Returns available templates with default agent configs.

**Dashboard integration** (`app/(dashboard)/page.tsx`):
- On mount, checks `/api/setup/status`. If no config → redirects to `/setup`.
- If config exists but no session → shows "Start Company" banner with error feedback on failure.

**Color utility** (`lib/agent-colors.ts`):
- Both `step-review.tsx` and `step-team.tsx` use `getAgentColorClasses(role).dot` for consistent agent color dots. Avoids duplicating color maps.

**Peer review hardening:**
- Config existence guard after `aicib init` — catches CLI's bare `return` paths that exit 0 without creating config
- Template/persona allowlist validation — prevents ANSI-garbled CLI errors from invalid values
- Regex escaping for role names in config patching — defensive against special characters
- Budget `$0` fix — `!== undefined` instead of truthiness check
- DB connection leak fix in status route — `try/finally` ensures `db.close()`
- Start button error feedback — displays error message instead of silently failing
- Removed `projectDir` from status API response — no filesystem path exposure
- Fixed YAML agents section regex — `\s{2}\S` only matched 2-space lines, skipping all agent properties (model, enabled). Changed to `[ ]{2,}` to capture 2+-space lines. Without this fix, every agent showed "sonnet" regardless of config.
- Simplified Team Builder step — removed enable/disable toggles, model-only selection. Price shown next to dropdown (always visible) and inside dropdown options.

### CLI Command (`src/cli/ui-launcher.ts`)

The `aicib ui` command:
1. Resolves `ui/` directory relative to compiled `dist/` output
2. Auto-runs `npm install` if `ui/node_modules/` is missing
3. Spawns `npx next dev --port <port>` with `AICIB_PROJECT_DIR` env var
4. Opens browser after 2s delay (`open` on macOS)
5. Forwards SIGINT/SIGTERM for clean shutdown

Registered in `src/index.ts` as:
```
program.command("ui")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .option("-p, --port <port>", "Port number", "3000")
```

## Dark Theme

Dark mode is the default (`<html className="dark">`). Custom CSS variables defined in `app/globals.css`:

- Surface colors: `--color-surface: #0f0f0f`, `--color-surface-raised: #1a1a1a`, etc.
- Agent colors: `--color-agent-ceo: #a855f7` (purple), `--color-agent-cto: #3b82f6` (blue), `--color-agent-cfo: #22c55e` (green), `--color-agent-cmo: #f59e0b` (amber), etc.
- shadcn dark theme variables override the defaults with hex values instead of oklch

## SQLite Tables Read

| Table | Used By |
|-------|---------|
| `sessions` | /api/status, /api/brief |
| `session_data` | /api/status |
| `agent_status` | /api/status, /api/stream |
| `cost_entries` | /api/status, /api/stream |
| `tasks` | /api/status, /api/stream |
| `background_logs` | /api/status, /api/stream |
| `background_jobs` | /api/status, /api/brief |

### Setup API Tables

| Table | Used By |
|-------|---------|
| `sessions` | /api/setup/status |

Config files read/written:
- `aicib.config.yaml` — regex-parsed (not via js-yaml). Init API writes via CLI, then patches with regex. Status API checks existence only.

## Placeholder Pages

9 placeholder pages at `/tasks`, `/costs`, `/activity`, `/agents`, `/hr`, `/knowledge`, `/journal`, `/projects`, `/settings`. Each shows a heading and a placeholder message.

## Build & Verification

- `npm run build` in `aicib/ui/` — Turbopack production build, all 19 routes
- `npx tsc --noEmit` in `aicib/ui/` — TypeScript check
- `npx tsc --noEmit` in `aicib/` — CLI TypeScript check (includes ui-launcher.ts)
- `npm run dev` in `aicib/ui/` — Dev server on localhost:3000

## Related

- User flow: `docs/flows/web-dashboard.md`
- Implementation plan: `implementation/Phase-2.5-Web-UI-Plan.md`
- Agent color source: `src/core/output-formatter.ts`
