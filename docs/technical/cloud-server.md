# Cloud Server Architecture

## What It Does

The AICIB cloud server is a standalone API backend that lets multiple users access their AI companies through a web browser or mobile app, instead of only through the local CLI. It replaces the local SQLite database with a shared PostgreSQL database and adds user accounts, organizations, and multi-tenancy — meaning each user's data is isolated from everyone else's.

The server is built with Hono (a fast TypeScript web framework), runs on Node.js, and is designed to deploy to Railway (a cloud hosting platform).

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Web framework | Hono 4.7 | Lightweight, fast, TypeScript-native, runs on any Node.js host |
| Database | PostgreSQL | Production-grade relational DB; supports transactions, constraints, concurrent access |
| ORM | Drizzle ORM 0.39 | Type-safe SQL queries, schema-as-code, built-in migration system |
| Validation | Zod 3.24 | Runtime request validation with TypeScript type inference |
| Password hashing | Argon2 | Memory-hard hashing algorithm; recommended over bcrypt |
| Dev server | tsx | TypeScript execution with watch mode for development |
| Hosting | Railway | One-click deploy with managed PostgreSQL |

## Project Structure

```
server/
├── src/
│   ├── index.ts              # App entry point — middleware, routes, server start
│   ├── env.ts                # Environment variable validation (Zod schema)
│   ├── types.ts              # Shared TypeScript interfaces (AuthContext, TenantContext)
│   ├── db/
│   │   ├── connection.ts     # PostgreSQL connection pool (postgres.js + Drizzle)
│   │   ├── migrate.ts        # Auto-migration on server start
│   │   └── schema/
│   │       ├── index.ts      # Re-exports all schema modules
│   │       ├── auth.ts       # users, organizations, org_memberships, auth_sessions, api_keys
│   │       ├── business.ts   # businesses (multi-tenant container)
│   │       ├── data.ts       # Core data: cost_entries, sessions, agent_status, tasks, journals, HR
│   │       ├── helpers.ts    # tenantCols() — shared org_id + business_id FK columns
│   │       ├── knowledge.ts  # wiki_articles, wiki_article_versions
│   │       ├── scheduler.ts  # schedules, schedule_executions, scheduler_state
│   │       └── features.ts   # projects, reports, notifications, events, safeguards, MCP, etc.
│   ├── middleware/
│   │   ├── auth.ts           # Authentication — session cookies + API keys
│   │   ├── tenant.ts         # Multi-tenant business scoping
│   │   └── error-handler.ts  # Global error handler
│   ├── routes/
│   │   ├── auth.ts           # POST /auth/signup, /auth/login, /auth/logout, GET /auth/me
│   │   ├── health.ts         # GET /health — DB connectivity + uptime
│   │   ├── status.ts         # GET /businesses/:id/status — full dashboard snapshot
│   │   ├── agents.ts         # GET /businesses/:id/agents/:role — agent detail
│   │   ├── costs.ts          # GET /businesses/:id/costs — paginated cost entries
│   │   ├── tasks.ts          # GET /businesses/:id/tasks — filtered + paginated tasks
│   │   └── journal.ts        # GET /businesses/:id/journal — CEO/agent journal entries
│   ├── repositories/         # Data access layer (one file per domain)
│   │   ├── user-repo.ts      # User CRUD, password verification
│   │   ├── org-repo.ts       # Organization + membership management
│   │   ├── session-repo.ts   # Session creation/deletion with token hashing
│   │   ├── business-repo.ts  # Business CRUD
│   │   ├── status-repo.ts    # Dashboard status aggregation (parallelized queries)
│   │   ├── agent-repo.ts     # Agent detail queries
│   │   ├── cost-repo.ts      # Cost entry queries with pagination
│   │   ├── task-repo.ts      # Task queries with filtering + pagination
│   │   ├── journal-repo.ts   # Journal queries (CEO + agent tabs)
│   │   └── ...               # 10 more repos for HR, knowledge, scheduler, etc.
│   └── utils/
│       ├── token.ts          # Cryptographic session token generation (32 random bytes)
│       ├── password.ts       # Argon2 hash + verify wrappers
│       └── pagination.ts     # Query param parsing for page/pageSize/offset
├── drizzle/                   # Generated SQL migration files
│   ├── 0000_*.sql            # Initial schema (40 tables)
│   ├── 0001_*.sql            # Migration layer additions
│   ├── 0002_*.sql            # Composite PK fix for agent_status + hr_onboarding
│   └── meta/                 # Drizzle migration metadata
├── drizzle.config.ts         # Drizzle Kit configuration
├── tsconfig.json
├── package.json
├── .env                      # Local environment variables (gitignored)
└── .env.example              # Template for environment setup
```

## Database Design

### 40 Tables Across 6 Schema Modules

**Auth (5 tables):** `users`, `organizations`, `org_memberships`, `auth_sessions`, `api_keys`

**Business (1 table):** `businesses` — the multi-tenant container; each business belongs to one org and stores its config + agent definitions as JSONB.

**Core Data (16 tables):** `cost_entries`, `sessions`, `session_data`, `agent_status`, `background_jobs`, `background_logs`, `ceo_journal`, `tasks`, `task_blockers`, `task_comments`, `agent_journals`, `decision_log`, `hr_onboarding`, `hr_reviews`

**Knowledge (2 tables):** `wiki_articles`, `wiki_article_versions`

**Scheduler (3 tables):** `schedules`, `schedule_executions`, `scheduler_state`

**Features (13 tables):** `projects`, `project_phases`, `project_archives`, `reports`, `notifications`, `notification_preferences`, `company_events`, `hr_events`, `hr_improvement_plans`, `escalation_events`, `external_actions`, `safeguard_pending`, `auto_review_queue`, `mcp_integrations`

### Multi-Tenancy Model

```
Organization (org)
  └── Business (tenant boundary)
       ├── agent_status     (composite PK: business_id + agent_role)
       ├── cost_entries      (FK: business_id)
       ├── tasks             (FK: business_id)
       ├── ...every data table has org_id + business_id FKs
       └── All queries filter by businessId
```

Every data table includes `org_id` and `business_id` columns via the `tenantCols()` helper. The `business_id` column is the primary tenant boundary — all queries in the repository layer filter by it.

## Request Flow

```
Client Request
  ↓
Hono app.fetch
  ↓
Global middleware: logger → CORS → error handler
  ↓
Route matching
  ├── /health → health route (no auth)
  ├── /auth/* → auth routes (no auth, except /auth/me)
  └── /businesses/:businessId/* → protected routes
       ↓
       authMiddleware — validates session cookie or API key
       ↓
       tenantMiddleware — loads business, verifies org ownership
       ↓
       Route handler → Repository → Drizzle ORM → PostgreSQL
       ↓
       JSON response
```

## Authentication

Two authentication methods, both validated in `authMiddleware`:

### Session Cookies (browser users)
1. User signs up or logs in via `/auth/signup` or `/auth/login`
2. Server generates a 64-character hex token, hashes it with SHA-256, stores the hash in `auth_sessions`
3. Raw token is set as an HttpOnly cookie (`aicib_session`)
4. On subsequent requests, the cookie token is hashed and looked up in the DB
5. Sessions expire after 30 days

### API Keys (programmatic access)
1. API keys are org-scoped, stored as SHA-256 hashes in `api_keys`
2. Sent via `Authorization: Bearer <key>` header
3. API key auth sets `userId: null` and `orgRole: 'admin'` — there is no user context
4. The `/auth/me` endpoint returns 403 for API key auth

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check — DB status + uptime |
| POST | `/auth/signup` | Create account + org + session (transactional) |
| POST | `/auth/login` | Authenticate + create session |
| POST | `/auth/logout` | Delete session + clear cookie |
| GET | `/auth/me` | Current user + org + businesses (session auth only) |

### Protected (require auth + business context)

All routes prefixed with `/businesses/:businessId/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Full dashboard snapshot (agents, costs, tasks, logs, jobs) |
| GET | `/agents/:role` | Detailed agent info (status, journals, reviews, tasks) |
| GET | `/costs` | Paginated cost entries |
| GET | `/tasks` | Filtered + paginated task list |
| GET | `/journal` | CEO journal + agent journals + decision log |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | 3001 | Server listen port |
| `NODE_ENV` | No | development | `development`, `production`, or `test` |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |

## Migrations

Migrations are auto-generated by Drizzle Kit from the schema files and auto-applied on server start.

**Generate a new migration** (after changing schema files):
```bash
cd aicib/server && npx drizzle-kit generate
```

**Apply migrations** (standalone):
```bash
npx drizzle-kit migrate
```

**Behavior on failure:**
- **Production**: Migration failure calls `process.exit(1)` — the server will not start with an inconsistent DB.
- **Development**: Migration failure is logged as a warning — the server starts anyway for debugging.

## Connection Pool

Configured in `db/connection.ts`:
- **Production**: 20 connections max
- **Development**: 5 connections max
- Idle timeout: 20 seconds
- Connect timeout: 10 seconds

## Key Files

- `src/index.ts` — App setup, middleware stack, route mounting, server start
- `src/env.ts` — Zod-validated environment variables
- `src/types.ts` — `AuthContext` (userId, orgId, orgRole) and `TenantContext` (adds businessId)
- `src/db/connection.ts` — PostgreSQL pool + Drizzle instance
- `src/db/migrate.ts` — Auto-migration runner
- `src/db/schema/helpers.ts` — `tenantCols()` shared column helper
- `src/middleware/auth.ts` — Dual auth (cookie + API key) with SHA-256 token hashing
- `src/middleware/tenant.ts` — Business scoping + org ownership check
- `src/repositories/status-repo.ts` — Parallelized dashboard aggregation (Promise.all)
- `src/repositories/session-repo.ts` — Session CRUD with token hashing
- `src/repositories/org-repo.ts` — Org creation with slug collision handling

## Related

- `docs/technical/cloud-security-hardening.md` — Peer review fixes applied to this server
- `docs/flows/cloud-api.md` — User-facing guide to the cloud API
- `docs/technical/dual-mode-auth.md` — CLI-side engine auth (separate from cloud auth)
