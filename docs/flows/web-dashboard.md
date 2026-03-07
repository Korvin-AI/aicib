# Web Dashboard

## Overview

A visual web dashboard for your AI company. Opens in your browser at `localhost:3000` and shows agents, costs, tasks, and activity at a glance — like a company control room.

## Prerequisites

No terminal setup required. When you launch the dashboard on a fresh project, a setup wizard walks you through everything in the browser.

If you prefer the terminal, you can still use `aicib init` + `aicib start` first — the dashboard will skip the wizard and go straight to the home page.

## Launching the Dashboard

From your project directory (where `aicib.config.yaml` lives):

```
aicib ui
```

This:
- Starts a local web server on port 3000
- Opens your browser automatically after 2 seconds
- Installs UI dependencies on first run (one-time, takes ~20 seconds)

Options:
- `aicib ui --port 8080` — use a different port
- `aicib ui --dir /path/to/project` — point to a different project folder

Press Ctrl+C to stop the dashboard.

## First-Run Setup Wizard

If no `aicib.config.yaml` exists in the project directory, the dashboard automatically redirects you to `/setup` — a 4-step wizard:

### Step 1 — Company Info
- Type your company name (2-100 characters)
- Pick a template (currently "SaaS Startup" — more coming later)
- Choose a personality style: Professional, Startup, Technical, or Creative — this changes how your AI agents write and communicate

### Step 2 — Team Builder
- See all the AI agents that will be created (CEO, CTO, CFO, CMO, and their team members)
- For each agent, pick the AI model using the dropdown — the price is shown right next to it so you always know the cost:
  - **Haiku** — cheapest, good for simple tasks ($0.25/MTok)
  - **Sonnet** — balanced, good for most work ($3/MTok)
  - **Opus** — most powerful, best for complex decisions ($15/MTok)

### Step 3 — Budget
- Set daily cost limit (how much you want to spend per day)
- Set monthly cost limit (overall spending cap)
- The wizard shows estimated costs based on your model choices

### Step 4 — Review & Launch
- See a summary of everything you configured
- Click "Create & Launch" to:
  1. Create your project config file
  2. Set up the database and agent definitions
  3. Start your AI team in the background
  4. Open the dashboard

A progress bar shows each step. If anything goes wrong, you'll see an error message with details — you can fix the issue and retry.

## What You See

### Layout

- **Left sidebar** — 10 navigation items: Home, Tasks, Costs, Activity, Team, HR, Wiki, Journal, Projects, Settings
- **Top bar** — Page title + live connection indicator (green dot = connected, red = disconnected)
- **Main content** — Changes based on which sidebar item you select
- **Bottom bar** — Brief input field (on every page) to send directives to the CEO

### Home Dashboard (/)

Four sections:

1. **KPI Cards** — 4 metric cards across the top:
   - Active Agents (count of agents with working/idle status)
   - Active Tasks (in_progress + in_review count)
   - Today's Cost (color-coded: green under 50% of daily limit, yellow 50-80%, red over 80%)
   - Session Status (Active/Inactive badge)

2. **Agent Grid** — One card per configured agent showing:
   - Role name (color-coded: CEO=purple, CTO=blue, CFO=green, CMO=amber)
   - Model badge (sonnet, opus, haiku)
   - Status dot (green=idle, yellow=working, red=error, gray=stopped)
   - Current task text when working

3. **Activity Feed** — Last 20 log entries from background jobs, showing agent name, timestamp, and content. Updates live via SSE.

4. **Quick Actions** — 4 link cards to Tasks, Costs, Activity, and Settings pages.

### Sending a Brief

The bottom bar lets you type a directive and send it to the CEO:
1. Type your directive in the text field
2. Click Send (or press Enter)
3. The brief runs in the background (same as `aicib brief -b`)

Errors shown inline:
- "No active session" — run `aicib start` first
- "A brief is already running" — wait for the current one to finish

### Live Updates

The dashboard updates automatically every 2 seconds via Server-Sent Events (SSE):
- Agent status changes (idle → working → idle)
- Cost updates (today's total refreshes)
- New log entries (activity feed appends new messages)
- Task changes (KPI card count updates)

The green/red dot in the top bar shows SSE connection status. If it goes red, the browser auto-reconnects after 3 seconds.

## What Can Go Wrong

- **Setup wizard: "Initialization did not create a config file"** — The CLI ran but didn't produce a config. Try running `aicib init` from the terminal to see the full error output.
- **Setup wizard: "Invalid template" or "Invalid persona"** — The wizard only accepts known values. If you see this, refresh the page and try again.
- **Dashboard "Start Company" button fails** — An error message appears below the button. Common causes: the session is already running, or the CLI isn't installed properly.
- **Port already in use** — Another app is on port 3000. Use `aicib ui --port 3001`.
- **Dashboard shows everything as stopped/inactive** — Either click "Start Company" on the dashboard, or run `aicib start` in another terminal.
- **SSE disconnects frequently** — Normal if the database is locked during heavy agent work. Reconnects automatically.

## Deleting a Business

You can remove a business from the dropdown in the sidebar.

### How It Works

1. Click the business switcher dropdown (top-left of sidebar)
2. Click the trash icon next to the business you want to remove
3. A confirmation dialog appears showing the business name and folder path
4. Choose one of two options:
   - **"Remove from List"** (default) — removes the business from your list only. The project folder stays on disk. You can re-import it later via "Import Existing Business."
   - **"Delete Everything"** — check the "Also delete the project folder and all data" checkbox first. This permanently deletes the folder and all files inside it. A red warning reminds you this can't be undone.
5. The page reloads automatically after deletion

### What Happens in Each Scenario

- **Deleting a business that's not currently active** — it disappears from the list, everything else stays the same
- **Deleting the currently active business** — the system auto-selects the next business in your list
- **Deleting the last remaining business** — the page redirects to the setup wizard so you can create a new one
- **Business has a running session** — the session is automatically stopped before deletion

### Safety Precautions (folder deletion)

When you check "Also delete the project folder," three safety checks run before anything is deleted:

1. The folder must contain an `aicib.config.yaml` file (proof it's an AICIB project)
2. The path must be at least 2 levels deep (blocks deleting `/` or `/tmp`)
3. The path cannot be your home directory

If any check fails, the delete is refused and the folder is untouched.

## CLI and Dashboard Together

The terminal and dashboard are two views into the same data:
- Run `aicib start` in terminal 1
- Run `aicib ui` in terminal 2
- Send briefs from either the terminal (`aicib brief`) or the dashboard's bottom bar
- Changes from one appear in the other (the dashboard via SSE, the terminal via CLI commands)
