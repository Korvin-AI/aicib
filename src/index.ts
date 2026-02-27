#!/usr/bin/env node

// Side-effect imports: register config extensions + database tables
// before any config loading or CostTracker construction.
import "./integrations/slack/register.js";
import "./core/task-register.js";
import "./core/intelligence-register.js";
import "./core/knowledge-register.js";
import "./core/hr-register.js";
import "./core/project-register.js";
import "./core/routing-register.js";
import "./core/review-chains-register.js";
import "./core/mcp-register.js";
import "./core/safeguards-register.js";
import "./core/scheduler-register.js";
import "./core/reporting-register.js";
import "./core/perf-review-register.js";
import "./core/notifications-register.js";
import "./core/events-register.js";

import { Command } from "commander";
import { initCommand } from "./cli/init.js";
import { startCommand } from "./cli/start.js";
import { briefCommand } from "./cli/brief.js";
import { statusCommand } from "./cli/status.js";
import { stopCommand } from "./cli/stop.js";
import { costCommand } from "./cli/cost.js";
import { logsCommand } from "./cli/logs.js";
import { addAgentCommand } from "./cli/add-agent.js";
import { removeAgentCommand } from "./cli/remove-agent.js";
import { configCommand } from "./cli/config.js";
import { journalCommand } from "./cli/journal.js";
import { slackConnectCommand, slackDisconnectCommand, slackStatusCommand } from "./cli/slack.js";
import {
  tasksCommand,
  tasksListCommand,
  tasksCreateCommand,
  tasksShowCommand,
  tasksUpdateCommand,
  tasksReviewCommand,
} from "./cli/tasks.js";
import {
  knowledgeCommand,
  knowledgeWikiCommand,
  knowledgeWikiShowCommand,
  knowledgeWikiCreateCommand,
  knowledgeWikiHistoryCommand,
  knowledgeDecisionsCommand,
  knowledgeDecisionsShowCommand,
  knowledgeJournalsCommand,
  knowledgeArchivesCommand,
  knowledgeArchivesShowCommand,
  knowledgeSearchCommand,
} from "./cli/knowledge.js";
import {
  hrCommand,
  hrListCommand,
  hrOnboardCommand,
  hrAdvanceCommand,
  hrReviewCommand,
  hrReviewsCommand,
  hrPromoteCommand,
  hrDemoteCommand,
  hrImproveCommand,
  hrStateCommand,
  hrHistoryCommand,
  hrAutoReviewsCommand,
} from "./cli/hr.js";
import {
  projectStatusCommand,
  projectListCommand,
  projectCancelCommand,
} from "./cli/project.js";
import { uiCommand } from "./cli/ui-launcher.js";
import {
  agentDashboardCommand,
  agentListCommand,
  agentShowCommand,
  agentEditCommand,
  agentCustomizeCommand,
} from "./cli/agent.js";
import {
  templateListCommand,
  templateInfoCommand,
  templateImportCommand,
  templateExportCommand,
} from "./cli/template.js";
import { routingCommand } from "./cli/routing.js";
import { reviewsCommand } from "./cli/reviews.js";
import {
  integrationsListCommand,
  integrationsAddCommand,
  integrationsRemoveCommand,
  integrationsStatusCommand,
} from "./cli/integrations.js";
import {
  safeguardsCommand,
  safeguardsPendingCommand,
  safeguardsApproveCommand,
  safeguardsRejectCommand,
  safeguardsHistoryCommand,
} from "./cli/safeguards.js";
import {
  trustCommand,
  trustHistoryCommand,
  trustRecommendationsCommand,
  trustSetCommand,
} from "./cli/trust.js";
import {
  reportDashboardCommand,
  reportGenerateCommand,
  reportListCommand,
  reportShowCommand,
  reportTemplatesCommand,
  reportScheduleCommand,
} from "./cli/report.js";
import {
  scheduleDashboardCommand,
  scheduleListCommand,
  scheduleCreateCommand,
  scheduleShowCommand,
  scheduleDeleteCommand,
  scheduleEnableCommand,
  scheduleDisableCommand,
  scheduleHistoryCommand,
  scheduleStartCommand,
  scheduleStopCommand,
  scheduleStatusCommand,
} from "./cli/schedule.js";
import { exportCommand, importCommand } from "./cli/data-export.js";
import {
  notificationsCommand,
  notificationsListCommand,
  notificationsShowCommand,
  notificationsDismissCommand,
  notificationsPreferencesCommand,
  notificationsPreferencesSetCommand,
  notificationsSendCommand,
} from "./cli/notifications.js";
import {
  eventsCommand,
  eventsListCommand,
  eventsCreateCommand,
  eventsShowCommand,
  eventsDeleteCommand,
  eventsEnableCommand,
  eventsDisableCommand,
  eventsMinutesCommand,
  eventsSetupCommand,
  eventsHistoryCommand,
} from "./cli/events.js";

const program = new Command();

program
  .name("aicib")
  .description(
    "AI Company-in-a-Box — spawn a hierarchical team of AI agents structured like a real company"
  )
  .version("0.1.0");

program
  .command("init")
  .description("Scaffold a new AI company")
  .option("-t, --template <template>", "Legacy template alias (e.g., saas-startup)")
  .option("-s, --structure <name>", "Org shape: minimal, lean-startup, full-c-suite, custom")
  .option("-i, --industry <name>", "Domain: saas-startup, marketing-agency, e-commerce, consulting-firm")
  .option("-n, --name <name>", "Company name", "MyStartup")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .option("--persona <preset>", "Personality preset (skip interactive prompt)")
  .action(initCommand);

program
  .command("start")
  .description("Start all agents")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(startCommand);

program
  .command("brief <directive>")
  .description("Send a directive to the CEO")
  .option("-b, --background", "Run in background (returns immediately)")
  .option("-p, --project", "Run as multi-phase autonomous project")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(briefCommand);

program
  .command("status")
  .description("Show all agent statuses")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(statusCommand);

program
  .command("stop")
  .description("Gracefully stop all agents")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(stopCommand);

program
  .command("cost")
  .description("Show cost breakdown per agent")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .option("-s, --session <sessionId>", "Filter by session ID")
  .option("--history", "Show daily cost history for the last 7 days")
  .action(costCommand);

program
  .command("logs")
  .description("Show logs from background work")
  .option("--job <id>", "Show logs from a specific job ID")
  .option("--lines <n>", "Limit number of log lines")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(logsCommand);

program
  .command("add-agent")
  .description("Add an agent to a department")
  .requiredOption("-r, --role <role>", "Agent role name (e.g., data-scientist)")
  .requiredOption(
    "--department <department>",
    "Department to add to (cto, cfo, cmo)"
  )
  .option("-m, --model <model>", "Model to use", "sonnet")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(addAgentCommand);

program
  .command("remove-agent <role>")
  .description("Remove an agent")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(removeAgentCommand);

program
  .command("journal")
  .description("View CEO session history and journal entries")
  .option("--search <keyword>", "Search entries by keyword")
  .option("--limit <n>", "Number of entries to show (default: 10)")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(journalCommand);

program
  .command("config")
  .description("Interactive configuration")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(configCommand);

// --- Slack integration ---
const slack = program.command("slack").description("Manage Slack integration");
slack
  .command("connect")
  .description("Connect your AI company to Slack")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(slackConnectCommand);
slack
  .command("disconnect")
  .description("Disconnect Slack integration")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(slackDisconnectCommand);
slack
  .command("status")
  .description("Show Slack connection status")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(slackStatusCommand);

// --- Task management ---
const tasks = program.command("tasks").description("Manage company tasks and projects");
tasks
  .command("list")
  .description("List all tasks with optional filters")
  .option("--status <status>", "Filter by status (backlog,todo,in_progress,in_review,done,cancelled)")
  .option("--department <dept>", "Filter by department")
  .option("--assigned <agent>", "Filter by assigned agent")
  .option("--priority <priority>", "Filter by priority (critical,high,medium,low)")
  .option("--overdue", "Show only overdue tasks")
  .option("--blocked", "Show only blocked tasks")
  .option("--limit <n>", "Max tasks to show", "50")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(tasksListCommand);
tasks
  .command("create")
  .description("Create a new task")
  .option("--title <title>", "Task title")
  .option("--description <desc>", "Task description")
  .option("--department <dept>", "Department (engineering, finance, marketing)")
  .option("--assign <agent>", "Assign to an agent")
  .option("--priority <priority>", "Priority (critical, high, medium, low)", "medium")
  .option("--parent <id>", "Parent task ID (for subtasks)")
  .option("--deadline <datetime>", "Deadline (ISO 8601)")
  .option("-i, --interactive", "Interactive creation with prompts")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(tasksCreateCommand);
tasks
  .command("show <id>")
  .description("Show full task details")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(tasksShowCommand);
tasks
  .command("update <id>")
  .description("Update a task")
  .option("--status <status>", "New status")
  .option("--assign <agent>", "Reassign to agent")
  .option("--priority <priority>", "Change priority")
  .option("--comment <text>", "Add a comment")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(tasksUpdateCommand);
tasks
  .command("review")
  .description("Review tasks awaiting approval")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(tasksReviewCommand);
// Default action: show dashboard when bare `aicib tasks` is run
tasks
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(tasksCommand);

// --- Knowledge management ---
const knowledge = program.command("knowledge").description("Company knowledge base: wiki, journals, decisions, archives");
const knowledgeWiki = knowledge.command("wiki").description("Company wiki articles");
knowledgeWiki
  .command("show <slug>")
  .description("Show a wiki article")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeWikiShowCommand);
knowledgeWiki
  .command("create")
  .description("Create a wiki article")
  .option("--slug <slug>", "Article slug (URL-friendly identifier)")
  .option("--title <title>", "Article title")
  .option("--section <section>", "Section (overview, products, policies, brand, customers, competitors, general)")
  .option("--content <content>", "Article content")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeWikiCreateCommand);
knowledgeWiki
  .command("history <slug>")
  .description("Show version history for an article")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeWikiHistoryCommand);
// Default: list articles when bare `aicib knowledge wiki` is run
knowledgeWiki
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeWikiCommand);

const knowledgeDecisions = knowledge.command("decisions").description("Decision audit log");
knowledgeDecisions
  .command("show <id>")
  .description("Show decision detail")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeDecisionsShowCommand);
// Default: list decisions
knowledgeDecisions
  .option("--status <status>", "Filter by status (active, superseded, reversed)")
  .option("--limit <n>", "Max entries to show", "20")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeDecisionsCommand);

knowledge
  .command("journals")
  .description("Agent learning journals")
  .option("--agent <role>", "Filter by agent role")
  .option("--type <type>", "Filter by entry type (task_outcome, lesson, pattern, mistake, reflection)")
  .option("--limit <n>", "Max entries to show", "20")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeJournalsCommand);

const knowledgeArchives = knowledge.command("archives").description("Project archives");
knowledgeArchives
  .command("show <id>")
  .description("Show archive detail")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeArchivesShowCommand);
// Default: list archives
knowledgeArchives
  .option("--status <status>", "Filter by status (completed, cancelled, on_hold)")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeArchivesCommand);

knowledge
  .command("search <keyword>")
  .description("Search across all knowledge (wiki, journals, decisions, archives)")
  .option("--limit <n>", "Max results", "20")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeSearchCommand);

// Default: show dashboard when bare `aicib knowledge` is run
knowledge
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(knowledgeCommand);

// --- HR management ---
const hr = program.command("hr").description("HR system: onboarding, reviews, improvement plans");
hr.command("list")
  .description("List HR events")
  .option("--type <type>", "Filter by event type")
  .option("--agent <agent>", "Filter by agent role")
  .option("--limit <n>", "Max events to show", "50")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrListCommand);
hr.command("onboard <role>")
  .description("Start or view onboarding for an agent")
  .option("--speed <speed>", "Ramp speed (instant, standard, extended)")
  .option("--mentor <mentor>", "Mentor agent role")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrOnboardCommand);
hr.command("advance <role>")
  .description("Advance agent to next onboarding phase")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrAdvanceCommand);
hr.command("review <role>")
  .description("Create a performance review")
  .option("--task <score>", "Task completion score (0-100)")
  .option("--quality <score>", "Quality score (0-100)")
  .option("--efficiency <score>", "Efficiency score (0-100)")
  .option("--collaboration <score>", "Collaboration score (0-100)")
  .option("--summary <text>", "Review summary")
  .option("--rec <recommendation>", "Recommendation (maintain, promote, demote, improve, terminate)")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrReviewCommand);
hr.command("reviews [role]")
  .description("List performance reviews for an agent")
  .option("--limit <n>", "Max reviews to show", "10")
  .option("--auto", "Show only automated reviews")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrReviewsCommand);
hr.command("auto-reviews")
  .description("Automated performance review dashboard and queue")
  .option("--process", "Process pending auto-review queue")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrAutoReviewsCommand);
hr.command("promote <role>")
  .description("Record agent promotion")
  .requiredOption("--to <level>", "Target autonomy level")
  .option("--from <level>", "Current autonomy level (auto-resolved if omitted)")
  .option("--reason <text>", "Reason for promotion")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrPromoteCommand);
hr.command("demote <role>")
  .description("Record agent demotion")
  .requiredOption("--to <level>", "Target autonomy level")
  .option("--from <level>", "Current autonomy level (auto-resolved if omitted)")
  .option("--reason <text>", "Reason for demotion")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrDemoteCommand);
hr.command("improve <role>")
  .description("Create or manage improvement plan")
  .option("--goals <goals>", "Semicolon-separated goals")
  .option("--deadline <date>", "Deadline (ISO 8601)")
  .option("--resolve <planId>", "Resolve an existing plan by ID")
  .option("--outcome <outcome>", "Plan outcome (return_to_normal, reassign, reconfigure, terminate)")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrImproveCommand);
hr.command("state <role>")
  .description("View or change agent HR state")
  .option("--set <state>", "New state (active, idle, paused, hibernated, stopped, archived)")
  .option("--reason <text>", "Reason for state change")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrStateCommand);
hr.command("history <role>")
  .description("Full event history for an agent")
  .option("--limit <n>", "Max events to show", "25")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrHistoryCommand);
// Default action: show dashboard when bare `aicib hr` is run
hr.option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(hrCommand);

// --- Project management ---
const project = program.command("project").description("Manage long-running autonomous projects");
project
  .command("status")
  .description("Show active project progress")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(projectStatusCommand);
project
  .command("list")
  .description("List all projects")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(projectListCommand);
project
  .command("cancel")
  .description("Cancel the active project")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(projectCancelCommand);
// Default action: show status when bare `aicib project` is run
project
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(projectStatusCommand);

// --- Agent Persona Studio ---
const agent = program.command("agent").description("Agent Persona Studio: customize agent personalities, names, and backgrounds");
agent
  .command("list")
  .description("List all agents with persona info")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(agentListCommand);
agent
  .command("show <role>")
  .description("Show full persona detail for an agent")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(agentShowCommand);
agent
  .command("edit <role>")
  .description("Open agent soul.md file in your editor")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(agentEditCommand);
agent
  .command("customize [role]")
  .description("Interactive wizard to customize agent persona")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(agentCustomizeCommand);
// Default action: show dashboard when bare `aicib agent` is run
agent
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(agentDashboardCommand);

// --- Communication Routing ---
program
  .command("routing")
  .description("Show communication routing policy and department roster")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(routingCommand);

// --- Review Chains ---
program
  .command("reviews")
  .description("Show review chain configuration and in-review tasks")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(reviewsCommand);

// --- External Safeguards ---
const safeguards = program.command("safeguards").description("External action safeguards: approval chains and pending actions");
safeguards
  .command("pending")
  .description("List pending actions awaiting approval")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(safeguardsPendingCommand);
safeguards
  .command("approve <id>")
  .description("Approve a pending action")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(safeguardsApproveCommand);
safeguards
  .command("reject <id>")
  .description("Reject a pending action")
  .option("--reason <reason>", "Rejection reason")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(safeguardsRejectCommand);
safeguards
  .command("history")
  .description("Show resolved action history")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(safeguardsHistoryCommand);
// Default action: show dashboard when bare `aicib safeguards` is run
safeguards
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(safeguardsCommand);

// --- Trust Evolution ---
const trust = program.command("trust").description("Trust evolution: agent trust levels and upgrade recommendations");
trust
  .command("history <agent>")
  .description("Show action history for an agent")
  .option("--category <category>", "Filter by action category")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(trustHistoryCommand);
trust
  .command("recommendations")
  .description("Show agents ready for trust level upgrades")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(trustRecommendationsCommand);
trust
  .command("set <agent>")
  .description("Manually set trust level override for an agent")
  .requiredOption("--level <level>", "Trust level (probationary, established, trusted, veteran)")
  .requiredOption("--category <category>", "Action category")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(trustSetCommand);
// Default action: show dashboard when bare `aicib trust` is run
trust
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(trustCommand);

// --- Agent Scheduler ---
const schedule = program.command("schedule").description("Manage scheduled agent runs (morning briefings, weekly reports, etc.)");
schedule
  .command("list")
  .description("List all schedules")
  .option("--enabled", "Show only enabled schedules")
  .option("--agent <role>", "Filter by agent role")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleListCommand);
schedule
  .command("create")
  .description("Create a new schedule")
  .option("--name <name>", "Schedule name")
  .option("--cron <expression>", "Cron expression (e.g., '0 9 * * 1-5')")
  .option("--directive <text>", "Agent directive")
  .option("--agent <role>", "Target agent (default: ceo)")
  .option("--trigger <type:value>", "Trigger type and optional value (e.g., task_completed)")
  .option("-i, --interactive", "Interactive creation with prompts")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleCreateCommand);
schedule
  .command("show <id>")
  .description("Show full schedule details + recent executions")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleShowCommand);
schedule
  .command("delete <id>")
  .description("Delete a schedule")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleDeleteCommand);
schedule
  .command("enable <id>")
  .description("Enable a schedule")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleEnableCommand);
schedule
  .command("disable <id>")
  .description("Disable a schedule")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleDisableCommand);
schedule
  .command("history")
  .description("Show execution history")
  .option("--schedule <id>", "Filter by schedule ID")
  .option("--limit <n>", "Max entries to show", "20")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleHistoryCommand);
schedule
  .command("start")
  .description("Start the scheduler daemon")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleStartCommand);
schedule
  .command("stop")
  .description("Stop the scheduler daemon")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleStopCommand);
schedule
  .command("status")
  .description("Show scheduler daemon status")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleStatusCommand);
// Default action: show dashboard when bare `aicib schedule` is run
schedule
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(scheduleDashboardCommand);

// --- Reporting Suite ---
const report = program.command("report").description("Reporting suite: generate, view, and schedule reports");
report
  .command("generate <type>")
  .description("Generate a report (daily_briefing, weekly_department, monthly_financial, sprint_review, marketing_report)")
  .option("--delivery <method>", "Delivery method (slack, file, both)", "file")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(reportGenerateCommand);
report
  .command("list")
  .description("List all reports")
  .option("--type <type>", "Filter by report type")
  .option("--status <status>", "Filter by status (pending, generating, completed, failed)")
  .option("--limit <n>", "Max reports to show", "20")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(reportListCommand);
report
  .command("show <id>")
  .description("Show full report content and metadata")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(reportShowCommand);
report
  .command("templates")
  .description("List built-in report templates")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(reportTemplatesCommand);
report
  .command("schedule <type>")
  .description("Create a recurring schedule for a report type")
  .option("--cron <expression>", "Cron expression (e.g., '0 9 * * 1-5')")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(reportScheduleCommand);
// Default action: show dashboard when bare `aicib report` is run
report
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(reportDashboardCommand);

// --- Notifications ---
const notifications = program.command("notifications").description("Notification system: alerts, digests, and delivery preferences");
notifications
  .command("list")
  .description("List notifications")
  .option("--urgency <level>", "Filter by urgency (critical, high, medium, low)")
  .option("--status <status>", "Filter by status (pending, delivered, read, dismissed)")
  .option("--target <agent>", "Filter by target agent")
  .option("--since <datetime>", "Show notifications since (ISO 8601)")
  .option("--limit <n>", "Max notifications to show", "50")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(notificationsListCommand);
notifications
  .command("show <id>")
  .description("Show full notification details")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(notificationsShowCommand);
notifications
  .command("dismiss <id>")
  .description("Dismiss a notification")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(notificationsDismissCommand);
const notifPrefs = notifications.command("preferences").description("Manage notification preferences");
notifPrefs
  .command("set")
  .description("Set notification preferences")
  .requiredOption("--scope <scope>", "Scope (global, department, agent)")
  .requiredOption("--value <val>", "Scope value")
  .option("--push-urgency <level>", "Minimum urgency for push notifications")
  .option("--digest <frequency>", "Digest frequency (hourly, daily)")
  .option("--quiet-start <time>", "Quiet hours start (HH:MM)")
  .option("--quiet-end <time>", "Quiet hours end (HH:MM)")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(notificationsPreferencesSetCommand);
// Default: show preferences
notifPrefs
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(notificationsPreferencesCommand);
notifications
  .command("send")
  .description("Send a manual notification")
  .requiredOption("--title <title>", "Notification title")
  .option("--urgency <level>", "Urgency (critical, high, medium, low)")
  .option("--category <cat>", "Category")
  .option("--target <agent>", "Target agent")
  .option("--body <text>", "Notification body")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(notificationsSendCommand);
// Default action: show dashboard when bare `aicib notifications` is run
notifications
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(notificationsCommand);

// --- Company Events ---
const events = program.command("events").description("Company events: standups, all-hands, sprint planning, and more");
events
  .command("list")
  .description("List all events")
  .option("--type <type>", "Filter by event type")
  .option("--enabled", "Show only enabled events")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsListCommand);
events
  .command("create")
  .description("Create a new event")
  .option("--type <type>", "Event type (standup, all_hands, sprint_planning, quarterly_review, one_on_one, retrospective, custom)")
  .option("--name <name>", "Event name")
  .option("--cron <expression>", "Cron expression (e.g., '0 9 * * 1-5')")
  .option("--participants <mode>", "Participants mode (all, department, hierarchy, custom)")
  .option("--format <format>", "Discussion format (structured, free_form, async)")
  .option("-i, --interactive", "Interactive creation with prompts")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsCreateCommand);
events
  .command("show <id>")
  .description("Show event details and recent instances")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsShowCommand);
events
  .command("delete <id>")
  .description("Delete an event")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsDeleteCommand);
events
  .command("enable <id>")
  .description("Enable an event")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsEnableCommand);
events
  .command("disable <id>")
  .description("Disable an event")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsDisableCommand);
events
  .command("minutes [instance_id]")
  .description("View meeting minutes")
  .option("--event <id>", "Filter by event ID")
  .option("--limit <n>", "Max entries to show", "10")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsMinutesCommand);
events
  .command("setup")
  .description("Initialize default events from config")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsSetupCommand);
events
  .command("history")
  .description("Show event instance history")
  .option("--event <id>", "Filter by event ID")
  .option("--limit <n>", "Max entries to show", "20")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsHistoryCommand);
// Default action: show dashboard when bare `aicib events` is run
events
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(eventsCommand);

// --- Web UI ---
program
  .command("ui")
  .description("Launch the web dashboard")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .option("-p, --port <port>", "Port number", "3000")
  .action(uiCommand);

// --- MCP Integrations ---
const integrations = program.command("integrations").description("Manage MCP tool integrations");
integrations
  .command("list")
  .description("List configured and available MCP servers")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(integrationsListCommand);
integrations
  .command("add <server>")
  .description("Add an MCP server integration")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(integrationsAddCommand);
integrations
  .command("remove <server>")
  .description("Remove an MCP server integration")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(integrationsRemoveCommand);
integrations
  .command("status")
  .description("Show MCP integration runtime status")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(integrationsStatusCommand);
// Default action: show list when bare `aicib integrations` is run
integrations
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .action(integrationsListCommand);

// --- Template management ---
const template = program.command("template").description("Manage structures, industries, and community templates");
template
  .command("list")
  .description("List available structures and industries")
  .action(templateListCommand);
template
  .command("info <name>")
  .description("Show details of a structure or industry")
  .action(templateInfoCommand);
template
  .command("import <path>")
  .description("Import a community template")
  .action(templateImportCommand);
template
  .command("export")
  .description("Export current project as a template")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .option("-o, --output <path>", "Output directory", "template-export")
  .action(templateExportCommand);

// --- Data Export/Import ---
program
  .command("export")
  .description("Export company data (full backup, selective, or anonymized template)")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .option("-o, --output <path>", "Output path")
  .option("--mode <mode>", "Export mode: full, selective, anonymized", "full")
  .option("--only <categories>", "Comma-separated categories")
  .option("--no-compress", "Output directory instead of .tar.gz")
  .option("--include-secrets", "Include integration secrets (use with caution)")
  .action(exportCommand);

program
  .command("import <path>")
  .description("Import company data from an export package")
  .option("-d, --dir <dir>", "Project directory", process.cwd())
  .option("--merge", "Merge into existing company")
  .option("--only <categories>", "Import only specific categories")
  .option("--overwrite-agents", "Overwrite existing agent definitions")
  .option("--force", "Overwrite existing config without prompting")
  .option("--company-name <name>", "Company name for anonymized packages")
  .action(importCommand);

program.parse();
