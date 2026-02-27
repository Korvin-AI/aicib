"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { PageGuide } from "@/components/page-guide";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDurationMs, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Project {
  id: number;
  title: string;
  original_brief: string;
  status: string;
  total_phases: number;
  completed_phases: number;
  phases_done?: number;
  task_total?: number;
  task_open?: number;
  task_in_progress?: number;
  task_done?: number;
  total_cost_usd: number;
  total_turns: number;
  total_duration_ms: number;
  updated_at: string;
}

interface Phase {
  id: number;
  phase_number: number;
  title: string;
  objective: string;
  status: string;
  phase_summary: string | null;
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
}

interface ProjectDetail {
  project: Project;
  phases: Phase[];
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [details, setDetails] = useState<Record<number, ProjectDetail>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/projects?pageSize=200", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load projects");
        return;
      }
      setProjects((data.entries || []) as Project[]);
    } catch {
      setError("Network error while loading projects");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (projectId: number) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      setDetails((prev) => ({ ...prev, [projectId]: data as ProjectDetail }));
    } catch {
      // Ignore detail fetch errors.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    return {
      active: projects.filter((project) => ["planning", "executing", "paused"].includes(project.status)),
      completed: projects.filter((project) => ["completed", "failed", "cancelled"].includes(project.status)),
    };
  }, [projects]);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Projects</h1>
      <PageGuide
        useFor="tracking project-level progress, phase completion, and high-level delivery status."
        notFor="managing individual task-level execution details."
        goTo="Tasks to review or work through specific project tasks."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <StatCard label="Total Projects" value={loading ? "--" : String(projects.length)} />
        <StatCard label="Active" value={loading ? "--" : String(grouped.active.length)} />
        <StatCard label="Completed / Closed" value={loading ? "--" : String(grouped.completed.length)} />
      </div>

      <section className="mb-4">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Active</h2>
        <div className="space-y-2">
          {loading ? (
            <p className="text-[13px] text-muted-foreground">Loading projects...</p>
          ) : grouped.active.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No active projects.</p>
          ) : (
            grouped.active.map((project) => {
              const isOpen = !!expanded[project.id];
              const detail = details[project.id];
              const done = Number(project.phases_done ?? project.completed_phases ?? 0);
              const total = Number(project.total_phases || 0);
              const progress = total > 0 ? Math.round((done / total) * 100) : 0;

              return (
                <div key={project.id} className="rounded-lg border border-border/80 bg-card p-3">
                  <button
                    onClick={() => {
                      setExpanded((prev) => ({ ...prev, [project.id]: !prev[project.id] }));
                      if (!details[project.id]) loadDetail(project.id);
                    }}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <p className="truncate text-[14px] font-medium text-foreground">{project.title}</p>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{project.original_brief}</p>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {project.status}
                    </Badge>
                  </button>

                  <div className="mt-3 grid gap-2 text-[12px] text-muted-foreground md:grid-cols-4">
                    <span>Phases: {done}/{total}</span>
                    <span>Cost: {formatCurrency(project.total_cost_usd)}</span>
                    <span>Turns: {project.total_turns}</span>
                    <span>Duration: {formatDurationMs(project.total_duration_ms)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span>Tasks: {project.task_total ?? 0}</span>
                    <span>Open: {project.task_open ?? 0}</span>
                    <span>In Progress: {project.task_in_progress ?? 0}</span>
                    <span>Done: {project.task_done ?? 0}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded bg-muted">
                    <div className="h-1.5 rounded bg-indigo-500" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-2">
                    <Link
                      href={`/tasks?project=${encodeURIComponent(project.title)}`}
                      className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      View related tasks
                    </Link>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 space-y-2 rounded border border-border/70 bg-background p-2">
                      {!detail ? (
                        <p className="text-[12px] text-muted-foreground">Loading phase details...</p>
                      ) : detail.phases.length === 0 ? (
                        <p className="text-[12px] text-muted-foreground">No phases yet.</p>
                      ) : (
                        detail.phases.map((phase) => (
                          <div key={phase.id} className="rounded border border-border/60 px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[12px] font-medium text-foreground">Phase {phase.phase_number}: {phase.title}</p>
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {phase.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-[12px] text-muted-foreground">{phase.objective}</p>
                            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                              <span>Cost: {formatCurrency(phase.cost_usd)}</span>
                              <span>Turns: {phase.num_turns}</span>
                              <span>Duration: {formatDurationMs(phase.duration_ms)}</span>
                            </div>
                            <div className="mt-1">
                              <Link
                                href={`/tasks?project=${encodeURIComponent(project.title)}`}
                                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              >
                                View related tasks
                              </Link>
                            </div>
                            {phase.phase_summary ? (
                              <p className="mt-1 text-[12px] text-muted-foreground">{phase.phase_summary}</p>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Completed / Closed</h2>
        <div className="space-y-2">
          {grouped.completed.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No completed projects.</p>
          ) : (
            grouped.completed.map((project) => (
              <div key={project.id} className="rounded-lg border border-border/80 bg-card px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{project.title}</p>
                    <p className="text-[12px] text-muted-foreground">{project.original_brief}</p>
                  </div>
                  <Badge variant="outline" className={cn("capitalize", project.status === "completed" && "border-emerald-200 text-emerald-700")}>{project.status}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>Phases: {project.completed_phases}/{project.total_phases}</span>
                  <span>Cost: {formatCurrency(project.total_cost_usd)}</span>
                  <span>Tasks: {project.task_total ?? 0}</span>
                  <span>Duration: {formatDurationMs(project.total_duration_ms)}</span>
                  <span>Updated: {formatDateTime(project.updated_at)}</span>
                </div>
                <div className="mt-2">
                  <Link
                    href={`/tasks?project=${encodeURIComponent(project.title)}`}
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    View related tasks
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
