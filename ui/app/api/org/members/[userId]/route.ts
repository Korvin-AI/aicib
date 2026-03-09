import { NextResponse } from "next/server";
import { cloudFetchOrg } from "@/lib/cloud-proxy";
import { isCloudMode } from "@/lib/cloud-mode";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!isCloudMode()) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 404 });
  }
  const { userId } = await params;
  return cloudFetchOrg(request, `org/members/${userId}`, { method: "PUT" });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!isCloudMode()) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 404 });
  }
  const { userId } = await params;
  return cloudFetchOrg(request, `org/members/${userId}`, { method: "DELETE" });
}
