"use client";

import { useEffect, useMemo, useState } from "react";
import { useSSE } from "@/components/sse-provider";
import { useUIPreferences } from "@/lib/ui-preferences";
import { getDeptColor, getRoleInitials, formatRoleName } from "@/lib/simple-mode";
import { formatRelativeTime } from "@/lib/utils";

interface LogEntry {
  id: number;
  job_id: number;
  timestamp: string;
  message_type: string;
  agent_role: string;
  content: string;
}

export function SimpleActivityLog() {
  const { lastEvent } = useSSE();
  const { activityViewMode, setActivityViewMode } = useUIPreferences();
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
        return merged.slice(0, 100);
      });
    }
  }, [lastEvent]);

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, LogEntry[]>();
    for (const log of logs) {
      const dateKey = new Date(log.timestamp).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      const existing = groups.get(dateKey) || [];
      existing.push(log);
      groups.set(dateKey, existing);
    }
    return groups;
  }, [logs]);

  return (
    <div
      style={{
        paddingTop: 32,
        paddingBottom: 32,
        animation: "s-fade-in 0.3s ease-out",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--s-text-primary)",
            margin: 0,
          }}
        >
          Activity Log
        </h1>

        <div
          style={{
            display: "flex",
            gap: 0,
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
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                backgroundColor:
                  activityViewMode === mode ? "#3B82F6" : "transparent",
                color:
                  activityViewMode === mode
                    ? "#FFFFFF"
                    : "var(--s-text-secondary)",
                transition: "all 0.15s ease",
              }}
            >
              {mode === "simple" ? "Simple" : "Detailed"}
            </button>
          ))}
        </div>
      </div>

      {/* Activity entries */}
      {logs.length === 0 ? (
        <div
          className="s-card"
          style={{
            padding: 48,
            textAlign: "center",
            fontSize: 13,
            color: "var(--s-text-tertiary)",
          }}
        >
          No activity yet. Start your company to see logs appear here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {[...groupedByDate.entries()].map(([dateLabel, entries]) => (
            <div key={dateLabel}>
              <h3
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--s-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 12,
                }}
              >
                {dateLabel}
              </h3>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {entries.map((log) => {
                  const color = getDeptColor(log.agent_role);
                  const initials = getRoleInitials(log.agent_role);
                  const name = formatRoleName(log.agent_role);
                  const time = formatRelativeTime(log.timestamp);
                  const isExpanded =
                    activityViewMode === "detailed" && expandedId === log.id;

                  return (
                    <div
                      key={log.id}
                      className="s-card"
                      onClick={() => {
                        if (activityViewMode === "detailed") {
                          setExpandedId(isExpanded ? null : log.id);
                        }
                      }}
                      style={{
                        display: "flex",
                        gap: 14,
                        padding: 14,
                        cursor:
                          activityViewMode === "detailed"
                            ? "pointer"
                            : "default",
                        animation: "s-slide-up 0.3s ease-out",
                      }}
                    >
                      {/* Avatar */}
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          backgroundColor: color + "20",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          color: color,
                          flexShrink: 0,
                        }}
                      >
                        {initials}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--s-text-primary)",
                            }}
                          >
                            {name}
                          </span>
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: "50%",
                              backgroundColor: color,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--s-text-tertiary)",
                              marginLeft: "auto",
                            }}
                          >
                            {time}
                          </span>
                          {activityViewMode === "detailed" && (
                            <span
                              style={{
                                fontSize: 14,
                                color: "var(--s-text-tertiary)",
                                transform: isExpanded
                                  ? "rotate(90deg)"
                                  : "rotate(0deg)",
                                transition: "transform 0.15s ease",
                              }}
                            >
                              ›
                            </span>
                          )}
                        </div>
                        <p
                          style={{
                            fontSize: 13,
                            color: "var(--s-text-secondary)",
                            marginTop: 4,
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                          }}
                        >
                          {isExpanded
                            ? log.content
                            : log.content.length > 150
                              ? log.content.slice(0, 150) + "..."
                              : log.content}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
