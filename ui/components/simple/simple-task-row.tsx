"use client";

import { useState } from "react";
import { getDeptColor, getRoleInitials, getStatusDisplay } from "@/lib/simple-mode";
import { SimpleDeptPill } from "@/components/simple/simple-dept-pill";
import { SimpleStatusIndicator } from "@/components/simple/simple-status-indicator";

interface Task {
  id: number;
  title: string;
  status: string;
  assigned_to: string;
  output_summary?: string | null;
}

interface SimpleTaskRowProps {
  task: Task;
}

export function SimpleTaskRow({ task }: SimpleTaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const color = getDeptColor(task.assigned_to);
  const initials = getRoleInitials(task.assigned_to);
  const statusDisplay = getStatusDisplay(task.status);
  const isDone = task.status === "done";

  return (
    <div
      style={{
        animation: "s-slide-up 0.3s ease-out",
      }}
    >
      <div
        onClick={() => {
          if (isDone && task.output_summary) setExpanded(!expanded);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderRadius: 8,
          backgroundColor: isDone ? "#F0FDF4" : "var(--s-surface-elevated)",
          border: "1px solid var(--s-border-light)",
          cursor: isDone && task.output_summary ? "pointer" : "default",
          transition: "background-color 0.15s ease",
        }}
      >
        {/* Dept color dot */}
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: color,
            flexShrink: 0,
          }}
        />

        {/* Title */}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--s-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {task.title}
        </span>

        {/* Dept pill */}
        <SimpleDeptPill role={task.assigned_to} />

        {/* Agent avatar circle */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            backgroundColor: color + "20",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 700,
            color: color,
            flexShrink: 0,
          }}
        >
          {initials}
        </div>

        {/* Edit button (no-op) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            console.log("Edit task:", task.id);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--s-text-tertiary)",
            fontSize: 14,
          }}
          title="Edit"
        >
          ✎
        </button>

        {/* Delete button (no-op) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            console.log("Delete task:", task.id);
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--s-text-tertiary)",
            fontSize: 14,
          }}
          title="Delete"
        >
          ✕
        </button>

        {/* Status indicator */}
        <SimpleStatusIndicator status={task.status} />
      </div>

      {/* Expanded output */}
      {expanded && task.output_summary && (
        <div
          style={{
            margin: "0 16px",
            padding: "12px 16px",
            fontSize: 12,
            color: "var(--s-text-secondary)",
            lineHeight: 1.5,
            backgroundColor: "#F0FDF4",
            borderRadius: "0 0 8px 8px",
            borderLeft: `3px solid ${statusDisplay.color}`,
          }}
        >
          {task.output_summary}
        </div>
      )}
    </div>
  );
}
