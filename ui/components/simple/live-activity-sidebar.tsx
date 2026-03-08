"use client";

import { useEffect, useMemo, useState } from "react";
import { useSSE } from "@/components/sse-provider";
import { useUIPreferences } from "@/lib/ui-preferences";
import { getDeptColor, formatRoleName } from "@/lib/simple-mode";
import { formatRelativeTime } from "@/lib/utils";

interface LogEntry {
  id: number;
  job_id: number;
  timestamp: string;
  message_type: string;
  agent_role: string;
  content: string;
}

export function LiveActivitySidebar() {
  const {
    activitySidebarOpen,
    setActivitySidebarOpen,
    activityViewMode,
    setActivityViewMode,
  } = useUIPreferences();
  const { lastEvent } = useSSE();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((d) => {
        if (d.recentLogs) setLogs(d.recentLogs);
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
        return merged.slice(0, 50);
      });
    }
  }, [lastEvent]);

  const todayCount = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return logs.filter(
      (l) => new Date(l.timestamp).getTime() >= todayStart.getTime()
    ).length;
  }, [logs]);

  if (!activitySidebarOpen) {
    return (
      <div
        style={{
          width: 36,
          minWidth: 36,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 16,
          borderLeft: "1px solid var(--s-border-light)",
          backgroundColor: "#FFFFFF",
          cursor: "pointer",
        }}
        onClick={() => setActivitySidebarOpen(true)}
      >
        <span
          style={{
            fontSize: 16,
            color: "var(--s-text-tertiary)",
            transform: "rotate(180deg)",
          }}
        >
          ›
        </span>
      </div>
    );
  }

  return (
    <aside
      style={{
        width: 320,
        minWidth: 320,
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--s-border-light)",
        backgroundColor: "#FFFFFF",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--s-border-light)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="s-live-dot" />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--s-text-primary)",
            }}
          >
            Live Activity
          </span>
        </div>
        <button
          onClick={() => setActivitySidebarOpen(false)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: "var(--s-text-tertiary)",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          ›
        </button>
      </div>

      {/* View Mode Toggle */}
      <div
        style={{
          display: "flex",
          gap: 0,
          margin: "12px 16px 0",
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid var(--s-border-light)",
        }}
      >
        {(["simple", "detailed"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setActivityViewMode(mode)}
            style={{
              flex: 1,
              padding: "5px 0",
              fontSize: 11,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              backgroundColor:
                activityViewMode === mode ? "#3B82F6" : "transparent",
              color: activityViewMode === mode ? "#FFFFFF" : "var(--s-text-secondary)",
              transition: "all 0.15s ease",
            }}
          >
            {mode === "simple" ? "Simple" : "Detailed"}
          </button>
        ))}
      </div>

      {/* Activity Feed */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
        }}
      >
        {logs.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: "var(--s-text-tertiary)",
              textAlign: "center",
              paddingTop: 40,
            }}
          >
            No activity yet
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {logs.slice(0, 30).map((log) => {
              const color = getDeptColor(log.agent_role);
              const name = formatRoleName(log.agent_role);
              const time = formatRelativeTime(log.timestamp);
              const isExpanded =
                activityViewMode === "detailed" && expandedId === log.id;
              const truncated =
                activityViewMode === "simple"
                  ? log.content.length > 80
                    ? log.content.slice(0, 80) + "..."
                    : log.content
                  : log.content.length > 120
                    ? log.content.slice(0, 120) + "..."
                    : log.content;

              return (
                <div
                  key={log.id}
                  onClick={() => {
                    if (activityViewMode === "detailed") {
                      setExpandedId(isExpanded ? null : log.id);
                    }
                  }}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--s-border-light)",
                    cursor:
                      activityViewMode === "detailed" ? "pointer" : "default",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: color,
                      marginTop: 5,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--s-text-primary)",
                        }}
                      >
                        {name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--s-text-tertiary)",
                        }}
                      >
                        {time}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 12,
                        color: "var(--s-text-secondary)",
                        marginTop: 2,
                        lineHeight: 1.4,
                        wordBreak: "break-word",
                      }}
                    >
                      {isExpanded ? log.content : truncated}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--s-border-light)",
          fontSize: 11,
          color: "var(--s-text-tertiary)",
          textAlign: "center",
        }}
      >
        {todayCount} activities today
      </div>
    </aside>
  );
}
