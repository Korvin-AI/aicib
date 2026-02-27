/**
 * Agent role → Tailwind CSS classes mapping.
 * Mirrors the color scheme from src/core/output-formatter.ts.
 */

export interface AgentColorClasses {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

const colorMap: Record<string, AgentColorClasses> = {
  ceo: {
    bg: "bg-agent-ceo/10",
    text: "text-agent-ceo",
    border: "border-agent-ceo/40",
    dot: "bg-agent-ceo",
  },
  cto: {
    bg: "bg-agent-cto/10",
    text: "text-agent-cto",
    border: "border-agent-cto/40",
    dot: "bg-agent-cto",
  },
  cfo: {
    bg: "bg-agent-cfo/10",
    text: "text-agent-cfo",
    border: "border-agent-cfo/40",
    dot: "bg-agent-cfo",
  },
  cmo: {
    bg: "bg-agent-cmo/10",
    text: "text-agent-cmo",
    border: "border-agent-cmo/40",
    dot: "bg-agent-cmo",
  },
  "backend-engineer": {
    bg: "bg-agent-backend/10",
    text: "text-agent-backend",
    border: "border-agent-backend/40",
    dot: "bg-agent-backend",
  },
  "frontend-engineer": {
    bg: "bg-agent-frontend/10",
    text: "text-agent-frontend",
    border: "border-agent-frontend/40",
    dot: "bg-agent-frontend",
  },
  "financial-analyst": {
    bg: "bg-agent-analyst/10",
    text: "text-agent-analyst",
    border: "border-agent-analyst/40",
    dot: "bg-agent-analyst",
  },
  "content-writer": {
    bg: "bg-agent-writer/10",
    text: "text-agent-writer",
    border: "border-agent-writer/40",
    dot: "bg-agent-writer",
  },
  system: {
    bg: "bg-agent-system/10",
    text: "text-agent-system",
    border: "border-agent-system/40",
    dot: "bg-agent-system",
  },
};

const hexColorMap: Record<string, string> = {
  ceo: "#a855f7",
  cto: "#3b82f6",
  cfo: "#22c55e",
  cmo: "#f59e0b",
  "backend-engineer": "#06b6d4",
  "frontend-engineer": "#818cf8",
  "financial-analyst": "#4ade80",
  "content-writer": "#fbbf24",
  system: "#6b7280",
};

export function getAgentHexColor(role: string): string {
  return hexColorMap[role] || "#6b7280";
}

const defaultColors: AgentColorClasses = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  border: "border-muted",
  dot: "bg-muted-foreground",
};

export function getAgentColorClasses(role: string): AgentColorClasses {
  return colorMap[role] || defaultColors;
}
