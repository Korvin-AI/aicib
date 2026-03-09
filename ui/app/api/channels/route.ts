import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { buildChannelSummaries, buildChannelThreadEntries } from "@/lib/channels";
import { isCloudMode } from "@/lib/cloud-mode";
import { cloudFetch } from "@/lib/cloud-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isCloudMode()) return cloudFetch(request, "channels");
  try {
    const db = getDb();
    const entries = buildChannelThreadEntries(db);
    const channels = buildChannelSummaries(entries);
    return NextResponse.json({ channels });
  } catch (error) {
    return jsonError(error);
  }
}
