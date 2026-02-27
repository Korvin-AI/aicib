"use client";

import { forwardRef } from "react";
import { getAgentColorClasses } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";

interface AgentNodeProps {
  role: string;
  status: string;
  hexColor: string;
  onClick: () => void;
}

const displayNames: Record<string, string> = {
  ceo: "CEO",
  cto: "CTO",
  cfo: "CFO",
  cmo: "CMO",
  "backend-engineer": "Backend Eng.",
  "frontend-engineer": "Frontend Eng.",
  "financial-analyst": "Analyst",
  "content-writer": "Writer",
};

export const AgentNode = forwardRef<HTMLDivElement, AgentNodeProps>(
  function AgentNode({ role, status, hexColor, onClick }, ref) {
    const colors = getAgentColorClasses(role);
    const name = displayNames[role] || role;

    return (
      <div
        ref={ref}
        onClick={onClick}
        className="flex flex-col items-center gap-1.5 cursor-pointer group"
      >
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full border bg-card shadow-sm transition-all",
            status === "working" &&
              "animate-[glow-ring_2s_ease-in-out_infinite]",
            status === "error" && "ring-2 ring-red-300",
            status === "stopped" && "opacity-50"
          )}
          style={
            status === "working"
              ? ({ "--glow-color": hexColor } as React.CSSProperties)
              : undefined
          }
        >
          <div className={cn("h-3 w-3 rounded-full", colors.dot)} />
        </div>
        <span
          className={cn(
            "text-[11px] font-medium text-muted-foreground group-hover:text-foreground transition-colors",
            status === "stopped" && "opacity-60"
          )}
        >
          {name}
        </span>
      </div>
    );
  }
);
