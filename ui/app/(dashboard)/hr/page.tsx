"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { formatDate, formatDateTime } from "@/lib/format";

interface HrPayload {
  tab: "overview" | "reviews" | "onboarding" | "plans";
  stats?: {
    activeAgents: number;
    avgReviewScore: number;
    activePlans: number;
    pendingAutoReviews: number;
  };
  recentEvents?: Record<string, unknown>[];
  entries?: Record<string, unknown>[];
  filters?: {
    agents?: string[];
    types?: string[];
    statuses?: string[];
  };
}

export default function HrPage() {
  const [tab, setTab] = useState<"overview" | "reviews" | "onboarding" | "plans">("overview");
  const [data, setData] = useState<HrPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agentFilter, setAgentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setError(null);

    const params = new URLSearchParams({ tab });
    if (tab === "reviews") {
      params.set("agent", agentFilter);
      params.set("type", typeFilter);
    }
    if (tab === "plans") {
      params.set("status", statusFilter);
    }

    try {
      const res = await fetch(`/api/hr?${params.toString()}`, { cache: "no-store" });
      const payload = (await res.json()) as HrPayload;
      if (!res.ok) {
        setError((payload as { error?: string }).error || "Failed to load HR data");
        return;
      }
      setData(payload);
    } catch {
      setError("Network error while loading HR data");
    } finally {
      setLoading(false);
    }
  }, [agentFilter, statusFilter, tab, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const reviewColumns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () => [
      { key: "agent_role", label: "Agent", sortable: true },
      { key: "reviewer", label: "Reviewer", sortable: true },
      {
        key: "review_type",
        label: "Type",
        sortable: true,
        render: (row) => String(row.review_type || "").replaceAll("_", " "),
      },
      {
        key: "task_score",
        label: "Task",
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => String(row.task_score ?? "-"),
      },
      {
        key: "quality_score",
        label: "Quality",
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => String(row.quality_score ?? "-"),
      },
      {
        key: "efficiency_score",
        label: "Efficiency",
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => String(row.efficiency_score ?? "-"),
      },
      {
        key: "collaboration_score",
        label: "Collab",
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => String(row.collaboration_score ?? "-"),
      },
      {
        key: "overall_score",
        label: "Overall",
        sortable: true,
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => Number(row.overall_score || 0).toFixed(1),
      },
      { key: "recommendation", label: "Recommendation", sortable: true },
    ],
    []
  );

  const onboardingColumns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () => [
      { key: "agent_role", label: "Agent", sortable: true },
      {
        key: "current_phase",
        label: "Phase",
        sortable: true,
        render: (row) => `${row.current_phase}/4`,
      },
      {
        key: "phase_started_at",
        label: "Started",
        render: (row) => formatDate(String(row.phase_started_at || "")),
      },
      { key: "mentor", label: "Mentor", render: (row) => String(row.mentor || "-") },
      { key: "ramp_speed", label: "Ramp", sortable: true },
      {
        key: "completed_at",
        label: "Completed",
        render: (row) => formatDate(String(row.completed_at || "")),
      },
    ],
    []
  );

  const plansColumns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () => [
      { key: "agent_role", label: "Agent", sortable: true },
      { key: "created_by", label: "Created By", sortable: true },
      {
        key: "goals",
        label: "Goals",
        render: (row) => String(row.goals || "[]"),
      },
      {
        key: "deadline",
        label: "Deadline",
        render: (row) => formatDate(String(row.deadline || "")),
      },
      { key: "status", label: "Status", sortable: true },
      {
        key: "created_at",
        label: "Created",
        render: (row) => formatDate(String(row.created_at || "")),
      },
    ],
    []
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">HR</h1>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="plans">Improvement Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard
              label="Active Agents"
              value={loading ? "--" : String(data?.stats?.activeAgents ?? 0)}
            />
            <StatCard
              label="Avg Review"
              value={loading ? "--" : Number(data?.stats?.avgReviewScore ?? 0).toFixed(1)}
            />
            <StatCard
              label="Active Plans"
              value={loading ? "--" : String(data?.stats?.activePlans ?? 0)}
            />
            <StatCard
              label="Pending Auto-Reviews"
              value={loading ? "--" : String(data?.stats?.pendingAutoReviews ?? 0)}
            />
          </div>

          <div className="mt-4 rounded-lg border border-border/80 bg-card p-3">
            <h2 className="mb-3 text-[13px] font-medium">Recent HR Events</h2>
            <div className="space-y-2">
              {loading ? (
                <p className="text-[13px] text-muted-foreground">Loading events...</p>
              ) : (data?.recentEvents || []).length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No HR events yet.</p>
              ) : (
                (data?.recentEvents || []).map((event, index) => (
                  <div key={String(event.id || index)} className="flex items-center justify-between rounded border border-border/70 px-2 py-1.5">
                    <div className="text-[12px]">
                      <span className="font-medium text-foreground">{String(event.agent_role || "-")}</span>
                      <span className="mx-1 text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{String(event.event_type || "event")}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{formatDateTime(String(event.created_at || ""))}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="reviews">
          <div className="mb-3 rounded-lg border border-border/80 bg-card p-3">
            <FilterBar
              filters={[
                {
                  key: "agent",
                  label: "Agent",
                  value: agentFilter,
                  options: [
                    { value: "all", label: "All" },
                    ...((data?.filters?.agents || []).map((item) => ({ value: item, label: item }))),
                  ],
                },
                {
                  key: "type",
                  label: "Type",
                  value: typeFilter,
                  options: [
                    { value: "all", label: "All" },
                    ...((data?.filters?.types || []).map((item) => ({ value: item, label: item }))),
                  ],
                },
              ]}
              onChange={(key, value) => {
                if (key === "agent") setAgentFilter(value);
                if (key === "type") setTypeFilter(value);
              }}
            />
          </div>

          <DataTable
            rows={data?.entries || []}
            columns={reviewColumns}
            emptyMessage={loading ? "Loading reviews..." : "No reviews found"}
            defaultPageSize={20}
            getRowKey={(row, index) =>
              String(row.id || row.created_at || row.agent_role || `review-${index}`)
            }
          />
        </TabsContent>

        <TabsContent value="onboarding">
          <DataTable
            rows={data?.entries || []}
            columns={onboardingColumns}
            emptyMessage={loading ? "Loading onboarding records..." : "No onboarding records"}
            defaultPageSize={20}
            getRowKey={(row, index) =>
              String(row.agent_role || row.id || row.phase_started_at || `onboarding-${index}`)
            }
          />
        </TabsContent>

        <TabsContent value="plans">
          <div className="mb-3 rounded-lg border border-border/80 bg-card p-3">
            <FilterBar
              filters={[
                {
                  key: "status",
                  label: "Status",
                  value: statusFilter,
                  options: [
                    { value: "all", label: "All" },
                    ...((data?.filters?.statuses || []).map((item) => ({ value: item, label: item }))),
                  ],
                },
              ]}
              onChange={(key, value) => {
                if (key === "status") setStatusFilter(value);
              }}
            />
          </div>

          <DataTable
            rows={data?.entries || []}
            columns={plansColumns}
            emptyMessage={loading ? "Loading plans..." : "No improvement plans"}
            defaultPageSize={20}
            getRowKey={(row, index) =>
              String(row.id || row.created_at || row.agent_role || `plan-${index}`)
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
