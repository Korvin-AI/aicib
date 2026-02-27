"use client";

import { cn } from "@/lib/utils";

export interface HomeChannelSummary {
  id: string;
  name: string;
  kind: string;
  roles: string[];
  description: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
}

interface ChannelsListProps {
  channels: HomeChannelSummary[];
  selectedChannelId: string;
  loading?: boolean;
  onSelect: (channelId: string) => void;
}

export function ChannelsList({
  channels,
  selectedChannelId,
  loading,
  onSelect,
}: ChannelsListProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border/80 bg-card">
      <div className="flex h-9 items-center border-b border-border/70 px-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Channels
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-2 text-[12px] text-muted-foreground">Loading channels...</p>
        ) : channels.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-muted-foreground">No channels available.</p>
        ) : (
          channels.map((channel) => {
            const active = selectedChannelId === channel.id;
            return (
              <button
                key={channel.id}
                onClick={() => onSelect(channel.id)}
                className={cn(
                  "w-full rounded-md border px-2 py-2 text-left transition-colors",
                  active
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent text-foreground/80 hover:border-border/70 hover:bg-muted/50"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium">{channel.name}</p>
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {channel.messageCount}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {channel.lastMessagePreview || channel.description}
                </p>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
