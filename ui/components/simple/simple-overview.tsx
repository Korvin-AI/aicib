"use client";

import { useCallback, useEffect, useState } from "react";
import { useSSE } from "@/components/sse-provider";
import {
  getGreeting,
  getFormattedDate,
  getStatusDisplay,
  STATUS_PRIORITY,
} from "@/lib/simple-mode";
import { SimpleTaskRow } from "@/components/simple/simple-task-row";
import { SimpleBriefInput } from "@/components/simple/simple-brief-input";

interface Task {
  id: number;
  title: string;
  status: string;
  assigned_to: string;
  output_summary?: string | null;
}

const STATUS_LEGEND = [
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "Awaiting Approval" },
  { status: "todo", label: "Planned" },
  { status: "done", label: "Completed" },
  { status: "cancelled", label: "Failed" },
];

export function SimpleOverview() {
  const { lastEvent } = useSSE();
  const [companyName, setCompanyName] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const d = await res.json();
      if (d.company?.name) setCompanyName(d.company.name);
      setSessionActive(!!d.session?.active);
    } catch {}
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?pageSize=50", { cache: "no-store" });
      const d = await res.json();
      const items = (d.tasks || []) as Task[];
      items.sort(
        (a, b) =>
          (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99)
      );
      setTasks(items);
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([loadStatus(), loadTasks()]).finally(() => setLoading(false));
  }, [loadStatus, loadTasks]);

  useEffect(() => {
    if (!lastEvent) return;
    if (
      lastEvent.type === "task_update" ||
      lastEvent.type === "new_logs" ||
      lastEvent.type === "connected"
    ) {
      loadTasks();
      loadStatus();
    }
    if (lastEvent.type === "agent_status") {
      loadStatus();
    }
  }, [lastEvent, loadTasks, loadStatus]);

  async function handleStart() {
    setActionLoading(true);
    try {
      await fetch("/api/businesses/start", { method: "POST" });
      await new Promise((r) => setTimeout(r, 1200));
      await loadStatus();
    } catch {}
    setActionLoading(false);
  }

  async function handleStop() {
    setActionLoading(true);
    try {
      await fetch("/api/businesses/stop", { method: "POST" });
      await loadStatus();
    } catch {}
    setActionLoading(false);
  }

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
          alignItems: "flex-start",
          marginBottom: 28,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--s-text-primary)",
              margin: 0,
            }}
          >
            {getGreeting()}, {companyName || "Team"}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--s-text-tertiary)",
              marginTop: 4,
            }}
          >
            {getFormattedDate()}
          </p>
        </div>

        <button
          onClick={sessionActive ? handleStop : handleStart}
          disabled={actionLoading}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            cursor: actionLoading ? "not-allowed" : "pointer",
            backgroundColor: sessionActive ? "#FEE2E2" : "#3B82F6",
            color: sessionActive ? "#DC2626" : "#FFFFFF",
            opacity: actionLoading ? 0.6 : 1,
            transition: "all 0.15s ease",
          }}
        >
          {actionLoading
            ? "..."
            : sessionActive
              ? "Pause Company"
              : "Start Company"}
        </button>
      </div>

      {/* Your Plan Card */}
      <div className="s-card" style={{ padding: 20, marginBottom: 24 }}>
        {/* Title + Legend */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--s-text-primary)",
              margin: 0,
            }}
          >
            Your Plan
          </h2>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {STATUS_LEGEND.map((s) => {
              const display = getStatusDisplay(s.status);
              return (
                <div
                  key={s.status}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: display.color,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--s-text-tertiary)",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Task List */}
        {loading ? (
          <p
            style={{
              fontSize: 13,
              color: "var(--s-text-tertiary)",
              textAlign: "center",
              padding: 32,
            }}
          >
            Loading tasks...
          </p>
        ) : tasks.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: "var(--s-text-tertiary)",
              textAlign: "center",
              padding: 32,
            }}
          >
            No tasks yet. Send a message to get started.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tasks.map((task) => (
              <SimpleTaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>

      {/* Brief Input */}
      <SimpleBriefInput disabled={!sessionActive} />
    </div>
  );
}
