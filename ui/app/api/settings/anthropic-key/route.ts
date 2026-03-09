import { NextResponse } from "next/server";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetch } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  if (!isCloudMode()) {
    return NextResponse.json(
      { error: "API key management is only available in cloud mode" },
      { status: 501 }
    );
  }
  return cloudFetch(request, "settings/anthropic-key", { method: "PUT" });
}

export async function DELETE(request: Request) {
  if (!isCloudMode()) {
    return NextResponse.json(
      { error: "API key management is only available in cloud mode" },
      { status: 501 }
    );
  }
  return cloudFetch(request, "settings/anthropic-key", { method: "DELETE" });
}
