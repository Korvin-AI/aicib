/**
 * CLI commands for Slack integration: connect, disconnect, status.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import inquirer from "inquirer";
import { WebClient } from "@slack/web-api";

import { loadConfig, saveConfig } from "../core/config.js";
import { CostTracker } from "../core/cost-tracker.js";
import { isProcessRunning } from "../core/background-manager.js";
import { header, formatTimeAgo, createTable } from "./ui.js";
import type { SlackConfig, ChannelMapping } from "../integrations/slack/types.js";
import { SLACK_STATE_KEYS, SLACK_CONFIG_DEFAULTS, CHANNEL_SUFFIXES } from "../integrations/slack/types.js";
import { ensureChannels, saveChannelMappings, loadChannelMappings } from "../integrations/slack/channel-mapper.js";
import { getSlackDb, getStateValue, setStateValue } from "../integrations/slack/state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Connect command ---

interface SlackOptions {
  dir: string;
}

export async function slackConnectCommand(options: SlackOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  // Load config to ensure project is initialized
  let config;
  try {
    config = loadConfig(projectDir);
  } catch (error) {
    console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  console.log(header("Slack Integration Setup"));

  // Step 1: Instructions
  console.log(chalk.bold("  Step 1: Create a Slack App\n"));
  console.log("  If you haven't already, create a Slack App:");
  console.log(chalk.cyan("  https://api.slack.com/apps\n"));
  console.log("  Required setup:");
  console.log("    1. Create a new app → From scratch");
  console.log("    2. Enable Socket Mode (Settings → Socket Mode → Enable)");
  console.log("    3. Generate an App-Level Token with connections:write scope");
  console.log("    4. Add Bot Token Scopes (OAuth & Permissions):");
  console.log("       channels:manage, channels:read, channels:history,");
  console.log("       chat:write, chat:write.customize, reactions:read,");
  console.log("       reactions:write, commands (if using /aicib slash command)");
  console.log("    5. Enable Event Subscriptions (Event Subscriptions → On):");
  console.log("       Subscribe to bot event: message.channels");
  console.log("    6. Install the app to your workspace");
  console.log("    7. Copy the Bot User OAuth Token (xoxb-...)\n");

  // Step 2: Collect tokens
  console.log(chalk.bold("  Step 2: Enter tokens\n"));

  const { appToken } = await inquirer.prompt([
    {
      type: "password",
      name: "appToken",
      message: "App-Level Token (xapp-...):",
      validate: (input: string) => {
        if (!input.startsWith("xapp-")) {
          return "Token must start with 'xapp-'. Find it in Settings → Basic Information → App-Level Tokens.";
        }
        return true;
      },
    },
  ]);

  const { botToken } = await inquirer.prompt([
    {
      type: "password",
      name: "botToken",
      message: "Bot User OAuth Token (xoxb-...):",
      validate: (input: string) => {
        if (!input.startsWith("xoxb-")) {
          return "Token must start with 'xoxb-'. Find it in OAuth & Permissions → Bot User OAuth Token.";
        }
        return true;
      },
    },
  ]);

  // Step 3: Test connection
  console.log(chalk.dim("\n  Testing connection..."));
  const client = new WebClient(botToken);

  let teamId = "";
  let teamName = "";
  try {
    const authResult = await client.auth.test();
    if (!authResult.ok) {
      throw new Error("Auth test failed");
    }
    teamId = authResult.team_id || "";
    teamName = authResult.team || "";
    console.log(chalk.green(`  Connected to workspace: ${teamName}\n`));
  } catch (error) {
    console.error(chalk.red(`  Error: Failed to connect to Slack.`));
    console.error(chalk.yellow(`  ${error instanceof Error ? error.message : String(error)}`));
    console.error(chalk.yellow("  Check your tokens and try again.\n"));
    process.exit(1);
  }

  // Step 4: Create channels
  console.log(chalk.bold("  Step 3: Setting up channels\n"));

  const slackConfig: SlackConfig = {
    ...SLACK_CONFIG_DEFAULTS,
    enabled: true,
  };

  const { prefix } = await inquirer.prompt([
    {
      type: "input",
      name: "prefix",
      message: "Channel prefix (channels will be #<prefix>-ceo, #<prefix>-engineering, etc.):",
      default: SLACK_CONFIG_DEFAULTS.channel_prefix,
      validate: (input: string) => {
        if (!/^[a-z0-9-]+$/.test(input)) {
          return "Must be lowercase letters, numbers, and hyphens only.";
        }
        return true;
      },
    },
  ]);

  slackConfig.channel_prefix = prefix;

  console.log(chalk.dim(`\n  Creating channels: ${CHANNEL_SUFFIXES.map(s => `#${prefix}-${s}`).join(", ")}\n`));

  let channelMappings: Map<string, ChannelMapping>;
  try {
    channelMappings = await ensureChannels(client, slackConfig);
  } catch (error) {
    console.error(chalk.red(`  Error creating channels: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  if (channelMappings.size === 0) {
    console.error(chalk.red("  Error: No channels could be created or found."));
    console.error(chalk.yellow("  Create them manually and re-run this command.\n"));
    process.exit(1);
  }

  // Step 5: Save tokens to SQLite and config to YAML
  console.log(chalk.dim("  Saving configuration...\n"));

  // Initialize CostTracker to ensure tables exist (triggers registerTable hooks)
  const costTracker = new CostTracker(projectDir);
  const db = getSlackDb(projectDir);

  try {
    setStateValue(db, SLACK_STATE_KEYS.BOT_TOKEN, botToken);
    setStateValue(db, SLACK_STATE_KEYS.APP_TOKEN, appToken);
    setStateValue(db, SLACK_STATE_KEYS.TEAM_ID, teamId);
    setStateValue(db, SLACK_STATE_KEYS.TEAM_NAME, teamName);

    // Save channel mappings
    saveChannelMappings(db, channelMappings);

    // Save non-secret config to YAML
    config.extensions.slack = { ...slackConfig };
    saveConfig(projectDir, config);
  } finally {
    db.close();
    costTracker.close();
  }

  // Step 6: Spawn daemon
  console.log(chalk.bold("  Step 4: Starting Slack bot\n"));

  const daemonScript = path.resolve(__dirname, "..", "integrations", "slack", "daemon.js");

  const child = spawn(
    process.execPath,
    [daemonScript, projectDir],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    }
  );

  if (child.pid === undefined) {
    console.error(chalk.red("  Error: Failed to start Slack daemon.\n"));
    process.exit(1);
  }

  child.unref();

  // Wait for daemon to confirm connection (up to 10s)
  const checkDb = getSlackDb(projectDir);
  const deadline = Date.now() + 10_000;
  let connected = false;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const state = getStateValue(checkDb, SLACK_STATE_KEYS.CONNECTION_STATE);
      if (state === "connected") { connected = true; break; }
      if (state === "error") { break; }
    }
  } finally {
    checkDb.close();
  }

  if (connected) {
    console.log(chalk.green("  Slack bot started and connected!\n"));
  } else {
    console.log(chalk.yellow("  Slack bot started but hasn't confirmed connection yet."));
    console.log(chalk.yellow("  Check: aicib slack status\n"));
  }

  // Summary
  const table = createTable(["Channel", "Department"]);
  for (const [suffix, mapping] of channelMappings) {
    table.push([`#${mapping.channelName}`, suffix]);
  }
  console.log(table.toString());

  console.log(chalk.bold("\n  What's next:\n"));
  console.log(`  1. In Slack, press Cmd+K (or Ctrl+K) and search for "${prefix}"`);
  console.log(`  2. Join each channel: #${prefix}-ceo, #${prefix}-engineering, etc.`);
  console.log(`     (The bot created them, but you need to join manually)`);
  console.log("  3. Start your AI company: aicib start");
  console.log(`  4. Type a message in #${prefix}-ceo to brief the CEO`);
  console.log("  5. Watch updates flow into department channels\n");
  console.log(chalk.dim("  Manage: aicib slack status | aicib slack disconnect\n"));
}

// --- Disconnect command ---

export async function slackDisconnectCommand(options: SlackOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Disconnecting Slack"));

  const db = getSlackDb(projectDir);

  try {
    const pidStr = getStateValue(db, SLACK_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;

    if (pid && isProcessRunning(pid)) {
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
        console.log(chalk.yellow("  Warning: Daemon didn't stop gracefully. Force killing..."));
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    }

    // Update state
    setStateValue(db, SLACK_STATE_KEYS.DAEMON_PID, "");
    setStateValue(db, SLACK_STATE_KEYS.CONNECTION_STATE, "disconnected");

    console.log(chalk.green("  Slack disconnected.\n"));
    console.log(chalk.dim("  Reconnect anytime: aicib slack connect\n"));
  } finally {
    db.close();
  }
}

// --- Status command ---

export async function slackStatusCommand(options: SlackOptions): Promise<void> {
  const projectDir = path.resolve(options.dir);

  console.log(header("Slack Status"));

  const db = getSlackDb(projectDir);

  try {
    const connectionState = getStateValue(db, SLACK_STATE_KEYS.CONNECTION_STATE) || "not configured";
    const pidStr = getStateValue(db, SLACK_STATE_KEYS.DAEMON_PID);
    const pid = pidStr ? Number(pidStr) : null;
    const heartbeat = getStateValue(db, SLACK_STATE_KEYS.DAEMON_HEARTBEAT);
    const teamName = getStateValue(db, SLACK_STATE_KEYS.TEAM_NAME);

    // Check if daemon is actually alive
    const daemonAlive = pid ? isProcessRunning(pid) : false;
    const effectiveState = daemonAlive ? connectionState : (pid ? "daemon crashed" : connectionState);

    // Connection status
    const statusIcon = effectiveState === "connected" ? chalk.green("CONNECTED") :
                       effectiveState === "connecting" ? chalk.yellow("CONNECTING") :
                       effectiveState === "daemon crashed" ? chalk.red("CRASHED") :
                       chalk.dim("DISCONNECTED");

    console.log(`  Status:    ${statusIcon}`);
    if (teamName) {
      console.log(`  Workspace: ${teamName}`);
    }
    if (pid && daemonAlive) {
      console.log(`  Daemon:    PID ${pid}`);
    }
    if (heartbeat) {
      console.log(`  Heartbeat: ${formatTimeAgo(heartbeat)}`);
    }

    // Channel mappings
    const mappings = loadChannelMappings(db);
    if (mappings.size > 0) {
      console.log(chalk.bold("\n  Channels:"));
      for (const mapping of mappings.values()) {
        console.log(`    #${mapping.channelName} → ${mapping.department}`);
      }
    }

    // Hints
    if (effectiveState === "daemon crashed") {
      console.log(chalk.yellow("\n  The Slack daemon has crashed. Restart with: aicib slack connect"));
    } else if (effectiveState === "disconnected" || effectiveState === "not configured") {
      console.log(chalk.dim("\n  Connect with: aicib slack connect"));
    }

    console.log();
  } finally {
    db.close();
  }
}
