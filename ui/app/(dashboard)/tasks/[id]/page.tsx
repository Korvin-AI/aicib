"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSSE } from "@/components/sse-provider";
import { getAgentColorClasses } from "@/lib/agent-colors";
import { cn, formatRelativeTime } from "@/lib/utils";
import { formatDateTime, formatRelativeTimeDetailed } from "@/lib/format";

interface Task {
  id: number;
  title: string;
  description: string;
  status: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
  priority: "critical" | "high" | "medium" | "low";
  assignee: string | null;
  reviewer: string | null;
  department: string | null;
  project: string | null;
  parent_id: number | null;
  deadline: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  output_summary: string | null;
  blocker_count: number;
  comment_count: number;
}

interface TaskDetailResponse {
  task: Task;
  blockers: Array<{ blocker_id: number; title: string; status: string; priority: string }>;
  comments: Array<{ id: number; author: string; content: string; comment_type: string; created_at: string }>;
  subtasks: Array<{ id: number; title: string; status: string; priority: string; assignee: string | null }>;
}

const priorityClasses: Record<Task["priority"], string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
  low: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

const statusClasses: Record<Task["status"], string> = {
  backlog: "bg-zinc-100 text-zinc-700",
  todo: "bg-yellow-100 text-yellow-700",
  in_progress: "bg-blue-100 text-blue-700",
  in_review: "bg-purple-100 text-purple-700",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = Number.parseInt(params.id as string, 10);
  const [detail, setDetail] = useState<TaskDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { lastEvent } = useSSE();

  const loadDetail = useCallback(async () => {
    if (!Number.isFinite(taskId) || taskId < 1) {
      setError("Invalid task ID");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load task");
        return;
      }
      setDetail(data as TaskDetailResponse);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (lastEvent?.type === "task_update") {
      loadDetail();
    }
  }, [lastEvent, loadDetail]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center px-5 py-4 text-[13px] text-muted-foreground">
        Loading task...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="px-5 py-4">
        <Link href="/tasks" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to tasks
        </Link>
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error || "Task not found"}
        </div>
      </div>
    );
  }

  const { task, blockers, comments, subtasks } = detail;
  const color = task.assignee ? getAgentColorClasses(task.assignee) : null;

  return (
    <div className="mx-auto max-w-3xl overflow-y-auto px-5 py-4">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Link href="/tasks" className="transition-colors hover:text-foreground">Tasks</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">#{task.id} {task.title}</span>
      </div>

      {/* Parent link */}
      {task.parent_id ? (
        <Link
          href={`/tasks/${task.parent_id}`}
          className="mb-3 inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[12px] text-blue-700 transition-colors hover:bg-blue-100"
        >
          <GitBranch className="h-3 w-3" />
          Parent task #{task.parent_id}
        </Link>
      ) : null}

      {/* Title */}
      <h1 className="text-xl font-semibold tracking-tight text-foreground">{task.title}</h1>
      {task.description ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{task.description}</p>
      ) : null}

      {/* Output summary */}
      {task.output_summary ? (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-700">
            {task.status === "done" ? "Output" : "Previous Output"}
          </p>
          <p className="text-[13px] leading-relaxed text-green-800">{task.output_summary}</p>
        </div>
      ) : null}

      {/* Metadata grid */}
      <div className="mt-5 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
        <MetaCard label="Status">
          <Badge variant="outline" className={cn("text-[10px] capitalize", statusClasses[task.status])}>
            {task.status.replaceAll("_", " ")}
          </Badge>
        </MetaCard>
        <MetaCard label="Priority">
          <Badge variant="outline" className={cn("text-[10px] capitalize", priorityClasses[task.priority])}>
            {task.priority}
          </Badge>
        </MetaCard>
        <MetaCard label="Assignee">
          {task.assignee ? (
            <span className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-full", color?.dot)} />
              {task.assignee}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
        </MetaCard>
        <MetaCard label="Reviewer">{task.reviewer || "-"}</MetaCard>
        <MetaCard label="Department">{task.department || "-"}</MetaCard>
        <MetaCard label="Project">{task.project || "-"}</MetaCard>
        {task.deadline ? (
          <MetaCard label="Deadline">{formatRelativeTimeDetailed(task.deadline)}</MetaCard>
        ) : null}
        <MetaCard label="Created by">{task.created_by}</MetaCard>
      </div>

      {/* Subtasks */}
      {subtasks.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Subtasks ({subtasks.length})
          </h2>
          <div className="space-y-1">
            {subtasks.map((sub) => {
              const subColor = sub.assignee ? getAgentColorClasses(sub.assignee) : null;
              return (
                <Link
                  key={sub.id}
                  href={`/tasks/${sub.id}`}
                  className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-[12px] transition-colors hover:bg-muted/30"
                >
                  {sub.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  ) : (
                    <div className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">#{sub.id} {sub.title}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-[9px] capitalize", priorityClasses[sub.priority as Task["priority"]])}
                  >
                    {sub.priority}
                  </Badge>
                  {sub.assignee ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className={cn("h-1.5 w-1.5 rounded-full", subColor?.dot)} />
                      {sub.assignee}
                    </span>
                  ) : null}
                  <span className="text-[10px] capitalize text-muted-foreground">
                    {sub.status.replaceAll("_", " ")}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Blockers */}
      <div className="mt-6">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Blockers</h2>
        {blockers.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No blockers</p>
        ) : (
          <div className="space-y-1">
            {blockers.map((b) => (
              <Link
                key={b.blocker_id}
                href={`/tasks/${b.blocker_id}`}
                className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-[12px] transition-colors hover:bg-muted/30"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="font-medium text-foreground">#{b.blocker_id} {b.title}</span>
                <span className="text-muted-foreground">{b.status}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Comments / timeline */}
      <div className="mt-6">
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            Comments ({comments.length})
          </span>
        </h2>
        {comments.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No comments</p>
        ) : (
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded border border-border/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium text-foreground">{c.author}</p>
                  <p className="text-[11px] text-muted-foreground">{formatRelativeTime(c.created_at)}</p>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="mt-6 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
        <p>Created by {task.created_by} on {formatDateTime(task.created_at)}</p>
        <p>Updated {formatDateTime(task.updated_at)}</p>
      </div>
    </div>
  );
}

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 font-medium">{children}</div>
    </div>
  );
}
