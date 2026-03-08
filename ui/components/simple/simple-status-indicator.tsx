"use client";

interface SimpleStatusIndicatorProps {
  status: string;
}

export function SimpleStatusIndicator({ status }: SimpleStatusIndicatorProps) {
  if (status === "done") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="8" fill="#10B981" />
        <path
          d="M5 8.5L7 10.5L11 6"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (status === "cancelled") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="8" fill="#EF4444" />
        <path
          d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (status === "in_progress") {
    return (
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#3B82F6",
          animation: "s-live-pulse 2s ease-in-out infinite",
        }}
      />
    );
  }

  if (status === "in_review") {
    return (
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#F59E0B",
        }}
      />
    );
  }

  // todo, backlog, or unknown
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: "#9CA3AF",
      }}
    />
  );
}
