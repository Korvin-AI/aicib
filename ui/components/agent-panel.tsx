"use client";

import { useEffect, useState } from "react";
import { getAgentColorClasses } from "@/lib/agent-colors";
import { cn, formatRelativeTime } from "@/lib/utils";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface Agent {
  role: string;
  model: string;
  department: string;
  enabled: boolean;
  status: string;
  currentTask: string | null;
  displayName?: string | null;
}

interface LogEntry {
  id: number;
  job_id: number;
  timestamp: string;
  message_type: string;
  agent_role: string;
  content: string;
}

interface AgentInsights {
  role: string;
  profile: {
    model: string;
    department: string;
    enabled: boolean;
    displayName: string | null;
    status: string;
    lastActivity: string | null;
    currentTask: string | null;
  };
  taskStats: {
    byStatus: Array<{ status: string; count: number }>;
    totalAssigned: number;
  };
  costStats: {
    total: number;
    entries: number;
    average: number;
  };
  hr: {
    onboarding: Record<string, unknown> | null;
    reviews: Array<Record<string, unknown>>;
  };
  journals: Array<Record<string, unknown>>;
}

interface AgentPanelProps {
  agent: Agent | null;
  logs: LogEntry[];
  agents: Agent[];
  open: boolean;
  onClose: () => void;
}

const displayNames: Record<string, string> = {
  ceo: "CEO",
  cto: "CTO",
  cfo: "CFO",
  cmo: "CMO",
  "backend-engineer": "Backend Engineer",
  "frontend-engineer": "Frontend Engineer",
  "financial-analyst": "Financial Analyst",
  "content-writer": "Content Writer",
};

const statusLabels: Record<string, { label: string; className: string }> = {
  working: {
    label: "Working",
    className: "bg-emerald-100 text-emerald-700",
  },
  idle: { label: "Idle", className: "bg-zinc-100 text-zinc-700" },
  error: { label: "Error", className: "bg-red-100 text-red-700" },
  stopped: { label: "Stopped", className: "bg-zinc-100 text-zinc-500" },
};

function getReportsTo(agent: Agent): string | null {
  if (agent.role === "ceo") return null;
  if (agent.department === agent.role) return "CEO";
  return displayNames[agent.department] || agent.department.toUpperCase();
}

function getManages(agent: Agent, allAgents: Agent[]): string[] {
  if (agent.role === "ceo") {
    return allAgents
      .filter((a) => a.department === a.role && a.role !== "ceo")
      .map((a) => displayNames[a.role] || a.role);
  }
  return allAgents
    .filter((a) => a.department === agent.role && a.role !== agent.role)
    .map((a) => displayNames[a.role] || a.role);
}

export function AgentPanel({
  agent,
  logs,
  agents,
  open,
  onClose,
}: AgentPanelProps) {
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  useEffect(() => {
    if (!agent?.role) {
      return;
    }

    setLoadingInsights(true);
    fetch(`/api/agents/${agent.role}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.error) {
          setInsights(null);
        } else {
          setInsights(data as AgentInsights);
        }
      })
      .catch(() => {
        setInsights(null);
      })
      .finally(() => {
        setLoadingInsights(false);
      });
  }, [agent?.role]);

  if (!agent) return null;

  const colors = getAgentColorClasses(agent.role);
  const name = agent.displayName || insights?.profile.displayName || displayNames[agent.role] || agent.role;
  const roleLabel = displayNames[agent.role] || agent.role;
  const status = statusLabels[agent.status] || statusLabels.stopped;
  const reportsTo = getReportsTo(agent);
  const manages = getManages(agent, agents);

  const latestReview = insights?.hr.reviews[0];

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className={cn("h-3 w-3 rounded-full", colors.dot)} />
            <SheetTitle className="text-base">{name}</SheetTitle>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                status.className
              )}
            >
              {status.label}
            </span>
          </div>
          <SheetDescription className="text-[12px]">
            {roleLabel} · {agent.model} · {agent.department}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-4">
          {(agent.status === "working" && agent.currentTask) || insights?.profile.currentTask ? (
            <div>
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Current Task
              </h4>
              <p className="text-[13px] leading-relaxed text-foreground">
                {insights?.profile.currentTask || agent.currentTask}
              </p>
            </div>
          ) : null}

          <div>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Relationships
            </h4>
            <div className="flex flex-col gap-1.5">
              {reportsTo ? (
                <p className="text-[13px] text-muted-foreground">
                  Reports to: <span className="text-foreground">{reportsTo}</span>
                </p>
              ) : null}
              {manages.length > 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  Manages: <span className="text-foreground">{manages.join(", ")}</span>
                </p>
              ) : null}
              {!reportsTo && manages.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No direct reports</p>
              ) : null}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Performance Snapshot
            </h4>
            {loadingInsights ? (
              <p className="text-[13px] text-muted-foreground">Loading details...</p>
            ) : !insights ? (
              <p className="text-[13px] text-muted-foreground">No additional metrics available.</p>
            ) : (
              <div className="space-y-2 text-[12px]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Tasks Assigned</p>
                    <p className="font-medium text-foreground">{insights.taskStats.totalAssigned}</p>
                  </div>
                  <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Cost Total</p>
                    <p className="font-medium text-foreground">{formatCurrency(insights.costStats.total)}</p>
                  </div>
                </div>

                <div className="rounded border border-border/70 px-2 py-1.5">
                  <p className="text-[11px] text-muted-foreground">Avg Cost per Entry</p>
                  <p className="font-medium text-foreground">{formatCurrency(insights.costStats.average)}</p>
                </div>

                {insights.hr.onboarding ? (
                  <div className="rounded border border-border/70 px-2 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Onboarding</p>
                    <p className="font-medium text-foreground">
                      Phase {String(insights.hr.onboarding["current_phase"] || "-")}/4
                    </p>
                  </div>
                ) : null}

                {latestReview ? (
                  <div className="rounded border border-border/70 px-2 py-1.5">
                    <p className="text-[11px] text-muted-foreground">Latest Review</p>
                    <p className="font-medium text-foreground">
                      {Number(latestReview["overall_score"] || 0).toFixed(1)} (
                      {String(latestReview["recommendation"] || "maintain")})
                    </p>
                  </div>
                ) : null}

                {insights.journals.length > 0 ? (
                  <div className="rounded border border-border/70 px-2 py-1.5">
                    <p className="mb-1 text-[11px] text-muted-foreground">Recent Journal</p>
                    <p className="text-[12px] text-foreground">
                      {String(insights.journals[0].title || "Untitled")}
                    </p>
                  </div>
                ) : null}

                {insights.profile.lastActivity ? (
                  <p className="text-[11px] text-muted-foreground">
                    Last activity: {formatDateTime(insights.profile.lastActivity)}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Recent Activity
            </h4>
            {logs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No recent activity</p>
            ) : (
              <div className="flex flex-col gap-2">
                {logs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(log.timestamp)}
                    </span>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {log.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
