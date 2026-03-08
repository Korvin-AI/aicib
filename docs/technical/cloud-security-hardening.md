# Cloud Security Hardening

## What It Does

Documents the 13 security and code quality fixes applied to the AICIB cloud server after a three-way peer review (Claude, Codex, Cursor). These fixes address multi-tenancy collisions, plaintext token storage, information leakage, race conditions, and type safety issues.

## Summary of Fixes

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `agent_status` + `hr_onboarding` used `agentRole` as sole PK | **CRITICAL** | Composite PK `(businessId, agentRole)` |
| 2 | Session tokens stored as plaintext in DB | **High** | SHA-256 hash before storage |
| 3 | Raw session token returned in JSON response body | **High** | Removed from signup + login responses |
| 4 | `SESSION_SECRET` env var validated but never used | **High** | Removed from env schema |
| 5 | API key auth fetched arbitrary org member's role | **High** | Fixed admin role for API keys |
| 6 | `/auth/me` broken with API keys (`userId: ''`) | **Medium** | Guard returns 403; `userId` typed as `string \| null` |
| 7 | `setSessionCookie` used `c: any` | **Medium** | Typed as `Context` from Hono |
| 8 | `getStatus()` ran 7-9 sequential DB queries | **Medium** | 5 independent queries parallelized with `Promise.all` |
| 9 | Slug uniqueness had TOCTOU race condition | **Medium** | Try/catch on unique constraint instead of check-then-insert |
| 10 | Migration failure swallowed in production | **Medium** | `process.exit(1)` in production mode |
| 11 | Signup not wrapped in transaction | **Medium** | Full transaction around user + org + session creation |
| 12 | Tenant middleware leaked business existence (404 vs 403) | **Low** | Same 404 for not-found and wrong-org |
| 13 | Error handler used `status as any` | **Low** | Cast to `ContentfulStatusCode` |

## Fix Details

### 1. Composite Primary Keys (CRITICAL)

**Problem:** `agent_status` and `hr_onboarding` tables used `agentRole` as the sole primary key. Since agent roles like "ceo" or "cto" are reused across businesses, two different businesses with a CEO agent would collide — one would overwrite the other.

**Fix:** Changed both tables to composite primary keys `(business_id, agent_role)`. This means each business gets its own independent set of agent records.

**File:** `server/src/db/schema/data.ts`

```ts
// Before: single-column PK
agentRole: varchar('agent_role', { length: 100 }).primaryKey(),

// After: composite PK
agentRole: varchar('agent_role', { length: 100 }).notNull(),
// ...
(t) => [primaryKey({ columns: [t.businessId, t.agentRole] })]
```

**Migration:** `drizzle/0002_free_wallflower.sql` — drops old PK, adds composite PK for both tables.

### 2. Session Token Hashing

**Problem:** Session tokens were stored as plaintext in the `auth_sessions` table. If the database were compromised, an attacker could hijack any active session.

**Fix:** Tokens are now hashed with SHA-256 before storage. The raw token is returned exactly once (in the HttpOnly cookie) and never persisted. On subsequent requests, the cookie value is hashed before database lookup — same pattern already used for API keys.

**Files:** `session-repo.ts`, `middleware/auth.ts`

```ts
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

**Breaking change:** All existing sessions in the DB are invalidated. Acceptable at this stage (no real users in production yet).

### 3. Token Removed from JSON Responses

**Problem:** Both `/auth/signup` and `/auth/login` returned the session token in the JSON response body. This is unnecessary because the token is already delivered via HttpOnly cookie, and returning it in JSON makes it accessible to JavaScript (defeating the purpose of HttpOnly).

**Fix:** Removed `token` from both response objects. The HttpOnly cookie is the sole session delivery mechanism.

**File:** `routes/auth.ts`

### 4. SESSION_SECRET Removed

**Problem:** The env schema required a `SESSION_SECRET` variable (minimum 32 characters), but it was never used anywhere in the codebase. This confused developers and added unnecessary setup friction.

**Fix:** Removed from `env.ts` Zod schema, `.env`, and `.env.example`.

**File:** `env.ts`, `.env`, `.env.example`

### 5. API Key Role Fix

**Problem:** When authenticating with an API key, the middleware queried `orgMemberships` with just the `orgId` and grabbed the first membership it found. This returned an arbitrary user's role — potentially a `viewer` instead of an `admin`.

**Fix:** API keys are org-scoped power tokens. The middleware now sets a fixed `orgRole: 'admin'` and `userId: null` without querying memberships. The membership query was also an unnecessary DB round-trip.

**File:** `middleware/auth.ts`

### 6. /auth/me Guard for API Keys

**Problem:** With API key auth, `userId` was set to empty string `''`. The `/auth/me` endpoint then called `findUserById('')`, which returned null, and the endpoint returned a confusing "User not found" error.

**Fix:** Two changes:
1. `userId` in `AuthContext` is now typed as `string | null` (was `string`). API key auth sets it to `null`.
2. `/auth/me` checks for null userId first and returns a clear 403: "API key auth does not have a user context."

**Files:** `types.ts`, `routes/auth.ts`

### 7. setSessionCookie Type Fix

**Problem:** `setSessionCookie(c: any, ...)` — the `any` type disabled TypeScript checking for all cookie operations.

**Fix:** Changed to `setSessionCookie(c: Context, ...)` using Hono's `Context` type.

**File:** `routes/auth.ts`

### 8. Parallel Dashboard Queries

**Problem:** `getStatus()` executed 7-9 database queries sequentially. Each query waited for the previous one to complete, adding unnecessary latency (especially over network to a cloud database).

**Fix:** The 5 independent queries (agents, today's cost, month's cost, task counts, recent logs + jobs) now run in parallel via `Promise.all`. The business + session queries remain sequential because session lookup depends on the business query result.

**Before:** ~7-9 sequential round trips.
**After:** 2 sequential (business + session) + 1 parallel batch of 6 = ~3 round trips.

**File:** `repositories/status-repo.ts`

### 9. Slug Race Condition Fix

**Problem:** `createOrgForUser` checked if a slug existed, then inserted. Between the check and the insert, another request could create the same slug (TOCTOU — Time of Check to Time of Use).

**Fix:** Replaced check-then-insert with try/catch around the insert. If the insert fails with PostgreSQL error code `23505` (unique violation), a timestamp suffix is appended and the insert is retried.

**File:** `repositories/org-repo.ts`

```ts
try {
  org = await createOrganization(orgName, slug);
} catch (err: any) {
  if (err?.code === '23505') {
    slug = `${slug}-${Date.now().toString(36)}`;
    org = await createOrganization(orgName, slug);
  } else {
    throw err;
  }
}
```

### 10. Fatal Migration in Production

**Problem:** If database migrations failed, the server logged a warning and started anyway. In production, this means the server runs against a potentially inconsistent database schema.

**Fix:** In production mode, migration failure now calls `process.exit(1)`. In development, the warning behavior is preserved for debugging convenience.

**File:** `index.ts`

### 11. Transactional Signup

**Problem:** Signup created a user, then an org, then a session in separate database operations. If any step failed partway through, the database could end up with orphaned records (e.g., a user with no org).

**Fix:** All signup operations (check existing email, create user, create org with slug collision handling, add membership, create session) are wrapped in a single `db.transaction()`. If any step fails, everything rolls back.

**File:** `routes/auth.ts`

### 12. Tenant Middleware Normalization

**Problem:** The tenant middleware returned different errors for "business doesn't exist" (404) vs "business belongs to a different org" (403). This difference lets an attacker enumerate valid business IDs — if they get a 403, they know the business exists.

**Fix:** Both cases now return the same 404: "Business not found."

**File:** `middleware/tenant.ts`

```ts
// Before: separate responses
if (!business) return c.json({ error: 'Business not found' }, 404);
if (business.orgId !== auth.orgId) return c.json({ error: 'Access denied' }, 403);

// After: unified response
if (!business || business.orgId !== auth.orgId) {
  return c.json({ error: 'Business not found' }, 404);
}
```

### 13. Error Handler Type Fix

**Problem:** The error handler passed `status as any` to `c.json()`, disabling Hono's status code type checking.

**Fix:** Cast to `ContentfulStatusCode` (Hono's specific status code union type).

**File:** `middleware/error-handler.ts`

## Deferred Issues

These were identified in the peer reviews but intentionally deferred:

| Issue | Reason | Target |
|-------|--------|--------|
| Rate limiting on auth endpoints | Needs dependency or custom implementation | Own PR |
| Multi-org user handling | AICIB is single-org per user for now | Phase 5B+ |
| DB indexes on FK columns | Performance optimization; do when needed | Phase 5B |
| API key `lastUsedAt` throttling | Premature optimization | Phase 5B |
| Migrations as separate deploy step | Architecture change | Phase 5B |
| CORS multi-origin | Not needed yet | Phase 5B |
| `cleanExpiredSessions()` never called | Minor; add cron job | Phase 5B |
| Migration path relative to CWD | Only matters if start dir changes | Phase 5B |

## Files Modified

| File | Changes |
|------|---------|
| `server/src/db/schema/data.ts` | Composite PKs for `agent_status` + `hr_onboarding` |
| `server/src/repositories/session-repo.ts` | Token hashing with SHA-256 |
| `server/src/middleware/auth.ts` | Hash session cookie for lookup, fixed API key role/userId |
| `server/src/routes/auth.ts` | Removed token from JSON, typed `setSessionCookie`, `/auth/me` guard, transactional signup |
| `server/src/env.ts` | Removed `SESSION_SECRET` |
| `server/src/types.ts` | `userId: string \| null` |
| `server/src/repositories/status-repo.ts` | `Promise.all` for parallel queries |
| `server/src/repositories/org-repo.ts` | Try/catch on unique constraint |
| `server/src/index.ts` | Fatal migration failure in production |
| `server/src/middleware/tenant.ts` | Unified 404 for not-found + wrong-org |
| `server/src/middleware/error-handler.ts` | `ContentfulStatusCode` cast |
| `server/.env` + `.env.example` | Removed `SESSION_SECRET` |
| `server/drizzle/0002_free_wallflower.sql` | PK migration |

## Related

- `docs/technical/cloud-server.md` — Full server architecture
- `docs/flows/cloud-api.md` — User-facing API guide
