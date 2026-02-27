"use client";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";

export interface HomeThreadEntry {
  id: string;
  createdAt: string;
  authorType: "user" | "agent" | "system";
  authorRole: string | null;
  text: string;
  jobId: number | null;
  messageType: string;
  jobStatus: string | null;
  channelId: string;
}

interface ChannelThreadProps {
  channelName: string;
  entries: HomeThreadEntry[];
  loading?: boolean;
}

function formatAuthor(entry: HomeThreadEntry): string {
  if (entry.authorType === "user") return "You";
  if (entry.authorRole) return entry.authorRole;
  return "system";
}

export function ChannelThread({ channelName, entries, loading }: ChannelThreadProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center border-b border-border/70 px-4">
        <p className="text-[13px] font-semibold text-foreground">{channelName}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {loading ? (
          <p className="text-[12px] text-muted-foreground">Loading messages...</p>
        ) : entries.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No messages in this channel yet. Send the first instruction below.
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                "max-w-full rounded-md border px-2.5 py-2",
                entry.authorType === "user"
                  ? "ml-auto border-border bg-muted/70"
                  : "mr-auto border-border/70 bg-background"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-foreground">{formatAuthor(entry)}</span>
                <span className="text-[10px] text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {entry.messageType}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                {entry.text}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
