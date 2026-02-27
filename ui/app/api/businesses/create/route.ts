import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  runInitCommand,
  startBusinessDetached,
  VALID_PERSONAS,
  VALID_TEMPLATES,
} from "@/lib/business-commands";
import { upsertBusiness } from "@/lib/business-registry";

export const dynamic = "force-dynamic";

interface CreateBusinessRequestBody {
  companyName: string;
  template: string;
  persona: string;
  agents?: Record<string, { enabled: boolean; model: string }>;
  settings?: { cost_limit_daily?: number; cost_limit_monthly?: number };
  projectDir: string;
  startNow?: boolean;
}

function parseConfigMetadata(projectDir: string): { name: string; template: string } {
  const configPath = path.join(projectDir, "aicib.config.yaml");
  if (!fs.existsSync(configPath)) {
    return {
      name: path.basename(projectDir) || "Business",
      template: "saas-startup",
    };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const companyName =
    raw.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") ||
    path.basename(projectDir) ||
    "Business";
  const template =
    raw
      .match(/^\s*template:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") || "saas-startup";
  return { name: companyName, template };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBusinessRequestBody;

    const companyName = body.companyName?.trim();
    if (!companyName || companyName.length < 2 || companyName.length > 100) {
      return NextResponse.json(
        { error: "Company name must be 2-100 characters" },
        { status: 400 }
      );
    }

    const template = body.template || "saas-startup";
    if (!VALID_TEMPLATES.includes(template as (typeof VALID_TEMPLATES)[number])) {
      return NextResponse.json(
        { error: `Invalid template. Available: ${VALID_TEMPLATES.join(", ")}` },
        { status: 400 }
      );
    }

    const persona = body.persona || "professional";
    if (!VALID_PERSONAS.includes(persona as (typeof VALID_PERSONAS)[number])) {
      return NextResponse.json(
        { error: `Invalid persona. Available: ${VALID_PERSONAS.join(", ")}` },
        { status: 400 }
      );
    }

    const rawDir = body.projectDir?.trim();
    if (!rawDir) {
      return NextResponse.json(
        { error: "projectDir is required" },
        { status: 400 }
      );
    }
    const projectDir = path.resolve(rawDir);

    const existingConfig = path.join(projectDir, "aicib.config.yaml");
    if (fs.existsSync(existingConfig)) {
      return NextResponse.json(
        {
          error:
            "That folder already has a business config. Use Import instead.",
        },
        { status: 409 }
      );
    }

    const init = runInitCommand({
      projectDir,
      companyName,
      template,
      persona,
      agents: body.agents,
      settings: body.settings,
    });

    if (!init.success) {
      return NextResponse.json(
        { error: init.error || "Failed to initialize business" },
        { status: 500 }
      );
    }

    const metadata = parseConfigMetadata(projectDir);
    const business = upsertBusiness({
      projectDir,
      name: metadata.name,
      template: metadata.template,
      setActive: true,
    });

    const shouldStart = body.startNow !== false;
    if (!shouldStart) {
      return NextResponse.json({
        success: true,
        business,
        started: false,
        pid: null,
      });
    }

    const start = startBusinessDetached(projectDir);
    return NextResponse.json({
      success: true,
      business,
      started: !start.alreadyRunning,
      alreadyRunning: !!start.alreadyRunning,
      pid: start.pid,
      message: start.message,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
