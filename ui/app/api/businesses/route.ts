import { NextResponse } from "next/server";
import { getBusinessHealth } from "@/lib/business-context";
import {
  listBusinesses,
  readBusinessRegistry,
} from "@/lib/business-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const registry = readBusinessRegistry();
    const businesses = listBusinesses()
      .map((business) => ({
        ...business,
        ...getBusinessHealth(business.projectDir),
      }))
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));

    return NextResponse.json({
      activeBusinessId: registry.activeBusinessId,
      hasAnyBusiness: businesses.length > 0,
      businesses,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
