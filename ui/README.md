# AICIB Web Dashboard

The visual interface for AI Company-in-a-Box. Provides a real-time dashboard to monitor your AI company's agents, costs, tasks, and activity.

## Quick Start

From the root `aicib` directory:

```bash
aicib ui
```

This launches the dashboard at [http://localhost:3000](http://localhost:3000).

## What You'll See

- **KPI cards** — company health metrics at a glance
- **Agent grid** — status of every AI agent (CEO, CTO, CFO, CMO, etc.)
- **Activity feed** — live stream of agent actions and decisions
- **Brief bar** — submit briefs to your AI company directly from the browser
- **Setup wizard** — guided 4-step flow for creating a new AI company

## Tech Stack

- **Next.js 16** with Turbopack
- **shadcn/ui** component library
- **Tailwind CSS v4**
- **better-sqlite3** — reads the same `.aicib/state.db` database as the CLI
- **Server-Sent Events** for live updates

## Architecture

The dashboard reads directly from the SQLite database that the CLI writes to. There is no separate API server — the Next.js app uses server components and API routes that query the database file on disk.

## Development

```bash
cd ui
npm install
npm run dev
```

The dev server runs on port 3000 with hot reload.
