import { NextResponse } from "next/server";
import { cloudFetchOrg } from "@/lib/cloud-proxy";
import { isCloudMode } from "@/lib/cloud-mode";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isCloudMode()) {
    return NextResponse.json({ error: "Not available in local mode" }, { status: 404 });
  }
  const { id } = await params;
  return cloudFetchOrg(request, `org/invitations/${id}`, { method: "DELETE" });
}
