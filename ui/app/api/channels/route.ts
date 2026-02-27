import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { buildChannelSummaries, buildChannelThreadEntries } from "@/lib/channels";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const entries = buildChannelThreadEntries(db);
    const channels = buildChannelSummaries(entries);
    return NextResponse.json({ channels });
  } catch (error) {
    return jsonError(error);
  }
}
