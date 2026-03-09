import { NextResponse } from "next/server";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetch } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  if (!isCloudMode()) {
    return NextResponse.json(
      { error: "Execution mode management is only available in cloud mode" },
      { status: 501 }
    );
  }
  return cloudFetch(request, "settings/execution-mode", { method: "PUT" });
}
