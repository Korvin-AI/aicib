"use client";

import { formatCurrency, formatDateTime } from "@/lib/format";

interface HomeContextData {
  session?: {
    active?: boolean;
    sessionId?: string | null;
  };
  agents?: Array<{ role: string; status: string }>;
  tasks?: Record<string, number>;
  costs?: {
    today?: number;
    month?: number;
    dailyLimit?: number;
    monthlyLimit?: number;
  };
  recentJobs?: Array<{
    id: number;
    directive: string;
    status: string;
    started_at: string | null;
  }>;
}

interface ContextPanelProps {
  loading?: boolean;
  data: HomeContextData | null;
}

export function ContextPanel({ loading, data }: ContextPanelProps) {
  const agents = data?.agents || [];
  const workingAgents = agents.filter((agent) => agent.status === "working").length;

  const tasks = data?.tasks || {};
  const costs = data?.costs || {};
  const recentJobs = (data?.recentJobs || []).slice(0, 5);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border/80 bg-card">
      <div className="flex h-9 items-center border-b border-border/70 px-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Context
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loading ? <p className="text-[12px] text-muted-foreground">Loading context...</p> : null}

        <section className="rounded border border-border/70 bg-background p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Session</p>
          <p className="mt-1 text-[13px] text-foreground">
            {data?.session?.active ? "Active" : "Not active"}
          </p>
          {data?.session?.sessionId ? (
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {data.session.sessionId}
            </p>
          ) : null}
        </section>

        <section className="rounded border border-border/70 bg-background p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Team Snapshot</p>
          <p className="mt-1 text-[12px] text-foreground">Agents: {agents.length}</p>
          <p className="text-[12px] text-foreground">Working now: {workingAgents}</p>
        </section>

        <section className="rounded border border-border/70 bg-background p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Task Snapshot</p>
          <p className="mt-1 text-[12px] text-foreground">Backlog: {tasks.backlog ?? 0}</p>
          <p className="text-[12px] text-foreground">In Progress: {tasks.in_progress ?? 0}</p>
          <p className="text-[12px] text-foreground">In Review: {tasks.in_review ?? 0}</p>
          <p className="text-[12px] text-foreground">Done: {tasks.done ?? 0}</p>
        </section>

        <section className="rounded border border-border/70 bg-background p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Cost Snapshot</p>
          <p className="mt-1 text-[12px] text-foreground">
            Today: {formatCurrency(costs.today)} / {formatCurrency(costs.dailyLimit)}
          </p>
          <p className="text-[12px] text-foreground">
            Month: {formatCurrency(costs.month)} / {formatCurrency(costs.monthlyLimit)}
          </p>
        </section>

        <section className="rounded border border-border/70 bg-background p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Recent Jobs</p>
          <div className="mt-1 space-y-1.5">
            {recentJobs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No recent jobs yet.</p>
            ) : (
              recentJobs.map((job) => (
                <div key={job.id} className="rounded border border-border/60 px-1.5 py-1">
                  <p className="line-clamp-2 text-[11px] text-foreground">{job.directive}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {job.status} · {formatDateTime(job.started_at || "")}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
