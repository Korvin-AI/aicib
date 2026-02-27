import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CostTracker, type BackgroundJob } from "./cost-tracker.js";
import type { AicibConfig } from "./config.js";
import { ProjectPlanner } from "./project-planner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Checks whether a given OS process ID is still alive.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't actually kill
    return true;
  } catch {
    return false;
  }
}

export interface BackgroundBriefResult {
  jobId: number;
  pid: number;
}

/**
 * Creates a background_jobs row and spawns a detached worker process that
 * calls sendBrief() independently. The CLI returns immediately.
 */
export function startBackgroundBrief(
  directive: string,
  projectDir: string,
  _config: AicibConfig,
  sdkSessionId: string,
  sessionId: string,
  costTracker: CostTracker
): BackgroundBriefResult {
  // Create the DB record first
  const jobId = costTracker.createBackgroundJob(sessionId, directive);

  // Resolve the compiled worker script path (dist/core/background-worker.js)
  const workerScript = path.join(__dirname, "background-worker.js");

  // Spawn a fully detached child process
  const child = spawn(
    process.execPath, // node binary
    [workerScript, String(jobId), projectDir, sdkSessionId],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env }, // inherit ANTHROPIC_API_KEY etc.
    }
  );

  if (child.pid === undefined) {
    costTracker.updateBackgroundJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: "Failed to spawn worker process (pid undefined)",
    });
    throw new Error("Failed to spawn background worker process");
  }

  const pid = child.pid;
  child.unref(); // allow parent to exit without waiting for child

  // Record the PID (worker also sets it, but this is immediate)
  costTracker.updateBackgroundJob(jobId, { pid });

  return { jobId, pid };
}

export interface BackgroundProjectResult {
  projectId: number;
  jobId: number;
  pid: number;
}

/**
 * Creates a project record, a background_jobs row with [PROJECT::<id>] prefix,
 * and spawns a detached worker process. The worker auto-detects project mode.
 */
export function startBackgroundProject(
  brief: string,
  projectDir: string,
  _config: AicibConfig,
  sdkSessionId: string,
  sessionId: string,
  costTracker: CostTracker
): BackgroundProjectResult {
  // Create the project record
  const pp = new ProjectPlanner(projectDir);
  let projectId: number;
  try {
    // Use first 80 chars of brief as title
    const title = brief.length > 80 ? brief.slice(0, 77) + "..." : brief;
    const project = pp.createProject(sessionId, title, brief);
    projectId = project.id;
  } finally {
    pp.close();
  }

  // Create background job with [PROJECT::<id>] prefixed directive
  const directive = `[PROJECT::${projectId}] ${brief}`;
  const { jobId, pid } = startBackgroundBrief(
    directive,
    projectDir,
    _config,
    sdkSessionId,
    sessionId,
    costTracker
  );

  return { projectId, jobId, pid };
}

/**
 * Kills a running background worker and marks the job as failed.
 * Sends SIGTERM first, then SIGKILL after 3 seconds if still alive.
 */
export function killBackgroundJob(
  job: BackgroundJob,
  costTracker: CostTracker,
  reason: string = "Stopped by user"
): boolean {
  if (job.pid && isProcessRunning(job.pid)) {
    try {
      // Try graceful shutdown first
      process.kill(job.pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }

    // Force kill after 3 seconds if still alive
    const pid = job.pid;
    setTimeout(() => {
      try {
        if (isProcessRunning(pid)) {
          process.kill(pid, "SIGKILL");
        }
      } catch {
        // Process already gone
      }
    }, 3000).unref();
  }

  // Only overwrite status if the job is still running — avoids clobbering
  // a "completed" status that the worker set just before we got here.
  const current = costTracker.getBackgroundJob(job.id);
  if (current && current.status === "running") {
    costTracker.updateBackgroundJob(job.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: reason,
    });
  }

  return true;
}
