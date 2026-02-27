<p align="center">
  <h1 align="center">aicib — AI Company-in-a-Box</h1>
  <p align="center">
    Spawn a full AI company with one command. CEO, CTO, CFO, CMO — all coordinating autonomously.
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> · <a href="#how-it-works">How It Works</a> · <a href="#web-dashboard">Web Dashboard</a> · <a href="#commands">Commands</a> · <a href="#try-these-briefs">Try These Briefs</a>
  </p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="AGPL-3.0 License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js 18+"></a>
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built%20with-Claude%20Code-blueviolet.svg" alt="Claude Code"></a>
</p>

---

> *"I got a CTO, CMO, and CFO for $1.23."*

AICIB lets you run an entire AI-powered company from your terminal. Give a business brief to the CEO, and it delegates work across departments — CTO builds architecture, CMO writes the go-to-market plan, CFO models the financials — just like a real company would.

No API key needed. Uses your existing Claude Code subscription.

## Quick Start

```bash
npx aicib init --name "MyStartup"
aicib start
aicib brief "Build an MVP landing page for our product. Target: early adopters. Budget: $500/mo."
```

**What you'll see:**

```
  ✔ Project initialized!

  Your AI Company:

    👤 You (Human Founder)
     └── 🏢 CEO (Team Lead)
           ├── CTO ── Backend Engineer, Frontend Engineer
           ├── CFO ── Financial Analyst
           └── CMO ── Content Writer

  🚀 Try your first brief:

    aicib start
    aicib brief "Build a landing page for MyStartup. Target: early adopters. MVP scope. Budget: $500/mo."
```

The CEO receives your brief, breaks it into department-level objectives, and delegates. Minutes later you have an architecture document, a marketing plan, and a financial projection — all in your project folder.

---

## How It Works

### The Delegation Flow

```
You give a BRIEF  →  CEO decomposes  →  C-suite delegates  →  Workers produce  →  CEO reports back
```

Every brief follows this cycle. You talk to the CEO. The CEO never writes code or documents — it delegates everything to department heads, who delegate to their specialists.

### The Org Chart

```
You (Human Founder)
  └── CEO (Team Lead) .......... orchestrates, delegates, reports back to you
        ├── CTO ................. architecture, tech decisions, code quality
        │     ├── Backend Engineer ... APIs, databases, server logic
        │     └── Frontend Engineer .. UI components, pages, client logic
        ├── CFO ................. financial models, pricing, unit economics
        │     └── Financial Analyst .. spreadsheets, projections, market sizing
        └── CMO ................. positioning, content strategy, launch plans
              └── Content Writer ..... blog posts, landing pages, email copy
```

Each agent has a **soul.md** personality file that defines how they think, what they're good at, and how they communicate. The CTO always lists rejected alternatives before stating a choice. The CFO always includes "napkin math." The CMO always leads with a headline.

### What Makes This Different

This isn't a chatbot. It's a **company simulation**. Agents have:

- **Distinct personalities** — the CTO sounds different from the CMO
- **Decision authority** — each agent knows what they can decide alone vs. what needs escalation
- **Communication protocols** — formal reporting chains, cross-department handoffs
- **Behavioral quirks** — the CEO rates confidence 1-5, the CFO ends every analysis with "Bottom Line:"
- **Trust evolution** — agents earn more autonomy over time based on performance
- **Knowledge memory** — decisions, wiki entries, and archives persist across sessions

---

## Features

### Core Engine
- **Hierarchical delegation** — CEO delegates to C-suite, C-suite delegates to workers
- **Background mode** — send briefs and keep working while agents run (`aicib brief --background`)
- **Per-agent cost tracking** — know exactly what each agent costs per session
- **Multi-model support** — assign different Claude models to different roles (Opus for executives, Sonnet for workers)
- **Escalation chains** — agents escalate decisions they can't make alone

### Agent Intelligence
- **Agent Persona Studio** — customize names, backgrounds, personality traits, communication style
- **Role presets** — archetypes like "The Visionary CEO" or "The Architect CTO"
- **Trust evolution** — agents earn more autonomy based on track record
- **Performance reviews** — automated and manual review cycles

### Industry Templates
- **SaaS Startup** — CEO, CTO, CFO, CMO with specialized workers
- **Consulting Firm** — Managing Partner, Practice Leads, Consultants, Analysts
- **E-commerce** — Operations-focused with supply chain and customer support
- **Marketing Agency** — Creative Director, Account Managers, Copywriters, Designers
- **Structure presets** — Full C-suite, lean startup, or minimal configurations

### Task & Project Management
- **Task system** — create, assign, track, and review tasks across the org
- **Project planner** — multi-phase project tracking with status and milestones
- **Safeguards** — pending actions require human approval before execution

### Knowledge Management
- **Company wiki** — shared knowledge base that agents reference
- **Decision log** — every major decision recorded with reasoning
- **Session journals** — CEO journals summarizing each work session
- **Archives** — searchable history of all past work

### Communication & Scheduling
- **Slack integration** — connect your AI company to Slack channels
- **Agent scheduler** — cron-based scheduling for recurring agent work
- **Company events** — standups, all-hands, retrospectives
- **Notification system** — configurable alerts and preferences
- **Communication routing** — control how departments talk to each other

### HR System
- **Onboarding** — structured agent onboarding flow
- **Career progression** — advance, promote, or demote agents
- **Performance improvement** — identify and address underperformance
- **Auto-reviews** — scheduled automated performance evaluations

### Web Dashboard
- **Real-time dashboard** — live agent status, KPIs, activity feed via SSE
- **Setup wizard** — 4-step guided setup (company, team, budget, launch)
- **10 dashboard pages** — agents, tasks, projects, costs, HR, knowledge, journal, activity, settings
- **Communication hub** — threaded channels, context panels, message composer
- **Multi-business support** — manage multiple AI companies from one dashboard

### Integrations
- **MCP tool integrations** — extend agents with external tools
- **Data export/import** — backup and restore company state
- **Reporting engine** — generate and schedule structured reports

---

## Web Dashboard

Launch the web UI with:

```bash
aicib ui
```

Opens a local dashboard at `http://localhost:3000` with live agent status, cost tracking, org chart visualization, and a brief submission bar. The dashboard reads from the same local database as the CLI — no separate server needed.

Built with Next.js 16, shadcn/ui, and Tailwind CSS v4.

---

## Commands

### Core

| Command | Description |
|---------|-------------|
| `aicib init --name "Name"` | Scaffold a new AI company with org chart and guided setup |
| `aicib start` | Boot all agents |
| `aicib brief "..."` | Send a directive to the CEO — triggers full delegation chain |
| `aicib brief --background "..."` | Send a brief and return immediately — team works in background |
| `aicib status` | Show all agents: what they're doing, what it's cost so far |
| `aicib stop` | Gracefully shut down all agents |
| `aicib cost` | Detailed cost breakdown per agent, per session |
| `aicib logs` | View full conversation logs from background runs |
| `aicib ui` | Launch the web dashboard |
| `aicib config` | Interactive configuration editor |

### Agents & Team

| Command | Description |
|---------|-------------|
| `aicib add-agent` | Add a new agent to a department |
| `aicib remove-agent <role>` | Remove an agent from the team |
| `aicib agent list` | List all agents and their status |
| `aicib agent show <role>` | View full persona detail for an agent |
| `aicib agent customize [role]` | Interactive wizard to customize agent persona |
| `aicib agent edit <role>` | Open agent soul.md in your editor |

### Tasks & Projects

| Command | Description |
|---------|-------------|
| `aicib tasks list` | View all tasks across the org |
| `aicib tasks create` | Create a new task |
| `aicib tasks show <id>` | View task details |
| `aicib tasks update <id>` | Update task status or assignment |
| `aicib project list` | List all projects |
| `aicib project status <id>` | View project progress |

### Knowledge & History

| Command | Description |
|---------|-------------|
| `aicib knowledge wiki` | Browse the company knowledge base |
| `aicib knowledge decisions` | View the decision log |
| `aicib knowledge search <query>` | Search across all knowledge |
| `aicib journal` | View CEO session journals |

### HR & Performance

| Command | Description |
|---------|-------------|
| `aicib hr list` | View all agents and their HR status |
| `aicib hr onboard <role>` | Onboard a new agent |
| `aicib hr review <role>` | Run a performance review |
| `aicib hr promote <role>` | Promote an agent |
| `aicib trust history` | View trust evolution over time |
| `aicib reviews` | View review chain configuration |

### Scheduling & Events

| Command | Description |
|---------|-------------|
| `aicib schedule list` | View all scheduled jobs |
| `aicib schedule create` | Create a recurring schedule |
| `aicib schedule start` | Start the scheduler daemon |
| `aicib events list` | View company events (standups, all-hands) |
| `aicib events create` | Schedule a new event |

### Integrations & Admin

| Command | Description |
|---------|-------------|
| `aicib slack connect` | Connect to Slack workspace |
| `aicib slack status` | Check Slack connection |
| `aicib integrations list` | View all MCP integrations |
| `aicib template list` | Browse available company templates |
| `aicib report generate` | Generate a structured report |
| `aicib notifications list` | View notifications |
| `aicib safeguards pending` | View actions awaiting human approval |
| `aicib export` | Export company data |
| `aicib routing` | View communication routing policy |

---

## What It Costs

AICIB uses your Claude Code subscription. No separate API key needed. Here's what to expect per brief:

| Brief Type | Departments Active | Estimated Cost | Time |
|------------|-------------------|----------------|------|
| Quick analysis | 1-2 departments | $0.50 - $1.00 | 2-3 min |
| Strategy session | 3-4 departments | $1.00 - $2.00 | 5-8 min |
| Full company brief | All departments | $2.00 - $3.00 | 8-15 min |

Set spending limits in your config:

```yaml
settings:
  cost_limit_daily: 50     # Won't exceed $50/day
  cost_limit_monthly: 500  # Won't exceed $500/month
```

---

## Why AICIB?

| Feature | Raw Claude | CrewAI | MetaGPT | ChatDev | **AICIB** |
|---------|-----------|--------|---------|---------|-----------|
| Company structure | -- | Flat teams | Waterfall | Roles | **Hierarchical org chart** |
| Agent personalities | -- | Basic roles | Roles | Roles | **Deep soul.md with quirks** |
| Cost tracking | -- | -- | -- | -- | **Per-agent, per-session** |
| Background mode | -- | -- | -- | -- | **Built-in** |
| Delegation chain | -- | Sequential | Sequential | Chat | **CEO → C-suite → Workers** |
| Web dashboard | -- | -- | -- | -- | **Real-time UI** |
| Slack integration | -- | -- | -- | -- | **Native** |
| Task management | -- | -- | -- | -- | **Full system** |
| Agent scheduling | -- | -- | -- | -- | **Cron-based** |
| HR & reviews | -- | -- | -- | -- | **Built-in** |
| Knowledge base | -- | -- | -- | -- | **Persistent** |
| Setup time | -- | ~30 min | ~20 min | ~15 min | **One command** |
| Auth required | API key | API key | API key | API key | **Claude Code subscription** |

---

## Configuration

Edit `aicib.config.yaml` in your project root:

```yaml
company:
  name: "MyStartup"
  template: "saas-startup"

agents:
  ceo:
    enabled: true
    model: opus
  cto:
    enabled: true
    model: opus
    workers:
      - backend-engineer:
          model: sonnet
      - frontend-engineer:
          model: sonnet
  cfo:
    enabled: true
    model: sonnet
    workers:
      - financial-analyst:
          model: sonnet
  cmo:
    enabled: true
    model: sonnet
    workers:
      - content-writer:
          model: sonnet

settings:
  cost_limit_daily: 50
  cost_limit_monthly: 500
  escalation_threshold: high
  auto_start_workers: true
```

### Customizing Agent Personalities

Each agent's behavior is defined in a soul.md file. You can edit these directly or use the **Agent Persona Studio**:

```bash
aicib agent customize ceo
```

The studio lets you set:
- **Display names** — give agents human names (e.g., "Sarah" for CEO)
- **Role presets** — pick personality archetypes (e.g., "The Visionary", "The Operator")
- **Personality traits** — communication style, risk tolerance, assertiveness, creativity
- **Professional background** — years of experience, industry expertise, work history

---

## Try These Briefs

Copy-paste these into `aicib brief "..."` to see what your AI company can do:

### The Showstopper (all departments, ~$2-3)

```bash
aicib brief "Build a project management SaaS for freelancers called FreelancerPM. Target: solo consultants making $75K-$200K. I want a technical architecture, a go-to-market strategy with Product Hunt launch plan, and a 12-month financial projection. MVP timeline: 2 weeks. Monthly budget: $500."
```

### The Strategy Session (coordinated, ~$1.50-2)

```bash
aicib brief "Plan a Product Hunt launch for our developer tool. CTO: list the 3 most impressive technical features to demo. CMO: write the PH tagline, first comment, and maker story. CFO: estimate launch costs and expected signups."
```

### The Quick Win (fast, ~$0.50-1)

```bash
aicib brief "Analyze our pricing. We're considering $19/mo, $29/mo, or $49/mo for a B2B SaaS tool targeting freelancers. Recommend a price with unit economics to back it up."
```

---

## Project Structure

```
aicib/
├── src/
│   ├── cli/              # 30 command handlers
│   ├── core/             # 52 engine modules (agent runner, config, cost, scheduling, HR, etc.)
│   ├── integrations/     # Slack integration (8 modules)
│   └── templates/        # 4 industry templates with agent soul.md files
├── ui/                   # Next.js 16 web dashboard
│   ├── app/              # Pages, API routes, layouts
│   ├── components/       # React components (shadcn/ui)
│   └── lib/              # Database, config, utilities
├── docs/
│   ├── technical/        # Architecture docs
│   └── flows/            # User-facing workflow guides
├── demo/                 # Demo scripts and briefs
└── tests/                # End-to-end test suites
```

---

## Requirements

- **Node.js** 18 or later
- **npm** 9 or later
- **Claude Code** subscription (for running agents — no separate API key needed)

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

By contributing, you agree to the [Contributor License Agreement](CLA.md).

---

## License

AICIB is dual-licensed:

- **Open Source** — [AGPL-3.0](LICENSE) for personal use, self-hosting, and open-source projects
- **Commercial** — available for organizations that need proprietary terms

See [LICENSING.md](LICENSING.md) for full details and FAQ.

---

## Built With

- [Claude Code](https://claude.com/claude-code) — Agent Teams & Subagents
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) — Session management & tool orchestration
- [Next.js](https://nextjs.org/) — Web dashboard framework
- [shadcn/ui](https://ui.shadcn.com/) — UI component library
- TypeScript + Commander.js — CLI framework
- SQLite (better-sqlite3) — State persistence
- Slack Bolt — Slack integration

---

## Security

If you discover a security vulnerability, please report it responsibly by emailing security@korvin.tech. Do not open a public issue for security vulnerabilities.

---

<p align="center">
  <strong>One command. An entire AI company. Open source.</strong>
</p>
