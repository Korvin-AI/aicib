import { NextResponse } from "next/server";
import { getBusinessHealth, getResolvedBusiness } from "@/lib/business-context";
import { listBusinesses, readBusinessRegistry } from "@/lib/business-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const registry = readBusinessRegistry();
    const businesses = listBusinesses();
    const activeBusiness = getResolvedBusiness();
    const health = activeBusiness
      ? getBusinessHealth(activeBusiness.projectDir)
      : { configExists: false, dbExists: false, sessionActive: false };

    return NextResponse.json({
      configExists: health.configExists,
      dbExists: health.dbExists,
      sessionActive: health.sessionActive,
      hasAnyBusiness: businesses.length > 0,
      activeBusinessId: registry.activeBusinessId,
      activeBusiness: activeBusiness
        ? {
            id: activeBusiness.id,
            name: activeBusiness.name,
            projectDir: activeBusiness.projectDir,
            template: activeBusiness.template,
          }
        : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
