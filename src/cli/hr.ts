import path from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import {
  HRManager,
  ONBOARDING_PHASES,
  VALID_HR_EVENT_TYPES,
  VALID_RAMP_SPEEDS,
  VALID_RECOMMENDATIONS,
  VALID_PLAN_OUTCOMES,
  VALID_AGENT_HR_STATES,
  type HREventType,
  type RampSpeed,
  type Recommendation,
  type OnboardingPhase,
  type PlanStatus,
  type PlanOutcome,
  type AgentHRState,
  type HRConfig,
} from "../core/hr.js";
import {
  header,
  createTable,
  agentColor,
  formatTimeAgo,
  formatUSD,
} from "./ui.js";
import {
  processAutoReviewQueue,
  isEligibleForAutoReview,
  AUTO_REVIEW_CONFIG_DEFAULTS,
  type AutoReviewConfig,
  type AutoReviewQueueEntry,
} from "../core/perf-review.js";
import Database from "better-sqlite3";

// ── Helpers ───────────────────────────────────────────────────────

function getHRManager(dir: string): HRManager {
  const projectDir = path.resolve(dir);

  try {
    loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  return new HRManager(projectDir);
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function formatScore(score: number | null): string {
  if (score === null || score === undefined) return chalk.dim("--");
  if (score >= 80) return chalk.green(String(score));
  if (score >= 60) return chalk.yellow(String(score));
  return chalk.red(String(score));
}

function formatRecommendation(rec: Recommendation): string {
  switch (rec) {
    case "promote": return chalk.green("promote");
    case "maintain": return chalk.white("maintain");
    case "improve": return chalk.yellow("improve");
    case "demote": return chalk.red("demote");
    case "terminate": return chalk.red.bold("terminate");
    default: return chalk.dim(rec);
  }
}

function formatHRState(state: AgentHRState): string {
  switch (state) {
    case "active": return chalk.green("active");
    case "idle": return chalk.dim("idle");
    case "paused": return chalk.yellow("paused");
    case "hibernated": return chalk.yellow("hibernated");
    case "stopped": return chalk.red("stopped");
    case "archived": return chalk.dim("archived");
    default: return chalk.dim(state);
  }
}

// ── Dashboard (default `aicib hr`) ──────────────────────────────

interface HROptions {
  dir: string;
}

export async function hrCommand(options: HROptions): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    console.log(header("HR Dashboard"));

    // Onboarding summary
    const onboarding = hr.listOnboarding();
    const activeOnboarding = onboarding.filter((o) => !o.completed_at);

    if (activeOnboarding.length > 0) {
      console.log(chalk.bold("  Onboarding in Progress:"));
      const table = createTable(
        ["Agent", "Phase", "Stage", "Speed", "Started"],
        [16, 8, 24, 10, 12]
      );

      for (const o of activeOnboarding) {
        const phase = ONBOARDING_PHASES[o.current_phase as OnboardingPhase];
        table.push([
          agentColor(o.agent_role)(truncate(o.agent_role, 14)),
          `${o.current_phase}/4`,
          phase.name,
          o.ramp_speed,
          chalk.dim(formatTimeAgo(o.created_at)),
        ]);
      }

      console.log(table.toString());
      console.log();
    } else {
      console.log(chalk.dim("  No agents currently onboarding.\n"));
    }

    // Reviews due
    const projectDir = path.resolve(options.dir);
    const config = loadConfig(projectDir);
    const hrConfig = config.extensions?.hr as HRConfig | undefined;
    const cadence = hrConfig?.review_cadence ?? "monthly";

    const due = hr.getAgentsDueForReview(cadence);
    if (due.length > 0) {
      console.log(
        chalk.yellow(
          `  ${due.length} agent${due.length > 1 ? "s" : ""} due for ${cadence} review: ${due.map((r) => agentColor(r)(r)).join(", ")}`
        )
      );
      console.log();
    }

    // Recent events
    const recentEvents = hr.getEvents(undefined, undefined, 5);
    if (recentEvents.length > 0) {
      console.log(chalk.bold("  Recent HR Events:"));
      for (const event of recentEvents) {
        const roleStr = agentColor(event.agent_role)(event.agent_role);
        console.log(
          `    ${chalk.dim(formatTimeAgo(event.created_at))} ${roleStr} — ${event.event_type}`
        );
      }
      console.log();
    }

    // Summary
    const allOnboarding = hr.listOnboarding();
    const completedCount = allOnboarding.filter((o) => o.completed_at).length;
    const totalOnboarding = allOnboarding.length;
    console.log(chalk.bold("  Summary:"));
    console.log(`    Agents onboarded: ${completedCount}/${totalOnboarding}`);
    console.log(`    Reviews due: ${due.length}`);
    console.log(`    Cadence: ${cadence}`);
    console.log();
  } finally {
    hr.close();
  }
}

// ── List Events ─────────────────────────────────────────────────

interface ListOptions extends HROptions {
  type?: string;
  agent?: string;
  limit?: string;
}

export async function hrListCommand(options: ListOptions): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    const filterLabels: string[] = [];

    let eventType: HREventType | undefined;
    if (options.type) {
      if (!VALID_HR_EVENT_TYPES.includes(options.type as HREventType)) {
        console.error(
          chalk.red(`  Error: Invalid event type "${options.type}". Valid: ${VALID_HR_EVENT_TYPES.join(", ")}`)
        );
        hr.close();
        process.exit(1);
      }
      eventType = options.type as HREventType;
      filterLabels.push(`type=${options.type}`);
    }

    if (options.agent) {
      filterLabels.push(`agent=${options.agent}`);
    }

    const limit = options.limit ? parseInt(options.limit, 10) : 50;
    if (Number.isNaN(limit) || limit <= 0) {
      console.error(chalk.red("  Error: --limit must be a positive number."));
      hr.close();
      process.exit(1);
    }

    const filterStr = filterLabels.length > 0 ? ` (${filterLabels.join(", ")})` : "";
    console.log(header(`HR Events${filterStr}`));

    const events = hr.getEvents(options.agent, eventType, limit);

    if (events.length === 0) {
      console.log(chalk.dim("  No HR events found.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Agent", "Event", "By", "Time"],
      [6, 16, 22, 14, 12]
    );

    for (const event of events) {
      table.push([
        String(event.id),
        agentColor(event.agent_role)(truncate(event.agent_role, 14)),
        truncate(event.event_type, 20),
        truncate(event.performed_by, 12),
        chalk.dim(formatTimeAgo(event.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  Showing ${events.length} events.\n`));
  } finally {
    hr.close();
  }
}

// ── Onboard ─────────────────────────────────────────────────────

interface OnboardOptions extends HROptions {
  speed?: string;
  mentor?: string;
}

export async function hrOnboardCommand(
  role: string,
  options: OnboardOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    // Check existing onboarding
    const existing = hr.getOnboarding(role);
    if (existing) {
      console.log(header(`Onboarding — ${role}`));
      const phase = ONBOARDING_PHASES[existing.current_phase as OnboardingPhase];

      if (existing.completed_at) {
        console.log(`  ${chalk.green("\u2713")} Onboarding complete`);
        console.log(`  Completed: ${formatTimeAgo(existing.completed_at)}`);
      } else {
        console.log(`  Phase:   ${existing.current_phase}/4 — ${phase.name}`);
        console.log(`  Level:   ${phase.autonomy}`);
        console.log(`  Speed:   ${existing.ramp_speed}`);
        if (existing.mentor) {
          console.log(`  Mentor:  ${agentColor(existing.mentor)(existing.mentor)}`);
        }
        console.log(`  Started: ${formatTimeAgo(existing.phase_started_at)}`);
      }
      console.log();
      return;
    }

    // Start new onboarding
    let speed: RampSpeed = "standard";
    if (options.speed) {
      if (!VALID_RAMP_SPEEDS.includes(options.speed as RampSpeed)) {
        console.error(
          chalk.red(`  Error: Invalid ramp speed "${options.speed}". Valid: ${VALID_RAMP_SPEEDS.join(", ")}`)
        );
        hr.close();
        process.exit(1);
      }
      speed = options.speed as RampSpeed;
    }

    const record = hr.startOnboarding(role, options.mentor, speed);

    console.log(header("Onboarding Started"));
    const phase = ONBOARDING_PHASES[record.current_phase as OnboardingPhase];
    console.log(`  ${chalk.green("\u2713")} Agent: ${agentColor(role)(role)}`);
    console.log(`  ${chalk.green("\u2713")} Phase: ${record.current_phase}/4 — ${phase.name}`);
    console.log(`  ${chalk.green("\u2713")} Autonomy: ${phase.autonomy}`);
    console.log(`  ${chalk.green("\u2713")} Speed: ${speed}`);
    if (record.completed_at) {
      console.log(`  ${chalk.green("\u2713")} Instant ramp — onboarding complete`);
    }
    console.log();
  } finally {
    hr.close();
  }
}

// ── Advance Onboarding ──────────────────────────────────────────

export async function hrAdvanceCommand(
  role: string,
  options: HROptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    const record = hr.advanceOnboarding(role, "human-founder");

    if (!record) {
      console.error(chalk.red(`  Error: No active onboarding found for "${role}".\n`));
      return;
    }

    const phase = ONBOARDING_PHASES[record.current_phase as OnboardingPhase];

    console.log(header("Onboarding Advanced"));
    console.log(`  ${chalk.green("\u2713")} Agent: ${agentColor(role)(role)}`);

    if (record.completed_at) {
      console.log(`  ${chalk.green("\u2713")} Onboarding complete! Full autonomy granted.`);
    } else {
      console.log(`  ${chalk.green("\u2713")} Phase: ${record.current_phase}/4 — ${phase.name}`);
      console.log(`  ${chalk.green("\u2713")} Autonomy: ${phase.autonomy}`);
    }
    console.log();
  } finally {
    hr.close();
  }
}

// ── Create Review ───────────────────────────────────────────────

interface ReviewOptions extends HROptions {
  task?: string;
  quality?: string;
  efficiency?: string;
  collaboration?: string;
  summary?: string;
  rec?: string;
}

export async function hrReviewCommand(
  role: string,
  options: ReviewOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    const taskScore = options.task ? parseFloat(options.task) : undefined;
    const qualityScore = options.quality ? parseFloat(options.quality) : undefined;
    const efficiencyScore = options.efficiency ? parseFloat(options.efficiency) : undefined;
    const collaborationScore = options.collaboration ? parseFloat(options.collaboration) : undefined;

    // Validate scores are finite numbers (parseFloat("abc") → NaN)
    for (const [name, val] of [["task", taskScore], ["quality", qualityScore], ["efficiency", efficiencyScore], ["collaboration", collaborationScore]] as const) {
      if (val !== undefined && !Number.isFinite(val)) {
        console.error(chalk.red(`  Error: Invalid score for --${name}: "${options[name as keyof ReviewOptions]}". Must be a number.\n`));
        hr.close();
        process.exit(1);
      }
    }

    let rec: Recommendation = "maintain";
    if (options.rec) {
      if (!VALID_RECOMMENDATIONS.includes(options.rec as Recommendation)) {
        console.error(
          chalk.red(`  Error: Invalid recommendation "${options.rec}". Valid: ${VALID_RECOMMENDATIONS.join(", ")}`)
        );
        hr.close();
        process.exit(1);
      }
      rec = options.rec as Recommendation;
    }

    const review = hr.createReview({
      agentRole: role,
      reviewer: "human-founder",
      taskScore,
      qualityScore,
      efficiencyScore,
      collaborationScore,
      summary: options.summary,
      recommendation: rec,
    });

    console.log(header("Review Created"));
    console.log(`  Agent:          ${agentColor(role)(role)}`);
    console.log(`  Task Score:     ${formatScore(review.task_score)}`);
    console.log(`  Quality Score:  ${formatScore(review.quality_score)}`);
    console.log(`  Efficiency:     ${formatScore(review.efficiency_score)}`);
    console.log(`  Collaboration:  ${formatScore(review.collaboration_score)}`);
    console.log(`  Overall:        ${chalk.bold(formatScore(review.overall_score))}`);
    console.log(`  Recommendation: ${formatRecommendation(review.recommendation)}`);
    if (review.summary) {
      console.log(`  Summary:        ${review.summary}`);
    }
    console.log();
  } finally {
    hr.close();
  }
}

// ── List Reviews ────────────────────────────────────────────────

interface ReviewsOptions extends HROptions {
  limit?: string;
  auto?: boolean;
}

export async function hrReviewsCommand(
  role: string | undefined,
  options: ReviewsOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 10;

    if (!role) {
      console.log(header("Reviews"));
      console.log(chalk.dim("  Usage: aicib hr reviews <role> [--limit N] [--auto]\n"));
      return;
    }

    const autoLabel = options.auto ? " (auto only)" : "";
    console.log(header(`Reviews — ${role}${autoLabel}`));

    let reviews = hr.getReviews(role, limit);

    // Filter to only automated reviews if --auto flag is set
    if (options.auto) {
      reviews = reviews.filter((r) =>
        r.review_type === "periodic" && r.reviewer !== "human-founder"
      );
    }

    if (reviews.length === 0) {
      console.log(chalk.dim(`  No ${options.auto ? "automated " : ""}reviews found.\n`));
      return;
    }

    const table = createTable(
      ["ID", "Type", "Overall", "Rec", "Reviewer", "Date"],
      [6, 12, 10, 12, 14, 12]
    );

    for (const review of reviews) {
      table.push([
        String(review.id),
        review.review_type,
        formatScore(review.overall_score),
        formatRecommendation(review.recommendation),
        truncate(review.reviewer, 12),
        chalk.dim(formatTimeAgo(review.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  Showing ${reviews.length} review(s).\n`));
  } finally {
    hr.close();
  }
}

// ── Promote / Demote helpers ─────────────────────────────────────

function resolveFromLevel(hr: HRManager, role: string): string {
  // Try to resolve from latest promoted/demoted event
  const events = hr.getEvents(role, undefined, 50);
  for (const event of events) {
    if (event.event_type === "promoted" || event.event_type === "demoted") {
      try {
        const details = JSON.parse(event.details);
        if (details.to_level) return details.to_level;
      } catch { /* ignore */ }
    }
  }

  // Fall back to onboarding completion phase autonomy
  const onboarding = hr.getOnboarding(role);
  if (onboarding?.completed_at) {
    const phase = ONBOARDING_PHASES[onboarding.current_phase as OnboardingPhase];
    return phase.autonomy;
  }

  return "unknown";
}

// ── Promote ─────────────────────────────────────────────────────

interface PromoteOptions extends HROptions {
  to: string;
  from?: string;
  reason?: string;
}

export async function hrPromoteCommand(
  role: string,
  options: PromoteOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    const from = options.from ?? resolveFromLevel(hr, role);
    const to = options.to;

    hr.recordPromotion(role, from, to, options.reason, "human-founder");

    console.log(header("Promotion Recorded"));
    console.log(`  ${chalk.green("\u2713")} Agent: ${agentColor(role)(role)}`);
    console.log(`  ${chalk.green("\u2713")} ${from} -> ${chalk.green(to)}`);
    if (options.reason) {
      console.log(`  ${chalk.green("\u2713")} Reason: ${options.reason}`);
    }
    console.log();
  } finally {
    hr.close();
  }
}

// ── Demote ──────────────────────────────────────────────────────

interface DemoteOptions extends HROptions {
  to: string;
  from?: string;
  reason?: string;
}

export async function hrDemoteCommand(
  role: string,
  options: DemoteOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    const from = options.from ?? resolveFromLevel(hr, role);
    const to = options.to;

    hr.recordDemotion(role, from, to, options.reason, "human-founder");

    console.log(header("Demotion Recorded"));
    console.log(`  ${chalk.yellow("\u2713")} Agent: ${agentColor(role)(role)}`);
    console.log(`  ${chalk.yellow("\u2713")} ${from} -> ${chalk.red(to)}`);
    if (options.reason) {
      console.log(`  ${chalk.yellow("\u2713")} Reason: ${options.reason}`);
    }
    console.log();
  } finally {
    hr.close();
  }
}

// ── Improvement Plans ───────────────────────────────────────────

interface ImproveOptions extends HROptions {
  goals?: string;
  deadline?: string;
  resolve?: string;
  outcome?: string;
}

export async function hrImproveCommand(
  role: string,
  options: ImproveOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    // If --resolve is set, update existing plan
    if (options.resolve) {
      const planId = parseInt(options.resolve, 10);
      if (Number.isNaN(planId)) {
        console.error(chalk.red("  Error: --resolve must be a plan ID (number).\n"));
        return;
      }

      const status = "completed" as PlanStatus;
      let outcome: PlanOutcome | undefined;
      if (options.outcome) {
        if (!VALID_PLAN_OUTCOMES.includes(options.outcome as PlanOutcome)) {
          console.error(
            chalk.red(`  Error: Invalid outcome "${options.outcome}". Valid: ${VALID_PLAN_OUTCOMES.join(", ")}`)
          );
          return;
        }
        outcome = options.outcome as PlanOutcome;
      }

      const plan = hr.updateImprovementPlan(planId, { status, outcome });
      if (!plan) {
        console.error(chalk.red(`  Error: Plan #${planId} not found.\n`));
        return;
      }

      if (plan.agent_role !== role) {
        console.error(chalk.red(`  Error: Plan #${planId} belongs to "${plan.agent_role}", not "${role}".\n`));
        return;
      }

      console.log(header("Improvement Plan Resolved"));
      console.log(`  ${chalk.green("\u2713")} Plan #${plan.id} for ${agentColor(plan.agent_role)(plan.agent_role)}`);
      console.log(`  ${chalk.green("\u2713")} Status: ${plan.status}`);
      if (plan.outcome) {
        console.log(`  ${chalk.green("\u2713")} Outcome: ${plan.outcome}`);
      }
      console.log();
      return;
    }

    // Show existing plan if no --goals
    if (!options.goals) {
      const active = hr.getActivePlan(role);
      if (active) {
        console.log(header(`Improvement Plan — ${role}`));
        let goalsArr: string[];
        try {
          goalsArr = JSON.parse(active.goals);
        } catch {
          goalsArr = [active.goals];
        }
        console.log(`  Plan #${active.id}`);
        console.log(`  Status:   ${active.status}`);
        console.log(`  Goals:`);
        for (const goal of goalsArr) {
          console.log(`    - ${goal}`);
        }
        if (active.deadline) {
          console.log(`  Deadline: ${active.deadline}`);
        }
        if (active.notes) {
          console.log(`  Notes:    ${active.notes}`);
        }
        console.log(`  Created:  ${formatTimeAgo(active.created_at)}`);
        console.log();
      } else {
        const plans = hr.getPlans(role);
        if (plans.length > 0) {
          console.log(header(`Improvement Plans — ${role}`));
          for (const plan of plans) {
            console.log(`  Plan #${plan.id} — ${plan.status} (${formatTimeAgo(plan.created_at)})`);
          }
          console.log();
        } else {
          console.log(chalk.dim(`  No improvement plans for "${role}".\n`));
          console.log(chalk.dim(`  Create one: aicib hr improve ${role} --goals "goal1;goal2"\n`));
        }
      }
      return;
    }

    // Create new plan
    const goalList = options.goals.split(";").map((g) => g.trim()).filter(Boolean);
    if (goalList.length === 0) {
      console.error(chalk.red("  Error: --goals must contain at least one goal.\n"));
      return;
    }

    const plan = hr.createImprovementPlan({
      agentRole: role,
      createdBy: "human-founder",
      goals: goalList,
      deadline: options.deadline,
    });

    console.log(header("Improvement Plan Created"));
    console.log(`  ${chalk.green("\u2713")} Plan #${plan.id} for ${agentColor(role)(role)}`);
    console.log(`  ${chalk.green("\u2713")} Goals:`);
    for (const goal of goalList) {
      console.log(`    - ${goal}`);
    }
    if (plan.deadline) {
      console.log(`  ${chalk.green("\u2713")} Deadline: ${plan.deadline}`);
    }
    console.log();
  } finally {
    hr.close();
  }
}

// ── State ───────────────────────────────────────────────────────

interface StateOptions extends HROptions {
  set?: string;
  reason?: string;
}

export async function hrStateCommand(
  role: string,
  options: StateOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    if (options.set) {
      if (!VALID_AGENT_HR_STATES.includes(options.set as AgentHRState)) {
        console.error(
          chalk.red(`  Error: Invalid state "${options.set}". Valid: ${VALID_AGENT_HR_STATES.join(", ")}`)
        );
        hr.close();
        process.exit(1);
      }

      hr.recordStateChange(role, options.set as AgentHRState, options.reason, "human-founder");

      console.log(header("State Changed"));
      console.log(`  ${chalk.green("\u2713")} Agent: ${agentColor(role)(role)}`);
      console.log(`  ${chalk.green("\u2713")} State: ${formatHRState(options.set as AgentHRState)}`);
      if (options.reason) {
        console.log(`  ${chalk.green("\u2713")} Reason: ${options.reason}`);
      }
      console.log();
      return;
    }

    // Show current state
    const state = hr.getAgentState(role);
    console.log(header(`Agent State — ${role}`));
    if (state) {
      console.log(`  State: ${formatHRState(state)}`);
    } else {
      console.log(chalk.dim("  No state recorded."));
      console.log(chalk.dim(`  Set one: aicib hr state ${role} --set active`));
    }
    console.log();
  } finally {
    hr.close();
  }
}

// ── History ─────────────────────────────────────────────────────

interface HistoryOptions extends HROptions {
  limit?: string;
}

export async function hrHistoryCommand(
  role: string,
  options: HistoryOptions
): Promise<void> {
  const hr = getHRManager(options.dir);

  try {
    const limit = options.limit ? parseInt(options.limit, 10) : 25;

    console.log(header(`HR History — ${role}`));

    const events = hr.getEvents(role, undefined, limit);

    if (events.length === 0) {
      console.log(chalk.dim("  No events found.\n"));
      return;
    }

    const table = createTable(
      ["ID", "Event", "By", "Details", "Time"],
      [6, 22, 14, 24, 12]
    );

    for (const event of events) {
      let details = "";
      try {
        const d = JSON.parse(event.details);
        const parts: string[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (v !== null && v !== undefined && v !== "") {
            parts.push(`${k}=${v}`);
          }
        }
        details = parts.slice(0, 3).join(" ");
      } catch {
        details = truncate(event.details, 22);
      }

      table.push([
        String(event.id),
        truncate(event.event_type, 20),
        truncate(event.performed_by, 12),
        truncate(details, 22),
        chalk.dim(formatTimeAgo(event.created_at)),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  Showing ${events.length} event(s).\n`));
  } finally {
    hr.close();
  }
}

// ── Auto-Reviews Dashboard ──────────────────────────────────────

interface AutoReviewsOptions extends HROptions {
  process?: boolean;
}

export async function hrAutoReviewsCommand(
  options: AutoReviewsOptions
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(
      chalk.red(
        `  Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }

  const autoConfig = (config.extensions?.auto_reviews as AutoReviewConfig) || AUTO_REVIEW_CONFIG_DEFAULTS;

  // Process queue if --process flag is set
  if (options.process) {
    console.log(chalk.dim("  Processing auto-review queue..."));

    const processed = processAutoReviewQueue(projectDir, autoConfig);
    console.log(`  ${chalk.green("\u2713")} Processed ${processed} auto-review(s).\n`);
  }

  console.log(header("Auto-Reviews Dashboard"));

  let db: Database.Database | undefined;
  try {
    db = new Database(path.join(projectDir, ".aicib", "state.db"), { readonly: true });
    db.pragma("busy_timeout = 3000");

    // Queue status
    const pending = db
      .prepare("SELECT COUNT(*) as count FROM auto_review_queue WHERE status = 'pending'")
      .get() as { count: number };
    const completed = db
      .prepare("SELECT COUNT(*) as count FROM auto_review_queue WHERE status = 'completed'")
      .get() as { count: number };
    const skipped = db
      .prepare("SELECT COUNT(*) as count FROM auto_review_queue WHERE status = 'skipped'")
      .get() as { count: number };

    console.log(chalk.bold("  Queue Status:"));
    console.log(`    Pending:   ${pending.count}`);
    console.log(`    Completed: ${completed.count}`);
    console.log(`    Skipped:   ${skipped.count}`);
    console.log();

    // Recently completed auto-reviews
    const recent = db
      .prepare("SELECT * FROM auto_review_queue WHERE status IN ('completed', 'skipped') ORDER BY processed_at DESC LIMIT 10")
      .all() as AutoReviewQueueEntry[];

    if (recent.length > 0) {
      console.log(chalk.bold("  Recent Auto-Reviews:"));
      const table = createTable(
        ["ID", "Agent", "Trigger", "Status", "Review ID", "Processed"],
        [6, 16, 16, 12, 10, 12]
      );

      for (const entry of recent) {
        table.push([
          String(entry.id),
          agentColor(entry.agent_role)(truncate(entry.agent_role, 14)),
          truncate(entry.trigger_event, 14),
          entry.status === "completed" ? chalk.green("completed") : chalk.dim("skipped"),
          entry.review_id ? String(entry.review_id) : chalk.dim("--"),
          chalk.dim(entry.processed_at ? formatTimeAgo(entry.processed_at) : "N/A"),
        ]);
      }

      console.log(table.toString());
      console.log();
    }

    console.log(chalk.bold("  Configuration:"));
    console.log(`    Enabled:    ${autoConfig.enabled ? chalk.green("yes") : chalk.red("no")}`);
    console.log(`    Trigger:    ${autoConfig.trigger}`);
    console.log(`    Min tasks:  ${autoConfig.min_tasks_before_review}`);
    console.log(`    Cooldown:   ${autoConfig.cooldown_hours}h`);
    console.log(`    Cadence:    ${autoConfig.periodic_cadence}`);
    console.log();

    if (pending.count > 0) {
      console.log(chalk.yellow(`  ${pending.count} pending review(s). Run: aicib hr auto-reviews --process\n`));
    }
  } catch {
    console.log(chalk.dim("  Auto-review queue is empty. Reviews will be queued when tasks are completed.\n"));
  } finally {
    db?.close();
  }
}
