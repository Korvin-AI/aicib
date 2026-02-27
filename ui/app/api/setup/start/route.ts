import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { startBusinessDetached } from "@/lib/business-commands";
import { getResolvedBusiness } from "@/lib/business-context";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const business = getResolvedBusiness();
    if (!business) {
      return NextResponse.json(
        { error: "No active business selected" },
        { status: 400 }
      );
    }

    // Verify config exists
    if (!fs.existsSync(path.join(business.projectDir, "aicib.config.yaml"))) {
      return NextResponse.json(
        { error: "Business not initialized. Complete setup first." },
        { status: 400 }
      );
    }

    const start = startBusinessDetached(business.projectDir);

    return NextResponse.json({
      success: true,
      pid: start.pid,
      alreadyRunning: !!start.alreadyRunning,
      message: start.message,
      businessId: business.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
