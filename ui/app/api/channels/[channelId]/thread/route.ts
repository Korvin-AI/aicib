import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonError, parsePagination } from "@/lib/api-helpers";
import { buildChannelThreadEntries, getChannelDefinition } from "@/lib/channels";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const db = getDb();
    const { channelId } = await params;
    const channel = getChannelDefinition(channelId);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const pageInfo = parsePagination(request, { pageSize: 200, maxPageSize: 500 });
    const allEntries = buildChannelThreadEntries(db).filter(
      (entry) => entry.channelId === channelId
    );

    const total = allEntries.length;
    const end = Math.max(0, total - (pageInfo.page - 1) * pageInfo.pageSize);
    const start = Math.max(0, end - pageInfo.pageSize);
    const entries = allEntries.slice(start, end);

    return NextResponse.json({
      channel,
      entries,
      pagination: {
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageInfo.pageSize)),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
