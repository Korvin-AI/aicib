import { NextResponse } from "next/server";
import { getCloudApiUrl, isCloudMode } from "@/lib/cloud-mode";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCloudMode()) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 404 });
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(/aicib_cloud_token=([^;]+)/);
  const token = match?.[1] || "";

  if (token) {
    try {
      await fetch(`${getCloudApiUrl()}/auth/logout`, {
        method: "POST",
        headers: { Cookie: `aicib_session=${token}` },
      });
    } catch {
      // Best-effort logout on cloud server
    }
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set("aicib_cloud_token", "", { maxAge: 0, path: "/" });
  res.cookies.set("aicib_business_id", "", { maxAge: 0, path: "/" });
  return res;
}
