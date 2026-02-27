# FreelancerPM -- Technical Architecture

**Prepared by:** CTO Agent
**Date:** 2026-02-14
**Status:** Draft v1 -- Ready for founder review

---

## Architecture Overview

FreelancerPM is a multi-tenant SaaS application designed to help freelancers manage projects, track time, send invoices, and share deliverables with clients. The architecture prioritizes simplicity, fast iteration speed, and low infrastructure cost at launch.

## Tech Stack

| Layer          | Technology        | Rationale                                                  |
|----------------|-------------------|------------------------------------------------------------|
| Backend API    | Node.js + Express | Large ecosystem, fast development, easy to hire for later  |
| Database       | PostgreSQL 16     | Relational integrity for invoicing data, strong JSON support for flexible fields |
| Frontend       | React 19 + Vite   | Component reuse, large community, fast dev server          |
| Styling        | Tailwind CSS      | Utility-first, no design system needed at MVP stage        |
| Auth           | Supabase Auth     | Built-in email/password + OAuth, free tier covers MVP      |
| Hosting        | Railway            | Simple deploy from Git, managed Postgres, predictable pricing |
| Payments       | Stripe             | Industry standard, excellent docs, handles SCA compliance  |
| Email          | Resend             | Developer-friendly transactional email, generous free tier |

## System Architecture

```
                        +------------------+
                        |   React Frontend |
                        |   (Vite + SPA)   |
                        +--------+---------+
                                 |
                            HTTPS/REST
                                 |
                        +--------v---------+
                        |   API Gateway    |
                        |   (Express.js)   |
                        |   - Auth middle. |
                        |   - Rate limiting|
                        |   - Validation   |
                        +--------+---------+
                                 |
              +------------------+------------------+
              |                  |                  |
     +--------v------+  +-------v-------+  +-------v-------+
     | Project Svc   |  | Invoice Svc   |  | Time Track Svc|
     | - CRUD        |  | - Generation  |  | - Start/stop  |
     | - Client mgmt |  | - PDF export  |  | - Daily totals|
     | - Status flow |  | - Stripe sync |  | - Reporting   |
     +--------+------+  +-------+-------+  +-------+-------+
              |                  |                  |
              +------------------+------------------+
                                 |
                        +--------v---------+
                        |   PostgreSQL 16  |
                        |   (Single DB)    |
                        |   - Row-level    |
                        |     security     |
                        +------------------+
```

## API Design -- Key Endpoints

All endpoints are prefixed with `/api/v1`. Auth is required unless noted.

| Method | Endpoint                     | Description                          |
|--------|------------------------------|--------------------------------------|
| POST   | `/projects`                  | Create a new project                 |
| GET    | `/projects/:id/dashboard`    | Project overview with hours + budget |
| POST   | `/time-entries`              | Start or log a time entry            |
| POST   | `/invoices/generate`         | Generate invoice from tracked time   |
| GET    | `/invoices/:id/pdf`          | Download invoice as PDF              |
| POST   | `/auth/signup`               | Register new freelancer (public)     |
| GET    | `/me/stats`                  | Dashboard stats (MRR, hours, etc.)   |

## Data Model -- Core Entities

### User (Freelancer)
The primary account holder. Stores profile info, Stripe customer ID, and subscription status. One user can have many projects and many clients.

### Project
Belongs to one user. Has a client reference, hourly rate, budget cap, and status (active / paused / archived). All time entries and invoices are scoped to a project.

### Invoice
Generated from time entries within a date range for a given project. Stores line items as a JSON column for flexibility. Linked to Stripe payment intent once sent.

## Key Tradeoff: Monolith vs. Microservices

**Option A:** Monolith (single Express app with service modules)
**Option B:** Microservices (separate deployable services per domain)

**Decision: Option A -- Monolith.** At MVP scale (targeting < 1,000 users in Year 1), microservices add deployment complexity, inter-service networking, and operational overhead with no meaningful benefit. The "services" in the diagram above are logical modules within a single codebase, not separate deployments. We can extract them later if/when scale demands it.

## Security Considerations

- **Authentication:** Supabase Auth handles token issuance. JWTs are validated on every API request via Express middleware. Refresh tokens are rotated automatically.
- **Authorization:** Row-level security (RLS) in PostgreSQL ensures users can only access their own data. API layer double-checks ownership before mutations.
- **Rate Limiting:** 100 requests/minute per user on all endpoints. Invoice PDF generation is further limited to 10/minute to prevent abuse.
- **Input Validation:** All request bodies validated with Zod schemas before reaching service logic. No raw user input touches SQL queries.
- **Secrets Management:** All credentials stored in Railway environment variables. Never committed to Git.

## Do NOT Constraints

- Do NOT use an ORM (Prisma, TypeORM). Use raw SQL with `pg` driver + parameterized queries. ORMs hide query behavior and make optimization harder later.
- Do NOT build a custom auth system. Supabase Auth is battle-tested and free at our scale.
- Do NOT add WebSocket support at MVP. Polling every 30s is sufficient for the dashboard. Real-time can come in v1.1.
- Do NOT store files locally. All uploads (profile photos, invoice attachments) go directly to S3-compatible storage via presigned URLs.
- Do NOT optimize prematurely. No caching layer, no read replicas, no CDN until traffic justifies it.

## Technical Debt -- Acknowledged

| Item                            | Severity | When to Address         |
|---------------------------------|----------|-------------------------|
| No automated test suite yet     | High     | Before public launch    |
| PDF generation is synchronous   | Medium   | When invoice volume > 100/day |
| No database migration tooling   | Medium   | Before second developer joins |
| Logging is console.log only     | Low      | Before production monitoring |
| No CI/CD pipeline               | Medium   | Before first deploy     |

These are acceptable at the "founder + AI" stage. Each item has a clear trigger for when it needs to be resolved.
