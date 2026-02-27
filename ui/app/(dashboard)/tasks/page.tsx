"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/filter-bar";
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
  deadline: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  blocker_count: number;
  comment_count: number;
}

interface TaskDetailResponse {
  task: Task;
  blockers: Array<{ blocker_id: number; title: string; status: string; priority: string }>;
  comments: Array<{ id: number; author: string; content: string; comment_type: string; created_at: string }>;
  subtasks: Array<{ id: number; title: string; status: string; priority: string; assignee: string | null }>;
}

const columnOrder: Array<{ key: Task["status"]; label: string }> = [
  { key: "backlog", label: "Backlog" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
];

const priorityClasses: Record<Task["priority"], string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
  low: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

interface TaskListPayload {
  tasks: Task[];
  statusCounts: Record<string, number>;
  filters: {
    assignees: string[];
    departments: string[];
    projects: string[];
  };
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center px-5 py-4 text-[13px] text-muted-foreground">
          Loading tasks...
        </div>
      }
    >
      <TasksPageContent />
    </Suspense>
  );
}

function TasksPageContent() {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<TaskListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");

  const { lastEvent } = useSSE();

  const projectOptions = useMemo(() => {
    const values = new Set(payload?.filters.projects || []);
    if (projectFilter !== "all") {
      values.add(projectFilter);
    }

    return [
      { value: "all", label: "All" },
      ...Array.from(values).map((project) => ({
        value: project,
        label: project,
      })),
    ];
  }, [payload?.filters.projects, projectFilter]);

  const loadTasks = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        priority: priorityFilter,
        assignee: assigneeFilter,
        department: departmentFilter,
        project: projectFilter,
        pageSize: "200",
      });

      const res = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as TaskListPayload;
      if (!res.ok) {
        setError((data as { error?: string }).error || "Failed to load tasks");
        return;
      }
      setPayload(data);
    } catch {
      setError("Network error while loading tasks");
    } finally {
      setLoading(false);
    }
  }, [assigneeFilter, departmentFilter, priorityFilter, projectFilter, statusFilter]);

  const loadTaskDetail = useCallback(async (taskId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
      const data = (await res.json()) as TaskDetailResponse;
      if (!res.ok) {
        setTaskDetail(null);
        return;
      }
      setTaskDetail(data);
    } catch {
      setTaskDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const projectParam = searchParams.get("project");
    if (projectParam && projectParam.trim()) {
      setProjectFilter(projectParam.trim());
    } else {
      setProjectFilter("all");
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedTaskId) {
      loadTaskDetail(selectedTaskId);
    }
  }, [loadTaskDetail, selectedTaskId]);

  useEffect(() => {
    if (lastEvent?.type === "task_update") {
      loadTasks();
      if (selectedTaskId) {
        loadTaskDetail(selectedTaskId);
      }
    }
  }, [lastEvent, loadTaskDetail, loadTasks, selectedTaskId]);

  const grouped = useMemo(() => {
    const groups: Record<string, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
      cancelled: [],
    };

    for (const task of payload?.tasks || []) {
      if (task.status in groups) {
        groups[task.status].push(task);
      }
    }

    return groups;
  }, [payload?.tasks]);

  return (
    <>
      <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
            <p className="text-[12px] text-muted-foreground">
              Read-only board. Create or edit tasks via CLI or brief input.
            </p>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mb-4 rounded-lg border border-border/80 bg-card p-3">
          <FilterBar
            filters={[
              {
                key: "status",
                label: "Status",
                value: statusFilter,
                options: [
                  { value: "all", label: "All" },
                  { value: "backlog", label: "Backlog" },
                  { value: "todo", label: "To Do" },
                  { value: "in_progress", label: "In Progress" },
                  { value: "in_review", label: "In Review" },
                  { value: "done", label: "Done" },
                  { value: "cancelled", label: "Cancelled" },
                ],
              },
              {
                key: "priority",
                label: "Priority",
                value: priorityFilter,
                options: [
                  { value: "all", label: "All" },
                  { value: "critical", label: "Critical" },
                  { value: "high", label: "High" },
                  { value: "medium", label: "Medium" },
                  { value: "low", label: "Low" },
                ],
              },
              {
                key: "assignee",
                label: "Assignee",
                value: assigneeFilter,
                options: [
                  { value: "all", label: "All" },
                  ...(payload?.filters.assignees || []).map((assignee) => ({
                    value: assignee,
                    label: assignee,
                  })),
                ],
              },
              {
                key: "department",
                label: "Department",
                value: departmentFilter,
                options: [
                  { value: "all", label: "All" },
                  ...(payload?.filters.departments || []).map((department) => ({
                    value: department,
                    label: department,
                  })),
                ],
              },
              {
                key: "project",
                label: "Project",
                value: projectFilter,
                options: projectOptions,
              },
            ]}
            onChange={(key, value) => {
              if (key === "status") setStatusFilter(value);
              if (key === "priority") setPriorityFilter(value);
              if (key === "assignee") setAssigneeFilter(value);
              if (key === "department") setDepartmentFilter(value);
              if (key === "project") setProjectFilter(value);
            }}
          />
        </div>

        <div className="grid min-w-max flex-1 grid-cols-6 gap-3 overflow-x-auto pb-4">
          {columnOrder.map((column) => (
            <div key={column.key} className="flex min-h-[420px] w-[260px] flex-col rounded-lg border border-border/80 bg-card">
              <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {column.label}
                </h2>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {grouped[column.key].length}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {loading ? (
                  <p className="px-1 py-2 text-[12px] text-muted-foreground">Loading...</p>
                ) : grouped[column.key].length === 0 ? (
                  <p className="px-1 py-2 text-[12px] text-muted-foreground">No tasks</p>
                ) : (
                  grouped[column.key].map((task) => {
                    const color = task.assignee ? getAgentColorClasses(task.assignee) : null;
                    return (
                      <button
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        className="rounded-md border border-border/70 bg-background p-2 text-left transition-colors hover:border-border hover:bg-muted/30"
                      >
                        <p className="line-clamp-2 text-[13px] font-medium text-foreground">{task.title}</p>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] capitalize", priorityClasses[task.priority])}
                          >
                            {task.priority}
                          </Badge>

                          {task.assignee ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              <span className={cn("h-1.5 w-1.5 rounded-full", color?.dot)} />
                              {task.assignee}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Unassigned</span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                          {task.department ? <span>{task.department}</span> : null}

                          {task.blocker_count > 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-600">
                              <AlertTriangle className="h-3 w-3" />
                              {task.blocker_count}
                            </span>
                          ) : null}

                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {task.comment_count}
                          </span>

                          {task.deadline ? <span>{formatRelativeTimeDetailed(task.deadline)}</span> : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Sheet open={!!selectedTaskId} onOpenChange={(open) => !open && setSelectedTaskId(null)}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="text-base">Task Details</SheetTitle>
            <SheetDescription className="text-[12px]">
              Read-only web view. Use CLI or brief for changes.
            </SheetDescription>
          </SheetHeader>

          {detailLoading ? (
            <div className="px-4 py-3 text-[13px] text-muted-foreground">Loading task details...</div>
          ) : !taskDetail ? (
            <div className="px-4 py-3 text-[13px] text-muted-foreground">Task details not available.</div>
          ) : (
            <div className="space-y-4 px-4 pb-5">
              <div>
                <h3 className="text-[15px] font-semibold leading-tight text-foreground">
                  {taskDetail.task.title}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {taskDetail.task.description || "No description"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{taskDetail.task.status.replaceAll("_", " ")}</p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Priority</p>
                  <p className="font-medium capitalize">{taskDetail.task.priority}</p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Assignee</p>
                  <p className="font-medium">{taskDetail.task.assignee || "Unassigned"}</p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Reviewer</p>
                  <p className="font-medium">{taskDetail.task.reviewer || "-"}</p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Department</p>
                  <p className="font-medium">{taskDetail.task.department || "-"}</p>
                </div>
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Project</p>
                  <p className="font-medium">{taskDetail.task.project || "-"}</p>
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Blockers</p>
                {taskDetail.blockers.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No blockers</p>
                ) : (
                  <div className="space-y-1">
                    {taskDetail.blockers.map((blocker) => (
                      <div key={blocker.blocker_id} className="rounded border border-border/70 px-2 py-1.5 text-[12px]">
                        <p className="font-medium text-foreground">#{blocker.blocker_id} {blocker.title}</p>
                        <p className="text-muted-foreground">{blocker.status}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Comments</p>
                {taskDetail.comments.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No comments</p>
                ) : (
                  <div className="space-y-2">
                    {taskDetail.comments.map((comment) => (
                      <div key={comment.id} className="rounded border border-border/70 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-medium text-foreground">{comment.author}</p>
                          <p className="text-[11px] text-muted-foreground">{formatRelativeTime(comment.created_at)}</p>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-muted-foreground">
                <p>Created by {taskDetail.task.created_by} on {formatDateTime(taskDetail.task.created_at)}</p>
                <p>Updated {formatDateTime(taskDetail.task.updated_at)}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
