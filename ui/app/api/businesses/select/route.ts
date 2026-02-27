import { NextResponse } from "next/server";
import { setActiveBusiness } from "@/lib/business-registry";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { businessId?: string };
    const businessId = body.businessId?.trim();

    if (!businessId) {
      return NextResponse.json(
        { error: "businessId is required" },
        { status: 400 }
      );
    }

    const active = setActiveBusiness(businessId);
    if (!active) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      activeBusinessId: active.id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
