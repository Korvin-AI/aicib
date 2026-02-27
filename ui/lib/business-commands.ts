import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getBusinessHealth } from "./business-context";

export const VALID_TEMPLATES = ["saas-startup"] as const;
export const VALID_PERSONAS = [
  "professional",
  "startup",
  "technical",
  "creative",
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyConfigOverrides(
  configPath: string,
  agents?: Record<string, { enabled: boolean; model: string }>,
  settings?: { cost_limit_daily?: number; cost_limit_monthly?: number }
): void {
  if (!fs.existsSync(configPath)) return;
  if (!agents && !settings) return;

  let config = fs.readFileSync(configPath, "utf-8");

  if (settings) {
    if (typeof settings.cost_limit_daily === "number") {
      config = config.replace(
        /cost_limit_daily:\s*\d+\.?\d*/,
        `cost_limit_daily: ${settings.cost_limit_daily}`
      );
    }
    if (typeof settings.cost_limit_monthly === "number") {
      config = config.replace(
        /cost_limit_monthly:\s*\d+\.?\d*/,
        `cost_limit_monthly: ${settings.cost_limit_monthly}`
      );
    }
  }

  if (agents) {
    for (const [role, agentConfig] of Object.entries(agents)) {
      if (!agentConfig?.model) continue;
      const escapedRole = escapeRegex(role);
      const model = agentConfig.model;

      const execPattern = new RegExp(`(${escapedRole}:\\s*\\n\\s*model:\\s*)\\S+`);
      config = config.replace(execPattern, `$1${model}`);

      const workerPattern = new RegExp(
        `(-\\s+${escapedRole}:\\s*\\n\\s+model:\\s*)\\S+`
      );
      config = config.replace(workerPattern, `$1${model}`);
    }
  }

  fs.writeFileSync(configPath, config, "utf-8");
}

export function runInitCommand(input: {
  projectDir: string;
  companyName: string;
  template: string;
  persona: string;
  agents?: Record<string, { enabled: boolean; model: string }>;
  settings?: { cost_limit_daily?: number; cost_limit_monthly?: number };
}): { success: boolean; error?: string } {
  fs.mkdirSync(input.projectDir, { recursive: true });

  const init = spawnSync(
    "npx",
    [
      "aicib",
      "init",
      "-t",
      input.template,
      "-n",
      input.companyName,
      "--persona",
      input.persona,
      "-d",
      input.projectDir,
    ],
    {
      cwd: input.projectDir,
      timeout: 120000,
      encoding: "utf-8",
    }
  );

  if (init.status !== 0) {
    return {
      success: false,
      error:
        init.stderr?.trim() || init.stdout?.trim() || "Initialization failed",
    };
  }

  const configPath = path.join(input.projectDir, "aicib.config.yaml");
  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      error: "Initialization completed but config file was not created",
    };
  }

  applyConfigOverrides(configPath, input.agents, input.settings);
  return { success: true };
}

export function startBusinessDetached(projectDir: string): {
  success: boolean;
  pid: number | null;
  alreadyRunning?: boolean;
  message?: string;
} {
  const health = getBusinessHealth(projectDir);
  if (health.sessionActive) {
    return {
      success: true,
      pid: null,
      alreadyRunning: true,
      message: "Business is already running",
    };
  }

  const child = spawn("npx", ["aicib", "start", "-d", projectDir], {
    detached: true,
    stdio: "ignore",
    cwd: projectDir,
  });

  const pid = child.pid ?? null;
  child.unref();

  return {
    success: true,
    pid,
    alreadyRunning: false,
    message: "Start command queued",
  };
}

export function stopBusinessSync(projectDir: string): {
  success: boolean;
  message: string;
} {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const healthBefore = getBusinessHealth(projectDir);
    if (!healthBefore.sessionActive) {
      return {
        success: true,
        message: "No active session was running for this business.",
      };
    }

    const stop = spawnSync("npx", ["aicib", "stop", "-d", projectDir], {
      cwd: projectDir,
      timeout: 120000,
      encoding: "utf-8",
    });

    if (stop.status !== 0) {
      return {
        success: false,
        message:
          stop.stderr?.trim() || stop.stdout?.trim() || "Stop command failed",
      };
    }

    const healthAfter = getBusinessHealth(projectDir);
    if (!healthAfter.sessionActive) {
      return {
        success: true,
        message: "Business stopped successfully.",
      };
    }
  }

  return {
    success: false,
    message:
      "Stop command completed, but one or more sessions are still marked active.",
  };
}
