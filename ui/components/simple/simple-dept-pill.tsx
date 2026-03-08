"use client";

import { getDeptColor, formatRoleName } from "@/lib/simple-mode";

interface SimpleDeptPillProps {
  role: string;
}

export function SimpleDeptPill({ role }: SimpleDeptPillProps) {
  const color = getDeptColor(role);
  const name = formatRoleName(role);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        backgroundColor: color + "15",
        fontSize: 11,
        fontWeight: 500,
        color: "var(--s-text-secondary)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
      {name}
    </span>
  );
}
