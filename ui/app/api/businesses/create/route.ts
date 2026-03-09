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
import { getDbForProject, ensureWikiTable } from "@/lib/db-project";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetchOrg } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

interface BusinessProfile {
  whatYouSell?: string;
  primaryCustomer?: string;
  biggestChallenge?: string;
  monthlyRevenue?: string;
  customerCount?: string;
  topMetric?: string;
  weeklyHours?: string;
  automateTask?: string;
  customerChannel?: string;
  weeklyWin?: string;
}

interface CreateBusinessRequestBody {
  companyName: string;
  template: string;
  persona: string;
  agents?: Record<string, { enabled: boolean; model: string }>;
  settings?: { cost_limit_daily?: number; cost_limit_monthly?: number };
  projectDir: string;
  startNow?: boolean;
  profile?: BusinessProfile;
  sevenDayPlan?: string;
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
  if (isCloudMode()) {
    try {
      const body = await request.json();
      const cloudBody = JSON.stringify({ name: body.companyName || body.name, template: body.template });
      return cloudFetchOrg(request, "businesses", { method: "POST", body: cloudBody });
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
  }

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

    // Save business profile and 7-day plan as wiki articles
    if (body.profile || body.sevenDayPlan) {
      const db = getDbForProject(projectDir);
      try {
        ensureWikiTable(db);

        if (body.profile) {
          const p = body.profile;
          const hasContent = Object.values(p).some((v) => v && v.trim());
          if (hasContent) {
            const md = [
              "# Business Profile",
              "",
              p.whatYouSell ? `## What We Sell\n${p.whatYouSell}` : "",
              p.primaryCustomer ? `## Primary Customer\n${p.primaryCustomer}` : "",
              p.biggestChallenge ? `## Biggest Challenge\n${p.biggestChallenge}` : "",
              p.monthlyRevenue ? `## Monthly Revenue\n${p.monthlyRevenue}` : "",
              p.customerCount ? `## Customer Count\n${p.customerCount}` : "",
              p.topMetric ? `## Top Metric (30-day goal)\n${p.topMetric}` : "",
              p.weeklyHours ? `## Weekly Time Available\n${p.weeklyHours}` : "",
              p.automateTask ? `## Task to Automate\n${p.automateTask}` : "",
              p.customerChannel ? `## Customer Channel\n${p.customerChannel}` : "",
              p.weeklyWin ? `## Weekly Win Goal\n${p.weeklyWin}` : "",
            ]
              .filter(Boolean)
              .join("\n\n");

            db.prepare(
              `INSERT INTO wiki_articles (slug, title, section, content, created_by, updated_by)
               VALUES ('business-profile', 'Business Profile', 'overview', ?, 'setup-wizard', 'setup-wizard')
               ON CONFLICT(slug) DO UPDATE SET
                 content = excluded.content,
                 updated_by = excluded.updated_by,
                 updated_at = datetime('now')`
            ).run(md);
          }
        }

        if (body.sevenDayPlan) {
          db.prepare(
            `INSERT INTO wiki_articles (slug, title, section, content, created_by, updated_by)
             VALUES ('seven-day-plan', '7-Day Plan', 'overview', ?, 'setup-wizard', 'setup-wizard')
             ON CONFLICT(slug) DO UPDATE SET
               content = excluded.content,
               updated_by = excluded.updated_by,
               updated_at = datetime('now')`
          ).run(body.sevenDayPlan);
        }
      } finally {
        db.close();
      }
    }

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
