import { NextResponse } from "next/server";
import { cloudFetchAuth } from "@/lib/cloud-proxy";
import { isCloudMode } from "@/lib/cloud-mode";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCloudMode()) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 404 });
  }
  try {
    const body = await request.json();
    return cloudFetchAuth(request, "auth/login", body);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
