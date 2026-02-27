import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tryGetProjectDir } from "@/lib/config";

export const dynamic = "force-dynamic";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface InitRequestBody {
  companyName: string;
  template: string;
  persona: string;
  agents?: Record<string, { enabled: boolean; model: string }>;
  settings?: { cost_limit_daily: number; cost_limit_monthly: number };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InitRequestBody;

    // Validate required fields
    if (!body.companyName || typeof body.companyName !== "string") {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    const companyName = body.companyName.trim();
    if (companyName.length < 2 || companyName.length > 100) {
      return NextResponse.json(
        { error: "Company name must be 2-100 characters" },
        { status: 400 }
      );
    }

    const template = body.template || "saas-startup";
    const persona = body.persona || "professional";

    const VALID_TEMPLATES = ["saas-startup"];
    const VALID_PERSONAS = ["professional", "startup", "technical", "creative"];

    if (!VALID_TEMPLATES.includes(template)) {
      return NextResponse.json(
        { error: `Invalid template. Available: ${VALID_TEMPLATES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!VALID_PERSONAS.includes(persona)) {
      return NextResponse.json(
        { error: `Invalid persona. Available: ${VALID_PERSONAS.join(", ")}` },
        { status: 400 }
      );
    }

    const projectDir = tryGetProjectDir();
    if (!projectDir) {
      return NextResponse.json(
        {
          error:
            "No project directory found. Launch the UI with 'aicib ui' from your project folder.",
        },
        { status: 400 }
      );
    }

    // Check if already initialized
    if (fs.existsSync(path.join(projectDir, "aicib.config.yaml"))) {
      return NextResponse.json(
        { error: "Project is already initialized" },
        { status: 409 }
      );
    }

    // Shell out to aicib init with --persona flag for non-interactive mode
    const result = spawnSync(
      "npx",
      [
        "aicib",
        "init",
        "-t",
        template,
        "-n",
        companyName,
        "--persona",
        persona,
        "-d",
        projectDir,
      ],
      {
        cwd: projectDir,
        timeout: 30000,
        encoding: "utf-8",
      }
    );

    if (result.status !== 0) {
      const errorMsg =
        result.stderr?.trim() || result.stdout?.trim() || "Init command failed";
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    // Verify config was actually created (CLI has bare return paths that exit 0)
    const configPath = path.join(projectDir, "aicib.config.yaml");
    if (!fs.existsSync(configPath)) {
      return NextResponse.json(
        { error: "Initialization did not create a config file. Check CLI output." },
        { status: 500 }
      );
    }

    // After init, patch config with custom agent models and budget settings
    if (body.agents || body.settings) {
      let config = fs.readFileSync(configPath, "utf-8");

      // Patch budget settings
      if (body.settings) {
        if (body.settings.cost_limit_daily !== undefined) {
          config = config.replace(
            /cost_limit_daily:\s*\d+\.?\d*/,
            `cost_limit_daily: ${body.settings.cost_limit_daily}`
          );
        }
        if (body.settings.cost_limit_monthly !== undefined) {
          config = config.replace(
            /cost_limit_monthly:\s*\d+\.?\d*/,
            `cost_limit_monthly: ${body.settings.cost_limit_monthly}`
          );
        }
      }

      // Patch agent models
      if (body.agents) {
        for (const [role, agentConfig] of Object.entries(body.agents)) {
          if (agentConfig.model) {
            const escaped = escapeRegex(role);
            // Match "  role:\n    model: xxx" and replace the model
            const rolePattern = new RegExp(
              `(${escaped}:\\s*\\n\\s*model:\\s*)\\S+`
            );
            config = config.replace(rolePattern, `$1${agentConfig.model}`);

            // Also match worker format "  - role:\n      model: xxx"
            const workerPattern = new RegExp(
              `(-\\s+${escaped}:\\s*\\n\\s+model:\\s*)\\S+`
            );
            config = config.replace(
              workerPattern,
              `$1${agentConfig.model}`
            );
          }
        }
      }

      fs.writeFileSync(configPath, config, "utf-8");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
