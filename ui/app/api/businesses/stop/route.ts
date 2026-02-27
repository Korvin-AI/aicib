import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { stopBusinessSync } from "@/lib/business-commands";
import { getResolvedBusiness } from "@/lib/business-context";

export const dynamic = "force-dynamic";

interface StopBusinessRequestBody {
  businessId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as StopBusinessRequestBody;
    const business = getResolvedBusiness(body.businessId);

    if (!business) {
      return NextResponse.json(
        { error: "No active business selected" },
        { status: 400 }
      );
    }

    const configPath = path.join(business.projectDir, "aicib.config.yaml");
    if (!fs.existsSync(configPath)) {
      return NextResponse.json(
        {
          error:
            "This business is not initialized yet. Create it first or import a valid folder.",
        },
        { status: 400 }
      );
    }

    const stop = stopBusinessSync(business.projectDir);
    if (!stop.success) {
      return NextResponse.json({ error: stop.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: stop.message,
      businessId: business.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
