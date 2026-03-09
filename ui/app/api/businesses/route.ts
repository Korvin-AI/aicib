import { NextResponse } from "next/server";
import { getBusinessHealth } from "@/lib/business-context";
import {
  listBusinesses,
  readBusinessRegistry,
} from "@/lib/business-registry";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetchOrg } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isCloudMode()) return cloudFetchOrg(request, "businesses");
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
