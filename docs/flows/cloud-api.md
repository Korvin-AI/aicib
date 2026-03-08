# Cloud API

## Overview

The AICIB cloud API lets you access your AI company from anywhere — a web browser, mobile app, or any tool that can make HTTP requests. Instead of running the CLI on your computer, the cloud server keeps everything running online and you connect to it.

Think of it like the difference between a desktop app and a web app: the CLI is the desktop app, and the cloud API is the web app.

## Getting Started

### Prerequisites

You need a running AICIB cloud server. In development, this means:

1. PostgreSQL running locally
2. Server configured with a `.env` file (copy from `.env.example`)
3. Server started with `npm run dev` (from the `aicib/server` directory)

In production, the server runs on Railway with a managed PostgreSQL database.

### Creating an Account

Send a signup request to create your user account, organization, and first session:

```
POST /auth/signup
Content-Type: application/json

{
  "email": "you@example.com",
  "password": "your-secure-password",
  "displayName": "Your Name"
}
```

Response:
```json
{
  "user": { "id": "...", "email": "you@example.com", "displayName": "Your Name" },
  "org": { "id": "...", "name": "Your Name's Org", "slug": "your-names-org", "plan": "free" }
}
```

The server sets an `aicib_session` cookie automatically. Your browser will include this cookie on all subsequent requests — no need to manage tokens manually.

### Logging In

If you already have an account:

```
POST /auth/login
Content-Type: application/json

{
  "email": "you@example.com",
  "password": "your-password"
}
```

Same response format as signup. A new session cookie is set.

### Logging Out

```
POST /auth/logout
```

Clears your session cookie and invalidates the session on the server.

### Checking Your Account

```
GET /auth/me
```

Returns your user info, organization, and list of businesses. This is useful for checking if you're logged in and getting IDs you need for other API calls.

Response:
```json
{
  "user": { "id": "...", "email": "...", "displayName": "..." },
  "org": { "id": "...", "name": "...", "slug": "...", "plan": "free" },
  "businesses": [
    { "id": "abc-123", "name": "My AI Startup", "template": "saas-startup" }
  ]
}
```

## Using the Business API

All business data is scoped under a business ID. You get business IDs from the `/auth/me` response.

### Dashboard Status

Get a full snapshot of your AI company — agents, costs, tasks, recent activity:

```
GET /businesses/{businessId}/status
```

Response includes:
- **Company info** — name, template
- **Session** — whether an AI session is active
- **Agents** — role, model, status (working/idle/stopped), current task
- **Costs** — today's spend, this month's spend, budget limits
- **Tasks** — counts by status (backlog, todo, in_progress, done, etc.)
- **Recent logs** — latest 20 background activity messages
- **Recent jobs** — latest 5 background job summaries

### Agent Details

Get detailed info about a specific agent:

```
GET /businesses/{businessId}/agents/{role}
```

Where `{role}` is the agent's role name, like `ceo`, `cto`, `cfo`, `cmo`, or any custom agent role.

### Cost History

View cost entries with pagination:

```
GET /businesses/{businessId}/costs?page=1&pageSize=50
```

### Task List

View tasks with optional filters:

```
GET /businesses/{businessId}/tasks?status=in_progress&assignee=cto&page=1&pageSize=50
```

Available filters:
- `status` — `backlog`, `todo`, `in_progress`, `in_review`, `done`, `cancelled`, or `all`
- `priority` — `low`, `medium`, `high`, `critical`, or `all`
- `assignee` — agent role name, or `all`
- `department` — department name, or `all`
- `project` — project name, or `all`

### Journal

Read CEO journal entries, agent journals, and decision logs:

```
GET /businesses/{businessId}/journal?tab=ceo&limit=50
```

Tabs:
- `ceo` — CEO's session summaries
- `agents` — Individual agent journal entries (filter with `agent=cto`)
- `decisions` — Decision log entries

### Health Check

Check if the server is running and the database is connected:

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "db": true,
  "uptime": 3600
}
```

## API Keys (Programmatic Access)

For scripts, CI/CD, or integrations, you can use API keys instead of session cookies.

Send the key in the `Authorization` header:

```
Authorization: Bearer aicib_your-api-key-here
```

API key differences from session auth:
- API keys are scoped to your organization, not a specific user
- They always have `admin` access level
- The `/auth/me` endpoint returns 403 (no user context)
- API keys can have optional expiration dates

## Pagination

Endpoints that return lists support pagination:

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `page` | 1 | — | Page number (1-based) |
| `pageSize` | 50 | 200 | Items per page |

## Error Responses

All errors follow the same format:

```json
{
  "error": "Description of what went wrong"
}
```

Common status codes:
- `400` — Bad request (missing or invalid parameters)
- `401` — Not logged in or invalid credentials
- `403` — Not allowed (e.g., API key used on user-only endpoint)
- `404` — Resource not found (or you don't have access to it)
- `409` — Conflict (e.g., email already registered)
- `500` — Server error

## Security Notes

- Session tokens are stored as SHA-256 hashes in the database — even if the database is compromised, tokens can't be reused
- Passwords are hashed with Argon2 (a memory-hard algorithm resistant to GPU attacks)
- Session cookies are HttpOnly (JavaScript can't read them) and Secure in production (HTTPS only)
- Business access is always verified — you can only see businesses that belong to your organization
- Error messages don't leak information about other users' data

## Related

- `docs/technical/cloud-server.md` — Server architecture and code structure
- `docs/technical/cloud-security-hardening.md` — Security fixes applied in Phase 5A
