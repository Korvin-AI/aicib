"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AgentPanel } from "@/components/agent-panel";
import { OrgChart } from "@/components/org-chart";
import { getAgentColorClasses } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";
import { useSSE } from "@/components/sse-provider";

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

interface StatusPayload {
  agents: Agent[];
  recentLogs: LogEntry[];
}

const statusTone: Record<string, string> = {
  working: "text-emerald-700 bg-emerald-100",
  idle: "text-zinc-700 bg-zinc-100",
  stopped: "text-zinc-500 bg-zinc-100",
  error: "text-red-700 bg-red-100",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"cards" | "org">("cards");

  const { lastEvent } = useSSE();

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: StatusPayload & { error?: string }) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setAgents(data.agents || []);
        setLogs(data.recentLogs || []);
      })
      .catch(() => {
        setError("Failed to load team data");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (lastEvent?.type === "agent_status") {
      fetch("/api/status", { cache: "no-store" })
        .then((res) => res.json())
        .then((data: StatusPayload) => {
          setAgents(data.agents || []);
          setLogs(data.recentLogs || []);
        })
        .catch(() => {});
    }
  }, [lastEvent]);

  const grouped = useMemo(() => {
    const ceo = agents.find((agent) => agent.role === "ceo") || null;
    const executives = agents.filter(
      (agent) => agent.department === agent.role && agent.role !== "ceo"
    );
    const workers = agents.filter(
      (agent) => agent.department !== agent.role && agent.role !== "ceo"
    );

    return { ceo, executives, workers };
  }, [agents]);

  const currentSelected = selectedAgent
    ? agents.find((agent) => agent.role === selectedAgent.role) || null
    : null;

  const selectedLogs = currentSelected
    ? logs
        .filter((entry) => entry.agent_role === currentSelected.role)
        .slice(0, 12)
    : [];

  return (
    <>
      <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Team</h1>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            <button
              onClick={() => setView("cards")}
              className={cn(
                "rounded px-2.5 py-1 text-[12px] transition-colors",
                view === "cards"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              Cards
            </button>
            <button
              onClick={() => setView("org")}
              className={cn(
                "rounded px-2.5 py-1 text-[12px] transition-colors",
                view === "org"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              Org Chart
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        {view === "org" ? (
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/80 bg-card">
            <OrgChart />
          </div>
        ) : loading ? (
          <p className="text-[13px] text-muted-foreground">Loading team...</p>
        ) : agents.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No agents configured.
          </p>
        ) : (
          <div className="space-y-5">
            {grouped.ceo ? (
              <section>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Leadership</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <AgentCard agent={grouped.ceo} onOpen={() => setSelectedAgent(grouped.ceo)} />
                  {grouped.executives.map((agent) => (
                    <AgentCard key={agent.role} agent={agent} onOpen={() => setSelectedAgent(agent)} />
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Workers</p>
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                {grouped.workers.map((agent) => (
                  <AgentCard key={agent.role} agent={agent} onOpen={() => setSelectedAgent(agent)} compact />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      <AgentPanel
        agent={currentSelected}
        logs={selectedLogs}
        agents={agents}
        open={view === "cards" && !!currentSelected}
        onClose={() => setSelectedAgent(null)}
      />
    </>
  );
}

function AgentCard({
  agent,
  onOpen,
  compact,
}: {
  agent: Agent;
  onOpen: () => void;
  compact?: boolean;
}) {
  const color = getAgentColorClasses(agent.role);
  const display = agent.displayName || agent.role.toUpperCase();

  return (
    <button
      onClick={onOpen}
      className={cn(
        "rounded-lg border border-border/80 bg-card p-3 text-left transition-colors hover:border-border hover:bg-muted/20",
        compact && "p-2.5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={cn("text-[11px] font-semibold uppercase tracking-wide", color.text)}>{agent.role}</p>
          <p className="text-[13px] font-medium text-foreground">{display}</p>
        </div>
        <Badge variant="outline" className={cn("capitalize text-[10px]", statusTone[agent.status] || statusTone.stopped)}>
          {agent.status}
        </Badge>
      </div>

      <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
        <p>Model: <span className="text-foreground">{agent.model}</span></p>
        <p>Department: <span className="text-foreground">{agent.department}</span></p>
        {agent.currentTask ? (
          <p className="line-clamp-2">Task: <span className="text-foreground">{agent.currentTask}</span></p>
        ) : null}
      </div>
    </button>
  );
}
