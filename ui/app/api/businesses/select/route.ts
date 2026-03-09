import { NextResponse } from "next/server";
import { setActiveBusiness } from "@/lib/business-registry";
import { isCloudMode } from "@/lib/cloud-mode";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (isCloudMode()) {
    // In cloud mode, just set the cookie — no server call needed
    try {
      const body = (await request.json()) as { businessId?: string };
      const businessId = body.businessId?.trim();
      if (!businessId) {
        return NextResponse.json({ error: "businessId is required" }, { status: 400 });
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)) {
        return NextResponse.json({ error: "Invalid business ID" }, { status: 400 });
      }
      const res = NextResponse.json({ success: true, activeBusinessId: businessId });
      res.cookies.set("aicib_business_id", businessId, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
      });
      return res;
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
  }
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
