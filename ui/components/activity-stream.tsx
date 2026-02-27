"use client";

import { useEffect, useMemo, useState } from "react";
import { getAgentColorClasses } from "@/lib/agent-colors";
import { useSSE } from "@/components/sse-provider";
import { FilterBar } from "@/components/filter-bar";
import { cn, formatRelativeTime } from "@/lib/utils";

interface LogEntry {
  id: number;
  job_id: number;
  timestamp: string;
  message_type: string;
  agent_role: string;
  content: string;
}

export function ActivityStream() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentFilter, setAgentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { lastEvent } = useSSE();

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((d) => {
        if (d.recentLogs) {
          setLogs(d.recentLogs);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "new_logs" && Array.isArray(lastEvent.data)) {
      const newEntries = lastEvent.data as LogEntry[];
      setLogs((prev) => {
        const existingIds = new Set(prev.map((l) => l.id));
        const unique = newEntries.filter((l) => !existingIds.has(l.id));
        if (unique.length === 0) return prev;
        const merged = [...prev, ...unique];
        merged.sort((a, b) => b.id - a.id);
        return merged.slice(0, 100);
      });
    }
  }, [lastEvent]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesAgent =
        agentFilter === "all" ? true : (log.agent_role || "system") === agentFilter;
      const matchesType =
        typeFilter === "all" ? true : (log.message_type || "unknown") === typeFilter;
      return matchesAgent && matchesType;
    });
  }, [agentFilter, logs, typeFilter]);

  const filterOptions = useMemo(() => {
    const agents = Array.from(
      new Set(logs.map((log) => log.agent_role || "system"))
    ).sort();
    const messageTypes = Array.from(
      new Set(logs.map((log) => log.message_type || "unknown"))
    ).sort();

    return [
      {
        key: "agent",
        label: "Agent",
        value: agentFilter,
        options: [
          { value: "all", label: "All" },
          ...agents.map((agent) => ({ value: agent, label: agent })),
        ],
      },
      {
        key: "type",
        label: "Type",
        value: typeFilter,
        options: [
          { value: "all", label: "All" },
          ...messageTypes.map((type) => ({ value: type, label: type })),
        ],
      },
    ];
  }, [agentFilter, logs, typeFilter]);

  if (logs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-muted-foreground/40">
          No recent activity. Send a brief to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-3 py-2">
        <FilterBar
          filters={filterOptions}
          onChange={(key, value) => {
            if (key === "agent") setAgentFilter(value);
            if (key === "type") setTypeFilter(value);
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-2">
        <div className="space-y-1">
          {filteredLogs.length === 0 ? (
            <p className="py-2 text-[12px] text-muted-foreground">
              No activity matches the current filters.
            </p>
          ) : null}
          {filteredLogs.map((log) => {
            const colors = getAgentColorClasses(log.agent_role);
            const relTime = formatRelativeTime(log.timestamp);

            return (
              <div
                key={log.id}
                className="flex gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 shadow-xs"
              >
                <div
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    colors.dot
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-[13px] font-medium", colors.text)}>
                      {log.agent_role
                        ? log.agent_role.length <= 4
                          ? log.agent_role.toUpperCase()
                          : log.agent_role
                              .split("-")
                              .map(
                                (w) => w.charAt(0).toUpperCase() + w.slice(1)
                              )
                              .join(" ")
                        : "System"}
                    </span>
                    <span className="text-[11px] text-muted-foreground/40">
                      {relTime}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {log.content}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
