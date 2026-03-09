import { NextResponse } from "next/server";
import { cloudFetchOrg } from "@/lib/cloud-proxy";
import { isCloudMode } from "@/lib/cloud-mode";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCloudMode()) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 404 });
  }
  return cloudFetchOrg(request, "org/invitations");
}

export async function POST(request: Request) {
  if (!isCloudMode()) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 404 });
  }
  return cloudFetchOrg(request, "org/invitations", { method: "POST" });
}
