/**
 * CLI commands for the Cloud Agent daemon: start, stop, status, configure.
 *
 * Pattern follows src/cli/schedule.ts (daemon spawn/stop).
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import inquirer from "inquirer";

import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { isProcessRunning } from "../core/background-manager.js";
import { header, formatTimeAgo } from "./ui.js";
import {
  getCloudAgentDb,
  getStateValue,
  setStateValue,
  CLOUD_AGENT_STATE_KEYS,
} from "../core/cloud-agent-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Types ---

interface CloudAgentOptions {
  dir: string;
}

interface CloudAgentConfig {
  api_url: string;
  api_key: string;
  poll_interval_seconds: number;
}

// --- Start ---

export async function cloudAgentStartCommand(
  options: CloudAgentOptions,
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Starting Cloud Agent Daemon"));

  // Check if already running
  const db = getCloudAgentDb(projectDir);
  try {
    const pidStr = getStateValue(db, CLOUD_AGENT_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;

    if (pid && isProcessRunning(pid)) {
      console.log(
        chalk.yellow(`  Cloud agent daemon already running (PID ${pid}).\n`),
      );
      return;
    }
  } finally {
    db.close();
  }

  // Validate cloud agent config exists
  let config;
  try {
    config = loadConfig(projectDir);
  } catch (err) {
    console.error(
      chalk.red(
        `  Error loading config: ${err instanceof Error ? err.message : String(err)}\n`,
      ),
    );
    process.exit(1);
  }

  const cloudConfig = (config.extensions?.cloud_agent || {}) as CloudAgentConfig;
  if (!cloudConfig.api_url || !cloudConfig.api_key) {
    console.error(
      chalk.red(
        "  Error: Cloud agent not configured. Run 'aicib cloud-agent configure' first.\n",
      ),
    );
    process.exit(1);
  }

  // Ensure DB tables exist by constructing CostTracker (triggers registerTable hooks)
  const costTracker = new CostTracker(projectDir);
  costTracker.close();

  // Spawn daemon
  const daemonScript = path.resolve(
    __dirname,
    "..",
    "core",
    "cloud-agent.js",
  );

  const child = spawn(process.execPath, [daemonScript, projectDir], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  if (child.pid === undefined) {
    console.error(
      chalk.red("  Error: Failed to start cloud agent daemon.\n"),
    );
    process.exit(1);
  }

  child.unref();

  // Wait for daemon to confirm running (up to 5s)
  const checkDb = getCloudAgentDb(projectDir);
  const deadline = Date.now() + 5_000;
  let started = false;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const state = getStateValue(
        checkDb,
        CLOUD_AGENT_STATE_KEYS.CONNECTION_STATE,
      );
      if (state === "running") {
        started = true;
        break;
      }
      if (state === "error") break;
    }
  } finally {
    checkDb.close();
  }

  if (started) {
    console.log(
      chalk.green(`  Cloud agent daemon started (PID ${child.pid}).\n`),
    );
  } else {
    console.log(
      chalk.yellow("  Cloud agent daemon started but hasn't confirmed yet."),
    );
    console.log(chalk.yellow("  Check: aicib cloud-agent status\n"));
  }
}

// --- Stop ---

export async function cloudAgentStopCommand(
  options: CloudAgentOptions,
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Stopping Cloud Agent Daemon"));

  const db = getCloudAgentDb(projectDir);
  try {
    const pidStr = getStateValue(db, CLOUD_AGENT_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;

    if (!pid || !isProcessRunning(pid)) {
      console.log(chalk.dim("  Cloud agent daemon is not running.\n"));
      setStateValue(db, CLOUD_AGENT_STATE_KEYS.DAEMON_PID, "");
      setStateValue(db, CLOUD_AGENT_STATE_KEYS.CONNECTION_STATE, "stopped");
      return;
    }

    console.log(chalk.dim(`  Stopping daemon (PID ${pid})...`));

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }

    // Wait up to 5 seconds for graceful shutdown
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!isProcessRunning(pid)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (isProcessRunning(pid)) {
      console.log(
        chalk.yellow(
          "  Warning: Daemon didn't stop gracefully. Force killing...",
        ),
      );
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }

    // Update state
    setStateValue(db, CLOUD_AGENT_STATE_KEYS.DAEMON_PID, "");
    setStateValue(db, CLOUD_AGENT_STATE_KEYS.CONNECTION_STATE, "stopped");
    setStateValue(db, CLOUD_AGENT_STATE_KEYS.CURRENT_JOB_ID, "");

    console.log(chalk.green("  Cloud agent daemon stopped.\n"));
  } finally {
    db.close();
  }
}

// --- Status ---

export async function cloudAgentStatusCommand(
  options: CloudAgentOptions,
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Cloud Agent Status"));

  const db = getCloudAgentDb(projectDir);
  try {
    const connState =
      getStateValue(db, CLOUD_AGENT_STATE_KEYS.CONNECTION_STATE) || "stopped";
    const pidStr = getStateValue(db, CLOUD_AGENT_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;
    const heartbeat = getStateValue(
      db,
      CLOUD_AGENT_STATE_KEYS.DAEMON_HEARTBEAT,
    );
    const currentJob = getStateValue(
      db,
      CLOUD_AGENT_STATE_KEYS.CURRENT_JOB_ID,
    );
    const lastPoll = getStateValue(db, CLOUD_AGENT_STATE_KEYS.LAST_POLL_AT);
    const lastError = getStateValue(db, CLOUD_AGENT_STATE_KEYS.LAST_ERROR);

    const daemonAlive = pid ? isProcessRunning(pid) : false;
    const effectiveState = daemonAlive
      ? connState
      : pid
        ? "daemon crashed"
        : connState;

    const statusText =
      effectiveState === "running"
        ? chalk.green("RUNNING")
        : effectiveState === "daemon crashed"
          ? chalk.red("CRASHED")
          : chalk.dim("STOPPED");

    console.log(`  Daemon:      ${statusText}`);
    if (pid && daemonAlive) {
      console.log(`  PID:         ${pid}`);
    }
    if (heartbeat) {
      console.log(`  Heartbeat:   ${formatTimeAgo(heartbeat)}`);
    }
    if (currentJob && currentJob !== "") {
      console.log(`  Current Job: #${currentJob}`);
    }
    if (lastPoll) {
      console.log(`  Last Poll:   ${formatTimeAgo(lastPoll)}`);
    }
    if (lastError) {
      console.log(`  Last Error:  ${chalk.red(lastError)}`);
    }

    // Check if stale heartbeat (> 2 minutes old)
    if (heartbeat && daemonAlive) {
      const age = Date.now() - new Date(heartbeat).getTime();
      if (age > 120_000) {
        console.log(
          chalk.yellow(
            "  Warning: Heartbeat is stale (>2 min). Daemon may be hung.",
          ),
        );
      }
    }

    // Show config summary
    try {
      const config = loadConfig(projectDir);
      const cloudConfig = (config.extensions?.cloud_agent ||
        {}) as CloudAgentConfig;
      if (cloudConfig.api_url) {
        console.log(`\n  Config:`);
        console.log(`    API URL:        ${cloudConfig.api_url}`);
        console.log(
          `    API Key:        ${cloudConfig.api_key ? cloudConfig.api_key.slice(0, 8) + "..." : "Not set"}`,
        );
        console.log(
          `    Poll interval:  ${cloudConfig.poll_interval_seconds || 5}s`,
        );
      }
    } catch {
      // Config not loaded — skip
    }

    // Hints
    if (effectiveState === "daemon crashed") {
      console.log(
        chalk.yellow(
          "\n  The cloud agent daemon has crashed. Restart with: aicib cloud-agent start",
        ),
      );
    } else if (effectiveState === "stopped") {
      console.log(chalk.dim("\n  Start with: aicib cloud-agent start"));
    }

    console.log();
  } finally {
    db.close();
  }
}

// --- Configure ---

export async function cloudAgentConfigureCommand(
  options: CloudAgentOptions,
): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Configure Cloud Agent"));

  // Load existing config to show defaults
  let existingConfig: CloudAgentConfig = {
    api_url: "",
    api_key: "",
    poll_interval_seconds: 5,
  };

  try {
    const config = loadConfig(projectDir);
    existingConfig = {
      ...existingConfig,
      ...((config.extensions?.cloud_agent || {}) as Partial<CloudAgentConfig>),
    };
  } catch {
    // No config yet — fine
  }

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "api_url",
      message: "Cloud API URL:",
      default: existingConfig.api_url || "https://api.aicib.com",
      validate: (input: string) => {
        if (!input.trim()) return "API URL is required";
        try {
          new URL(input.trim());
          return true;
        } catch {
          return "Invalid URL";
        }
      },
    },
    {
      type: "password",
      name: "api_key",
      message: "API Key:",
      default: existingConfig.api_key,
      validate: (input: string) =>
        input.trim() ? true : "API key is required",
    },
    {
      type: "number",
      name: "poll_interval_seconds",
      message: "Poll interval (seconds):",
      default: existingConfig.poll_interval_seconds || 5,
      validate: (input: number) => {
        if (input < 1 || input > 300)
          return "Poll interval must be 1-300 seconds";
        return true;
      },
    },
  ]);

  // Validate connectivity
  const apiUrl = answers.api_url.trim().replace(/\/+$/, "");
  console.log(chalk.dim("  Validating connectivity..."));

  try {
    const resp = await fetch(`${apiUrl}/health`, {
      headers: { Authorization: `Bearer ${answers.api_key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      console.log(chalk.green("  Connected successfully!"));
    } else {
      console.log(
        chalk.yellow(`  Warning: Health check returned ${resp.status}.`),
      );
    }
  } catch (err) {
    console.log(
      chalk.yellow(
        `  Warning: Could not reach API: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  // Save to aicib.config.yaml using js-yaml for safe serialization
  const fs = await import("node:fs");
  const yaml = await import("js-yaml");
  const configPath = path.join(projectDir, "aicib.config.yaml");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    parsed = (yaml.load(raw) as Record<string, unknown>) ?? {};
  } catch {
    // No config file yet — start fresh
  }

  parsed.cloud_agent = {
    api_url: apiUrl,
    api_key: answers.api_key,
    poll_interval_seconds: answers.poll_interval_seconds,
  };

  fs.writeFileSync(configPath, yaml.dump(parsed, { lineWidth: 120 }), "utf-8");

  console.log(chalk.green("\n  Configuration saved to aicib.config.yaml"));
  console.log(
    chalk.dim("  Start the daemon with: aicib cloud-agent start\n"),
  );
}
