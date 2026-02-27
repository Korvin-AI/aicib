#!/usr/bin/env node

/**
 * Background worker process — runs as a detached child process.
 * Invoked as: node background-worker.js <jobId> <projectDir> <sdkSessionId>
 *
 * Reads the directive from the background_jobs DB row (avoids OS arg-length
 * limits and leaking text into `ps aux`). Calls sendBrief() against the
 * existing SDK session, writing all agent messages to the background_logs
 * table instead of the console. On completion or error, updates the
 * background_jobs row with the outcome.
 *
 * Supports two modes:
 * - Single brief: standard one-shot directive execution
 * - Project mode: multi-phase autonomous execution (detected via [PROJECT::<id>] prefix)
 */

// Side-effect imports: register task + intelligence + knowledge + project hooks before config/DB
import "./task-register.js";
import "./intelligence-register.js";
import "./knowledge-register.js";
import "./project-register.js";
import "./routing-register.js";
import "./review-chains-register.js";
import "./mcp-register.js";
import "./safeguards-register.js";
import "./scheduler-register.js";
import "./reporting-register.js";
import "./perf-review-register.js";
import "./notifications-register.js";
import "./events-register.js";

import { loadConfig } from "./config.js";
import type { AicibConfig } from "./config.js";
import { CostTracker } from "./cost-tracker.js";
import type { EngineMessage, EngineSystemMessage } from "./engine/index.js";
import { getEngine } from "./engine/index.js";
import { sendBrief, recordRunCosts, generateJournalEntry, formatMessagePlain } from "./agent-runner.js";
import { ProjectPlanner, type ProjectConfig, PROJECT_CONFIG_DEFAULTS } from "./project-planner.js";
import { TaskManager } from "./task-manager.js";
import { EventManager, type EventConfig, type ParticipantsConfig, EVENTS_CONFIG_DEFAULTS } from "./events.js";
import { NotificationManager } from "./notifications.js";

// SIGTERM flag for graceful shutdown between phases
let sigtermReceived = false;
process.on("SIGTERM", () => {
  sigtermReceived = true;
});

/**
 * Track sub-agent status from task_notification messages.
 * Extracted to avoid duplication between runSingleBrief and runProjectLoop.
 */
function trackSubagentStatus(msg: EngineMessage, costTracker: CostTracker): void {
  if (
    msg.type === "system" &&
    "subtype" in msg &&
    ((msg as EngineSystemMessage).subtype as string) === "task_notification"
  ) {
    const taskMsg = msg as EngineSystemMessage & {
      taskName?: string;
      taskStatus?: string;
      agentName?: string;
    };
    const agent = (
      taskMsg.agentName ||
      taskMsg.taskName ||
      "subagent"
    ).toLowerCase();
    const status = taskMsg.taskStatus || "working";
    const taskLabel =
      status === "completed" || status === "done"
        ? "idle"
        : "working";
    costTracker.setAgentStatus(agent, taskLabel);
  }
}

/**
 * Create a message callback that logs to background_logs and tracks sub-agents.
 */
function createMessageCallback(
  jobId: number,
  costTracker: CostTracker,
  prefix?: string
): (msg: EngineMessage) => void {
  return (msg: EngineMessage) => {
    const formatted = formatMessagePlain(msg);
    if (formatted) {
      let role = "system";
      if (msg.type === "assistant") {
        role = msg.parent_tool_use_id ? "subagent" : "ceo";
      } else if (msg.type === "result") {
        role = "system";
      }
      const content = prefix ? `${prefix} ${formatted}` : formatted;
      costTracker.logBackgroundMessage(jobId, msg.type, role, content);
    }
    trackSubagentStatus(msg, costTracker);
  };
}

/**
 * Run a single brief directive — the original background worker behavior.
 * Pure extraction from the previous inline code.
 */
async function runSingleBrief(
  jobId: number,
  directive: string,
  projectDir: string,
  sdkSessionId: string,
  sessionId: string,
  config: AicibConfig,
  costTracker: CostTracker
): Promise<void> {
  const startTime = Date.now();

  try {
    const result = await sendBrief(
      sdkSessionId,
      directive,
      projectDir,
      config,
      createMessageCallback(jobId, costTracker)
    );

    // Record costs using the job's own session_id (immutable, never null)
    recordRunCosts(
      result,
      costTracker,
      sessionId,
      "ceo",
      config.agents.ceo?.model || "opus"
    );

    // Generate journal entry (best-effort)
    const durationMs = Date.now() - startTime;
    try {
      await generateJournalEntry(
        sdkSessionId,
        directive,
        result,
        projectDir,
        costTracker,
        sessionId
      );
      costTracker.logBackgroundMessage(
        jobId,
        "info",
        "system",
        "[JOURNAL] Session summary saved"
      );
    } catch {
      // Journal generation is best-effort
      costTracker.logBackgroundMessage(jobId, "warning", "system", "[JOURNAL] Failed to generate summary");
    }

    // Mark CEO as idle after successful completion
    costTracker.setAgentStatus("ceo", "idle");

    costTracker.updateBackgroundJob(jobId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      total_cost_usd: result.totalCostUsd,
      num_turns: result.numTurns,
      duration_ms: durationMs,
      result_summary: `Completed in ${result.numTurns} turns, $${result.totalCostUsd.toFixed(4)} cost`,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg =
      error instanceof Error ? error.message : String(error);

    costTracker.logBackgroundMessage(
      jobId,
      "error",
      "system",
      `[ERROR] ${errorMsg}`
    );

    // Mark CEO as error on failure
    try { costTracker.setAgentStatus("ceo", "error"); } catch { /* best-effort */ }

    costTracker.updateBackgroundJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      error_message: errorMsg,
    });
  }
}

/**
 * Parse the review verdict from CEO output.
 * Returns { approved: boolean, feedback: string }.
 */
function parseReviewVerdict(text: string): { approved: boolean; feedback: string } {
  // Primary: look for APPROVED or REJECTED keywords
  if (/\bAPPROVED\b/i.test(text)) {
    return { approved: true, feedback: text };
  }
  if (/\bREJECTED\b/i.test(text)) {
    return { approved: false, feedback: text };
  }

  // Fallback heuristics
  if (/all criteria met|successfully completed|looks good/i.test(text)) {
    return { approved: true, feedback: text };
  }
  if (/needs revision|not met|incomplete|missing/i.test(text)) {
    return { approved: false, feedback: text };
  }

  // Default to approved to prevent infinite loops
  return { approved: true, feedback: text };
}

/**
 * Extract assistant text from an engine message stream result.
 */
function extractAssistantText(messages: EngineMessage[]): string {
  const texts: string[] = [];
  for (const msg of messages) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if ("text" in block && block.text) {
          texts.push(block.text);
        }
      }
    }
  }
  return texts.join("\n");
}

/**
 * Run a multi-phase project — the core orchestration loop.
 */
async function runProjectLoop(
  jobId: number,
  projectId: number,
  projectDir: string,
  sdkSessionId: string,
  sessionId: string,
  config: AicibConfig,
  costTracker: CostTracker
): Promise<void> {
  const pp = new ProjectPlanner(projectDir);
  const projectsConfig = (config.extensions?.projects as ProjectConfig | undefined) ?? PROJECT_CONFIG_DEFAULTS;
  const startTime = Date.now();

  const logMsg = (type: string, msg: string) => {
    costTracker.logBackgroundMessage(jobId, type, "system", `[PROJECT] ${msg}`);
  };

  try {
    let project = pp.getProject(projectId);
    if (!project) {
      throw new Error(`Project #${projectId} not found`);
    }

    // ── Phase 1: Planning ──────────────────────────────────────────
    if (project.status === "planning") {
      logMsg("info", `Planning project: "${project.title}"`);
      costTracker.setAgentStatus("ceo", "working", `Planning: ${project.title}`);

      const planningPrompt = pp.buildPlanningPrompt(project.original_brief);
      const planningMessages: EngineMessage[] = [];
      const planningResult = await sendBrief(
        sdkSessionId,
        planningPrompt,
        projectDir,
        config,
        (msg) => {
          planningMessages.push(msg);
          createMessageCallback(jobId, costTracker, "[PROJECT:PLAN]")(msg);
        }
      );

      // Collect assistant text to parse phase plan
      const engine = getEngine();
      const summaryStream = engine.resumeSession(sdkSessionId, {
        prompt: "Output ONLY the phase plan you just created, in the exact PHASE::N format. No other text.",
        model: projectsConfig.planning_model || "haiku",
        tools: [],
        maxTurns: 1,
      });

      const planMessages: EngineMessage[] = [];
      for await (const msg of summaryStream) {
        planMessages.push(msg);
      }

      const planText = extractAssistantText(planMessages);
      let phases = pp.parsePlanningOutput(planText);

      // If parsing failed, try the original planning messages as fallback
      if (phases.length === 0) {
        logMsg("warning", "Could not parse plan from summary; attempting original output");
        const originalText = extractAssistantText(planningMessages);
        phases = pp.parsePlanningOutput(originalText);
      }

      // Cap phases at max_phases
      if (phases.length > projectsConfig.max_phases) {
        phases = phases.slice(0, projectsConfig.max_phases);
      }

      if (phases.length === 0) {
        throw new Error("Failed to parse project plan — no phases found in CEO output");
      }

      // Create phase records in DB
      for (const plan of phases) {
        pp.createPhase(
          projectId,
          plan.phaseNumber,
          plan.title,
          plan.objective,
          plan.acceptanceCriteria,
          projectsConfig.max_phase_retries
        );
      }

      // Create tasks in TaskManager for each phase
      let tm: TaskManager | undefined;
      try {
        tm = new TaskManager(projectDir);
        for (const plan of phases) {
          tm.createTask({
            title: `[Project] Phase ${plan.phaseNumber}: ${plan.title}`,
            description: plan.objective,
            project: project.title,
            assignee: "ceo",
            priority: "high",
            created_by: "system",
            session_id: sessionId,
          });
        }
      } catch {
        // Task creation is best-effort
        logMsg("warning", "Could not create tasks for phases");
      } finally {
        tm?.close();
      }

      // Update project status — include planning cost in project totals
      pp.updateProject(projectId, {
        status: "executing",
        total_phases: phases.length,
        total_cost_usd: planningResult.totalCostUsd,
        total_turns: planningResult.numTurns,
      });
      project = pp.getProject(projectId)!;

      recordRunCosts(planningResult, costTracker, sessionId, "ceo", config.agents.ceo?.model || "opus");
      logMsg("info", `Planning complete: ${phases.length} phases created`);
    }

    // ── Phase 2: Execution Loop ────────────────────────────────────
    let phase = pp.getNextPendingPhase(projectId);
    let lastRetryFeedback: string | undefined;

    while (phase) {
      // Check SIGTERM — pause gracefully between phases
      if (sigtermReceived) {
        logMsg("info", "SIGTERM received — pausing project after current phase");
        pp.updateProject(projectId, { status: "paused" });
        costTracker.setAgentStatus("ceo", "idle");
        break;
      }

      // Check for external cancellation/pause (e.g. `aicib project cancel`)
      project = pp.getProject(projectId)!;
      if (project.status === "cancelled" || project.status === "paused") {
        logMsg("info", `Project ${project.status} externally — stopping`);
        costTracker.setAgentStatus("ceo", "idle");
        break;
      }

      // Check daily cost limit
      const todayCost = costTracker.getTotalCostToday();
      if (config.settings.cost_limit_daily > 0 && todayCost >= config.settings.cost_limit_daily) {
        logMsg("warning", `Daily cost limit reached ($${todayCost.toFixed(2)}) — pausing project`);
        pp.updateProject(projectId, { status: "paused" });
        costTracker.setAgentStatus("ceo", "idle");
        break;
      }

      // Update status
      const statusMsg = `Phase ${phase.phase_number}/${project.total_phases}: ${phase.title}`;
      costTracker.setAgentStatus("ceo", "working", statusMsg);
      logMsg("info", `Starting ${statusMsg} (attempt ${phase.attempt})`);

      // Mark phase as executing
      pp.updatePhase(phase.id, {
        status: "executing",
        started_at: new Date().toISOString(),
        sdk_session_id: sdkSessionId,
        job_id: jobId,
      });

      const phaseStart = Date.now();

      // ── Execute phase (wrapped in try/catch to prevent orphaned "executing" phases) ──
      try {
        const phasePrompt = pp.buildPhasePrompt(phase, project, lastRetryFeedback);
        lastRetryFeedback = undefined;

        const phaseResult = await sendBrief(
          sdkSessionId,
          phasePrompt,
          projectDir,
          config,
          createMessageCallback(jobId, costTracker, `[PROJECT:P${phase.phase_number}]`)
        );

        recordRunCosts(phaseResult, costTracker, sessionId, "ceo", config.agents.ceo?.model || "opus");

        // ── Generate phase summary via haiku ──
        const summaryPrompt = pp.buildSummaryPrompt(phase);
        let summaryText = "";
        try {
          const engine = getEngine();
          const summaryStream = engine.resumeSession(sdkSessionId, {
            prompt: summaryPrompt,
            model: projectsConfig.summary_model || "haiku",
            tools: [],
            maxTurns: 1,
          });

          const summaryMessages: EngineMessage[] = [];
          for await (const msg of summaryStream) {
            summaryMessages.push(msg);
          }
          summaryText = extractAssistantText(summaryMessages);
        } catch {
          summaryText = `Phase ${phase.phase_number} execution completed.`;
        }

        // ── Review phase ──
        pp.updatePhase(phase.id, { status: "reviewing" });
        logMsg("info", `Reviewing Phase ${phase.phase_number}...`);

        const reviewPrompt = pp.buildReviewPrompt(phase, project);
        let reviewText = "";
        try {
          const engine = getEngine();
          const reviewStream = engine.resumeSession(sdkSessionId, {
            prompt: reviewPrompt,
            model: projectsConfig.review_model || config.agents.ceo?.model || "opus",
            tools: [],
            maxTurns: 1,
          });

          const reviewMessages: EngineMessage[] = [];
          for await (const msg of reviewStream) {
            reviewMessages.push(msg);
            const formatted = formatMessagePlain(msg);
            if (formatted) {
              costTracker.logBackgroundMessage(jobId, msg.type, "ceo", `[PROJECT:REVIEW] ${formatted}`);
            }
          }
          reviewText = extractAssistantText(reviewMessages);
        } catch {
          // Review error — default to approved
          reviewText = "APPROVED (review skipped due to error)";
        }

        const verdict = parseReviewVerdict(reviewText);
        const phaseDuration = Date.now() - phaseStart;

        if (verdict.approved) {
          // Phase approved — accumulate costs from prior rejected attempts
          logMsg("info", `Phase ${phase.phase_number} APPROVED`);
          const phaseTotalCost = (phase.cost_usd || 0) + phaseResult.totalCostUsd;
          const phaseTotalTurns = (phase.num_turns || 0) + phaseResult.numTurns;
          const phaseTotalDuration = (phase.duration_ms || 0) + phaseDuration;
          pp.updatePhase(phase.id, {
            status: "completed",
            phase_summary: summaryText,
            cost_usd: phaseTotalCost,
            num_turns: phaseTotalTurns,
            duration_ms: phaseTotalDuration,
            completed_at: new Date().toISOString(),
          });

          // Update project counters — use accumulated phase totals (includes prior retries)
          const completedCount = (project.completed_phases || 0) + 1;
          pp.updateProject(projectId, {
            completed_phases: completedCount,
            total_cost_usd: (project.total_cost_usd || 0) + phaseTotalCost,
            total_turns: (project.total_turns || 0) + phaseTotalTurns,
            total_duration_ms: (project.total_duration_ms || 0) + phaseTotalDuration,
          });

          project = pp.getProject(projectId)!;
        } else {
          // Phase rejected
          if (phase.attempt < phase.max_attempts) {
            logMsg("warning", `Phase ${phase.phase_number} REJECTED (attempt ${phase.attempt}/${phase.max_attempts})`);
            pp.updatePhase(phase.id, {
              status: "pending",
              attempt: phase.attempt + 1,
              cost_usd: (phase.cost_usd || 0) + phaseResult.totalCostUsd,
              num_turns: (phase.num_turns || 0) + phaseResult.numTurns,
              duration_ms: (phase.duration_ms || 0) + phaseDuration,
            });
            lastRetryFeedback = verdict.feedback;
          } else {
            logMsg("error", `Phase ${phase.phase_number} REJECTED — max retries exhausted`);
            // Accumulate totals from all attempts (including this one)
            const phaseTotalCost = (phase.cost_usd || 0) + phaseResult.totalCostUsd;
            const phaseTotalTurns = (phase.num_turns || 0) + phaseResult.numTurns;
            const phaseTotalDuration = (phase.duration_ms || 0) + phaseDuration;
            pp.updatePhase(phase.id, {
              status: "failed",
              error_message: `Failed after ${phase.max_attempts} attempts: ${verdict.feedback.slice(0, 200)}`,
              cost_usd: phaseTotalCost,
              num_turns: phaseTotalTurns,
              duration_ms: phaseTotalDuration,
              completed_at: new Date().toISOString(),
            });

            pp.updateProject(projectId, {
              status: "failed",
              error_message: `Phase ${phase.phase_number} failed after ${phase.max_attempts} attempts`,
              total_cost_usd: (project.total_cost_usd || 0) + phaseTotalCost,
              total_turns: (project.total_turns || 0) + phaseTotalTurns,
              total_duration_ms: (project.total_duration_ms || 0) + phaseTotalDuration,
            });

            costTracker.setAgentStatus("ceo", "error");
            break;
          }
        }
      } catch (phaseError) {
        // Phase execution threw unexpectedly — mark phase as failed so it
        // doesn't stay orphaned in "executing" status forever.
        const phaseDuration = Date.now() - phaseStart;
        const errorMsg = phaseError instanceof Error ? phaseError.message : String(phaseError);
        logMsg("error", `Phase ${phase.phase_number} error: ${errorMsg}`);

        pp.updatePhase(phase.id, {
          status: "failed",
          error_message: errorMsg,
          completed_at: new Date().toISOString(),
          duration_ms: (phase.duration_ms || 0) + phaseDuration,
        });

        pp.updateProject(projectId, {
          status: "failed",
          error_message: `Phase ${phase.phase_number} error: ${errorMsg}`,
          total_cost_usd: (project.total_cost_usd || 0) + (phase.cost_usd || 0),
          total_turns: (project.total_turns || 0) + (phase.num_turns || 0),
          total_duration_ms: (project.total_duration_ms || 0) + (phase.duration_ms || 0) + phaseDuration,
        });

        costTracker.setAgentStatus("ceo", "error");
        break;
      }

      // Get next phase
      phase = pp.getNextPendingPhase(projectId);
    }

    // ── Completion ─────────────────────────────────────────────────
    project = pp.getProject(projectId)!;
    if (project.status === "executing") {
      // All phases completed — don't overwrite total_duration_ms (keep accumulated phase durations)
      pp.updateProject(projectId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      logMsg("info", `Project completed: ${project.completed_phases}/${project.total_phases} phases, $${project.total_cost_usd.toFixed(4)}`);

      // Generate journal entry (best-effort)
      try {
        await generateJournalEntry(
          sdkSessionId,
          project.original_brief,
          {
            sessionId: sdkSessionId,
            totalCostUsd: project.total_cost_usd,
            inputTokens: 0,
            outputTokens: 0,
            numTurns: project.total_turns,
            durationMs: project.total_duration_ms,
          },
          projectDir,
          costTracker,
          sessionId
        );
        logMsg("info", "Journal entry saved");
      } catch {
        logMsg("warning", "Failed to generate journal entry");
      }

      costTracker.setAgentStatus("ceo", "idle");
    }

    // Map project status → job status. "paused" maps to "completed" in the job
    // table because the job itself finished normally — the project can be resumed
    // later by a new job. Only "failed" projects produce failed jobs.
    costTracker.updateBackgroundJob(jobId, {
      status: project.status === "completed" ? "completed" : project.status === "paused" ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      total_cost_usd: project.total_cost_usd,
      num_turns: project.total_turns,
      duration_ms: Date.now() - startTime,
      result_summary: `Project ${project.status}: ${project.completed_phases}/${project.total_phases} phases`,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logMsg("error", errorMsg);

    try { costTracker.setAgentStatus("ceo", "error"); } catch { /* best-effort */ }

    pp.updateProject(projectId, {
      status: "failed",
      error_message: errorMsg,
    });

    costTracker.updateBackgroundJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: errorMsg,
    });
  } finally {
    pp.close();
  }
}

/**
 * Run an event brief — facilitates a company event and processes the output.
 * Detects [EVENT::<event_id>::<instance_id>] prefix in the directive.
 */
async function runEventBrief(
  jobId: number,
  eventId: number,
  directive: string,
  projectDir: string,
  sdkSessionId: string,
  sessionId: string,
  config: AicibConfig,
  costTracker: CostTracker
): Promise<void> {
  const startTime = Date.now();
  const eventsConfig = (config.extensions?.events as EventConfig | undefined) ?? EVENTS_CONFIG_DEFAULTS;
  let em: EventManager | undefined;
  let nm: NotificationManager | undefined;

  try {
    em = new EventManager(projectDir);
    const event = em.getEvent(eventId);
    if (!event) {
      throw new Error(`Event #${eventId} not found`);
    }

    // Resolve participants and create instance
    let participantsConfig: ParticipantsConfig;
    try {
      participantsConfig = JSON.parse(event.participants_config);
    } catch {
      participantsConfig = { mode: "all" };
    }
    const participants = em.resolveParticipants(participantsConfig, projectDir, config);
    const instance = em.createInstance(eventId, participants);

    // Generate agenda and update instance
    const agenda = em.generateAgenda(event, participants, projectDir);
    em.updateInstance(instance.id, {
      status: "in_progress",
      agenda,
      started_at: new Date().toISOString(),
    });

    // Build the full directive with event context
    const eventDirective = em.buildEventDirective(event, {
      ...instance,
      agenda,
    });

    costTracker.setAgentStatus("ceo", "working", `Event: ${event.name}`);

    const eventMessages: EngineMessage[] = [];
    const result = await sendBrief(
      sdkSessionId,
      eventDirective,
      projectDir,
      config,
      (msg) => {
        eventMessages.push(msg);
        createMessageCallback(jobId, costTracker, `[EVENT:${event.name}]`)(msg);
      }
    );

    recordRunCosts(result, costTracker, sessionId, "ceo", config.agents.ceo?.model || "opus");

    // Extract assistant text for minutes
    const durationMs = Date.now() - startTime;
    const outputText = extractAssistantText(eventMessages);

    // Format minutes
    const minutes = em.formatMinutes(event, instance.id, outputText, eventsConfig.minutes_format);

    // Extract action items
    const actionItems = em.extractActionItems(outputText);

    // Update instance with results
    em.updateInstance(instance.id, {
      status: "completed",
      minutes,
      action_items: JSON.stringify(actionItems),
      summary: outputText.slice(0, 500),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      cost_usd: result.totalCostUsd,
    });

    // Update event counters
    em.updateEvent(eventId, {
      last_run_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      run_count: event.run_count + 1,
      next_run_at: event.cron_expression
        ? em.computeNextRun(event.cron_expression)
        : null,
    });

    // Create notifications for participants
    nm = new NotificationManager(projectDir);
    for (const participant of participants) {
      nm.createNotification({
        title: `${event.name} completed`,
        body: `Meeting minutes and ${actionItems.length} action items are available.`,
        urgency: "medium",
        category: "event_output",
        target_agent: participant,
        event_id: eventId,
        source_agent: "system",
      });
    }

    // Create tasks for action items if enabled
    if (eventsConfig.auto_create_action_items && actionItems.length > 0) {
      let tm: TaskManager | undefined;
      try {
        tm = new TaskManager(projectDir);
        for (const item of actionItems) {
          const task = tm.createTask({
            title: `[Event Action] ${item.description}`,
            description: `From ${event.name}: ${item.description}`,
            assignee: item.assignee,
            priority: "medium",
            created_by: "system",
            session_id: sessionId,
            deadline: item.deadline || undefined,
          });
          item.task_id = task.id;
        }
        // Write enriched action items (with task_ids) back to instance
        em!.updateInstance(instance.id, {
          action_items: JSON.stringify(actionItems),
        });
      } catch {
        // Task creation is best-effort
      } finally {
        tm?.close();
      }
    }

    costTracker.setAgentStatus("ceo", "idle");

    costTracker.updateBackgroundJob(jobId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      total_cost_usd: result.totalCostUsd,
      num_turns: result.numTurns,
      duration_ms: durationMs,
      result_summary: `Event "${event.name}" completed: ${actionItems.length} action items`,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    costTracker.logBackgroundMessage(jobId, "error", "system", `[EVENT] ${errorMsg}`);
    try { costTracker.setAgentStatus("ceo", "error"); } catch { /* best-effort */ }

    costTracker.updateBackgroundJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      error_message: errorMsg,
    });
  } finally {
    em?.close();
    nm?.close();
  }
}

async function main(): Promise<void> {
  const [, , jobIdStr, projectDir, sdkSessionId] = process.argv;

  if (!jobIdStr || !projectDir || !sdkSessionId) {
    process.stderr.write(
      "Usage: background-worker.js <jobId> <projectDir> <sdkSessionId>\n"
    );
    process.exit(1);
  }

  const jobId = Number(jobIdStr);
  const costTracker = new CostTracker(projectDir);

  // Read directive from DB — avoids OS arg-length limits
  const job = costTracker.getBackgroundJob(jobId);
  if (!job) {
    process.stderr.write(`Job #${jobId} not found in database\n`);
    costTracker.close();
    process.exit(1);
  }
  const directive = job.directive;

  // Record this process's PID so the CLI can check liveness / kill it
  costTracker.updateBackgroundJob(jobId, { pid: process.pid });

  // Set CEO status to working
  costTracker.setAgentStatus("ceo", "working", directive.slice(0, 100));

  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    costTracker.updateBackgroundJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: `Config load failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    costTracker.close();
    process.exit(1);
  }

  // Strip optional [SCHEDULED::N] prefix added by scheduler-daemon
  const stripped = directive.replace(/^\[SCHEDULED::\d+\]\s*/, "");

  // Detect project mode: directive starts with [PROJECT::<id>]
  const projectMatch = stripped.match(/^\[PROJECT::(\d+)\]\s*(.*)/s);
  // Detect event mode: directive starts with [EVENT::<event_id>::<instance_id>]
  const eventMatch = stripped.match(/^\[EVENT::(\d+)::(\d+)\]\s*(.*)/s);

  try {
    if (projectMatch) {
      const projectId = parseInt(projectMatch[1], 10);
      await runProjectLoop(jobId, projectId, projectDir, sdkSessionId, job.session_id, config, costTracker);
    } else if (eventMatch) {
      const eventId = parseInt(eventMatch[1], 10);
      await runEventBrief(jobId, eventId, stripped, projectDir, sdkSessionId, job.session_id, config, costTracker);
    } else {
      await runSingleBrief(jobId, directive, projectDir, sdkSessionId, job.session_id, config, costTracker);
    }
  } finally {
    try { costTracker.close(); } catch { /* best-effort */ }
  }
}

main().catch((err) => {
  process.stderr.write(`Background worker fatal error: ${err}\n`);
  process.exit(1);
});
