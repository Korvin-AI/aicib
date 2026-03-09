#!/usr/bin/env node

/**
 * Cloud Agent daemon process — runs as a detached long-lived process.
 * Invoked as: node cloud-agent.js <projectDir>
 *
 * Polls the cloud API for pending briefs, executes them locally via
 * the admin's Claude Code subscription (zero API cost), and streams
 * results back to the cloud dashboard.
 *
 * Pattern follows src/core/scheduler-daemon.ts.
 */

// Side-effect imports: register hooks before config/DB
import "./task-register.js";
import "./intelligence-register.js";
import "./knowledge-register.js";
import "./project-register.js";
import "./routing-register.js";
import "./review-chains-register.js";
import "./scheduler-register.js";
import "./reporting-register.js";
import "./perf-review-register.js";
import "./notifications-register.js";
import "./events-register.js";
import "./cloud-agent-register.js";

import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import type { AicibConfig } from "./config.js";
import { CostTracker } from "./cost-tracker.js";
import { sendBrief } from "./agent-runner.js";
import type { SessionResult } from "./agent-runner.js";
import {
  getCloudAgentDb,
  getStateValue,
  setStateValue,
  CLOUD_AGENT_STATE_KEYS,
} from "./cloud-agent-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CloudAgentConfig {
  api_url: string;
  api_key: string;
  poll_interval_seconds: number;
}

interface PendingJob {
  jobId: number;
  businessId: string;
  orgId: string;
  sessionId: string;
  sdkSessionId: string;
  directive: string;
  companyName: string;
  costLimitDaily: number;
  // TODO: apply agentDefinitions override — currently the daemon uses local
  // agent definitions from disk. Cloud-configured per-business overrides are
  // carried in the type contract for future use.
  agentDefinitions: Array<{
    role: string;
    model?: string;
    department?: string;
    enabled?: boolean;
    displayName?: string | null;
  }>;
}

interface BufferedMessage {
  type: string;
  role: string;
  content: string;
}

interface BufferedAgentStatus {
  role: string;
  status: string;
  task?: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function cloudFetch(
  url: string,
  apiKey: string,
  options: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const { method = "GET", body, timeoutMs = 30_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Message formatting (same as brief-worker.ts)
// ---------------------------------------------------------------------------

function formatMessagePlain(message: any): string | null {
  if (message.type === "assistant") {
    const content = message.message?.content;
    if (!content) return null;

    const texts: string[] = [];
    for (const block of content) {
      if ("text" in block && block.text) {
        texts.push(block.text);
      } else if ("name" in block) {
        texts.push(`[Tool: ${block.name}]`);
      }
    }
    if (texts.length > 0) {
      const prefix = message.parent_tool_use_id ? "[SUBAGENT]" : "[CEO]";
      return `${prefix} ${texts.join("\n")}`;
    }
  }

  if (message.type === "system" && "subtype" in message) {
    if (message.subtype === "init") {
      return `[SYSTEM] Session: ${message.session_id} | Model: ${message.model}`;
    }
    if (message.subtype === "task_notification") {
      const status = message.status || "update";
      return `[TASK] ${message.task_id || "subagent"}: ${status}`;
    }
  }

  if (message.type === "result") {
    return `[RESULT] Cost: $${(message.total_cost_usd ?? 0).toFixed(4)} | Turns: ${message.num_turns ?? 0} | Duration: ${((message.duration_ms ?? 0) / 1000).toFixed(1)}s`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let currentJobId: number | null = null;
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function main(): Promise<void> {
  const [, , projectDir] = process.argv;

  if (!projectDir) {
    process.stderr.write("Usage: cloud-agent.js <projectDir>\n");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(projectDir, ".aicib", "state.db"))) {
    process.stderr.write(
      "Error: No AICIB state database found. Run 'aicib init' first.\n",
    );
    process.exit(1);
  }

  // Load config
  let config: AicibConfig;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    process.stderr.write(
      `Error loading config: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const cloudConfig = (config.extensions?.cloud_agent || {}) as CloudAgentConfig;

  if (!cloudConfig.api_url || !cloudConfig.api_key) {
    process.stderr.write(
      "Error: cloud_agent.api_url and cloud_agent.api_key are required.\n" +
        "Run 'aicib cloud-agent configure' to set them up.\n",
    );
    process.exit(1);
  }

  const pollMs = (cloudConfig.poll_interval_seconds || 5) * 1000;

  // Ensure CostTracker tables exist
  const costTracker = new CostTracker(projectDir);
  costTracker.close();

  // Open DB connection
  const db = getCloudAgentDb(projectDir);

  // Write PID + start heartbeat
  setStateValue(db, CLOUD_AGENT_STATE_KEYS.DAEMON_PID, String(process.pid));
  setStateValue(db, CLOUD_AGENT_STATE_KEYS.CONNECTION_STATE, "running");
  setStateValue(
    db,
    CLOUD_AGENT_STATE_KEYS.DAEMON_HEARTBEAT,
    new Date().toISOString(),
  );

  // Startup recovery: if previous crash left a current_job_id
  const staleJobId = getStateValue(
    db,
    CLOUD_AGENT_STATE_KEYS.CURRENT_JOB_ID,
  );
  if (staleJobId) {
    process.stderr.write(
      `Recovering from crash: posting failure for job ${staleJobId}\n`,
    );
    try {
      const resp = await cloudFetch(
        `${cloudConfig.api_url}/daemon/briefs/${staleJobId}/result`,
        cloudConfig.api_key,
        {
          method: "POST",
          body: {
            status: "failed",
            errorMessage: "Daemon crashed during execution",
          },
          timeoutMs: 15_000,
        },
      );
      if (!resp.ok) {
        process.stderr.write(
          `Crash recovery POST for job ${staleJobId} returned ${resp.status} (sweep may have already re-queued it)\n`,
        );
      }
    } catch {
      // Network error — cloud sweep will handle it
    }
    setStateValue(db, CLOUD_AGENT_STATE_KEYS.CURRENT_JOB_ID, "");
  }

  // Validate connectivity
  try {
    const resp = await cloudFetch(
      `${new URL(cloudConfig.api_url).origin}/health`,
      cloudConfig.api_key,
      { timeoutMs: 10_000 },
    );
    if (!resp.ok) {
      process.stderr.write(
        `Warning: Health check returned ${resp.status}. Continuing anyway.\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `Warning: Could not reach cloud API: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // Heartbeat timer
  heartbeatTimer = setInterval(() => {
    try {
      setStateValue(
        db,
        CLOUD_AGENT_STATE_KEYS.DAEMON_HEARTBEAT,
        new Date().toISOString(),
      );
    } catch {
      // DB may be locked — non-fatal
    }
  }, 30_000);

  // Poll timer
  pollTimer = setInterval(() => {
    pollOnce(projectDir, config, cloudConfig, db).catch((e) => {
      process.stderr.write(`Cloud agent poll error: ${e}\n`);
      try {
        setStateValue(
          db,
          CLOUD_AGENT_STATE_KEYS.LAST_ERROR,
          String(e),
        );
      } catch { /* best-effort */ }
    });
  }, pollMs);

  // Run once immediately
  pollOnce(projectDir, config, cloudConfig, db).catch((e) => {
    process.stderr.write(`Cloud agent initial poll error: ${e}\n`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pollTimer) clearInterval(pollTimer);

    // If brief in progress, attempt to POST failure
    if (currentJobId) {
      try {
        await cloudFetch(
          `${cloudConfig.api_url}/daemon/briefs/${currentJobId}/result`,
          cloudConfig.api_key,
          {
            method: "POST",
            body: {
              status: "failed",
              errorMessage: "Daemon shutting down",
            },
            timeoutMs: 5_000,
          },
        );
      } catch { /* best-effort */ }
    }

    try {
      setStateValue(db, CLOUD_AGENT_STATE_KEYS.CONNECTION_STATE, "stopped");
      setStateValue(db, CLOUD_AGENT_STATE_KEYS.DAEMON_PID, "");
      setStateValue(db, CLOUD_AGENT_STATE_KEYS.CURRENT_JOB_ID, "");
    } catch { /* best-effort */ }

    try {
      db.close();
    } catch { /* best-effort */ }

    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function pollOnce(
  projectDir: string,
  config: AicibConfig,
  cloudConfig: CloudAgentConfig,
  db: ReturnType<typeof getCloudAgentDb>,
): Promise<void> {
  // If already polling or running a brief, skip
  if (polling || currentJobId !== null) return;
  polling = true;

  try {
    await pollOnceInner(projectDir, config, cloudConfig, db);
  } finally {
    polling = false;
  }
}

async function pollOnceInner(
  projectDir: string,
  config: AicibConfig,
  cloudConfig: CloudAgentConfig,
  db: ReturnType<typeof getCloudAgentDb>,
): Promise<void> {
  setStateValue(
    db,
    CLOUD_AGENT_STATE_KEYS.LAST_POLL_AT,
    new Date().toISOString(),
  );

  const resp = await cloudFetch(
    `${cloudConfig.api_url}/daemon/briefs/claim`,
    cloudConfig.api_key,
    { method: "POST" },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Poll failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as { job: PendingJob | null };
  if (!data.job) return;

  const job = data.job;
  currentJobId = job.jobId;
  setStateValue(
    db,
    CLOUD_AGENT_STATE_KEYS.CURRENT_JOB_ID,
    String(job.jobId),
  );

  try {
    await executeBrief(job, projectDir, config, cloudConfig, db);
  } finally {
    currentJobId = null;
    setStateValue(db, CLOUD_AGENT_STATE_KEYS.CURRENT_JOB_ID, "");
  }
}

// ---------------------------------------------------------------------------
// Execute a brief locally
// ---------------------------------------------------------------------------

async function executeBrief(
  job: PendingJob,
  projectDir: string,
  config: AicibConfig,
  cloudConfig: CloudAgentConfig,
  db: ReturnType<typeof getCloudAgentDb>,
): Promise<void> {
  const startTime = Date.now();

  // Message batch buffer
  const messageBuffer: BufferedMessage[] = [];
  const statusBuffer: BufferedAgentStatus[] = [];
  const activeSubagents = new Map<string, string>();

  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (messageBuffer.length === 0 && statusBuffer.length === 0) return;

    const messages = messageBuffer.splice(0);
    const agentStatuses = statusBuffer.splice(0);

    try {
      await cloudFetch(
        `${cloudConfig.api_url}/daemon/briefs/${job.jobId}/messages`,
        cloudConfig.api_key,
        {
          method: "POST",
          body: { messages, agentStatuses },
          timeoutMs: 15_000,
        },
      );
    } catch (err) {
      process.stderr.write(
        `Message flush error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };

  const scheduleFlush = () => {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush().catch(() => {});
      }, 500);
    }
  };

  // Message callback — buffers messages and tracks subagent status
  const onMessage = (msg: any) => {
    // Track sub-agent status from Task tool_use / tool_result
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (
          typeof block === "object" &&
          block !== null &&
          block.type === "tool_use" &&
          block.name === "Task" &&
          block.id &&
          block.input
        ) {
          const agent = (
            (block.input.subagent_type as string) ||
            (block.input.agent_name as string) ||
            ""
          ).toLowerCase();
          if (agent) {
            activeSubagents.set(block.id, agent);
            statusBuffer.push({ role: agent, status: "working" });
          }
        }
      }
    }

    if (msg.type === "user" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (
          typeof block === "object" &&
          block !== null &&
          block.type === "tool_result" &&
          block.tool_use_id
        ) {
          const agent = activeSubagents.get(block.tool_use_id);
          if (agent) {
            activeSubagents.delete(block.tool_use_id);
            statusBuffer.push({ role: agent, status: "idle" });
          }
        }
      }
    }

    const formatted = formatMessagePlain(msg);
    if (formatted) {
      let role = "system";
      if (msg.type === "assistant") {
        role = msg.parent_tool_use_id
          ? activeSubagents.get(msg.parent_tool_use_id) || "subagent"
          : "ceo";
      } else if (msg.type === "result") {
        role = "system";
      }

      messageBuffer.push({ type: msg.type, role, content: formatted });

      // Flush every 10 messages or schedule 500ms timer
      if (messageBuffer.length >= 10) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flush().catch(() => {});
      } else {
        scheduleFlush();
      }
    }
  };

  let result: SessionResult;
  try {
    result = await sendBrief(
      job.sdkSessionId,
      job.directive,
      projectDir,
      config,
      onMessage,
    );
  } catch (err) {
    // Flush remaining messages
    if (flushTimer) clearTimeout(flushTimer);
    await flush();

    const errorMessage = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Brief ${job.jobId} failed: ${errorMessage}\n`);

    // POST failure result with retry
    await postResultWithRetry(cloudConfig, job.jobId, {
      status: "failed",
      errorMessage,
      durationMs: Date.now() - startTime,
    });
    return;
  }

  // Flush remaining messages
  if (flushTimer) clearTimeout(flushTimer);
  await flush();

  // POST success result with retry
  await postResultWithRetry(cloudConfig, job.jobId, {
    status: "completed",
    totalCostUsd: result.totalCostUsd,
    numTurns: result.numTurns,
    durationMs: result.durationMs,
    costEntries: [
      {
        role: "ceo",
        sessionId: result.sessionId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.totalCostUsd,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Result POST with exponential backoff retry
// ---------------------------------------------------------------------------

async function postResultWithRetry(
  cloudConfig: CloudAgentConfig,
  jobId: number,
  body: Record<string, unknown>,
  maxRetries = 3,
): Promise<void> {
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await cloudFetch(
        `${cloudConfig.api_url}/daemon/briefs/${jobId}/result`,
        cloudConfig.api_key,
        {
          method: "POST",
          body,
          timeoutMs: 120_000,
        },
      );
      if (resp.ok) return;
      process.stderr.write(
        `Result POST attempt ${attempt + 1} failed: ${resp.status}\n`,
      );
    } catch (err) {
      process.stderr.write(
        `Result POST attempt ${attempt + 1} error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  process.stderr.write(
    `Failed to POST result for job ${jobId} after ${maxRetries + 1} attempts\n`,
  );
}

// ---------------------------------------------------------------------------

main().catch((err) => {
  process.stderr.write(`Cloud agent daemon fatal error: ${err}\n`);
  process.exit(1);
});
