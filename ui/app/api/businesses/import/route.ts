import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { startBusinessDetached } from "@/lib/business-commands";
import { upsertBusiness } from "@/lib/business-registry";

export const dynamic = "force-dynamic";

interface ImportBusinessRequestBody {
  projectDir: string;
  startNow?: boolean;
}

function readConfigMetadata(projectDir: string): { name: string; template: string } {
  const configPath = path.join(projectDir, "aicib.config.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  const name =
    raw.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") ||
    path.basename(projectDir) ||
    "Business";
  const template =
    raw
      .match(/^\s*template:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") || "saas-startup";
  return { name, template };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ImportBusinessRequestBody;
    const rawDir = body.projectDir?.trim();

    if (!rawDir) {
      return NextResponse.json(
        { error: "projectDir is required" },
        { status: 400 }
      );
    }

    const projectDir = path.resolve(rawDir);
    const configPath = path.join(projectDir, "aicib.config.yaml");

    if (!fs.existsSync(configPath)) {
      return NextResponse.json(
        {
          error:
            "No aicib.config.yaml found in that folder. Pick an initialized business folder.",
        },
        { status: 400 }
      );
    }

    const metadata = readConfigMetadata(projectDir);
    const business = upsertBusiness({
      projectDir,
      name: metadata.name,
      template: metadata.template,
      setActive: true,
    });

    const shouldStart = !!body.startNow;
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
