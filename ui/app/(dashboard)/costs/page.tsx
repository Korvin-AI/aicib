"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { BarChart } from "@/components/bar-chart";
import { StatCard } from "@/components/stat-card";
import { PageGuide } from "@/components/page-guide";
import { Button } from "@/components/ui/button";
import { useSSE } from "@/components/sse-provider";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";

interface CostEntry {
  id: number;
  agent_role: string;
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  timestamp: string;
}

interface CostsPayload {
  today: { total: number; limit: number };
  month: { total: number; limit: number };
  allTime: number;
  dailyHistory: Array<{ date: string; total: number }>;
  byAgent: Array<{ agent: string; total: number }>;
  monthlyHistory: Array<{ month: string; total: number }>;
  recentEntries: CostEntry[];
}

export default function CostsPage() {
  const [data, setData] = useState<CostsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { lastEvent } = useSSE();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/costs?pageSize=100", { cache: "no-store" });
      const payload = (await res.json()) as CostsPayload;
      if (!res.ok) {
        setError((payload as { error?: string }).error || "Failed to load costs");
        return;
      }
      setData(payload);
    } catch {
      setError("Network error while loading costs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (lastEvent?.type === "cost_update") {
      load();
    }
  }, [lastEvent, load]);

  const columns = useMemo<DataTableColumn<CostEntry>[]>(
    () => [
      {
        key: "timestamp",
        label: "Timestamp",
        sortable: true,
        render: (row) => formatDateTime(row.timestamp),
      },
      {
        key: "agent_role",
        label: "Agent",
        sortable: true,
      },
      {
        key: "session_id",
        label: "Session",
        render: (row) => (
          <span className="font-mono text-[12px] text-muted-foreground">{row.session_id}</span>
        ),
      },
      {
        key: "input_tokens",
        label: "Tokens In",
        sortable: true,
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => formatNumber(row.input_tokens),
      },
      {
        key: "output_tokens",
        label: "Tokens Out",
        sortable: true,
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => formatNumber(row.output_tokens),
      },
      {
        key: "estimated_cost_usd",
        label: "Cost",
        sortable: true,
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => formatCurrency(row.estimated_cost_usd),
      },
    ],
    []
  );

  function exportCsv() {
    if (!data?.recentEntries.length) return;

    const header = [
      "timestamp",
      "agent_role",
      "session_id",
      "input_tokens",
      "output_tokens",
      "estimated_cost_usd",
    ];

    const lines = data.recentEntries.map((entry) =>
      [
        entry.timestamp,
        entry.agent_role,
        entry.session_id,
        entry.input_tokens,
        entry.output_tokens,
        entry.estimated_cost_usd,
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );

    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aicib-cost-log-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const todayProgress =
    data && data.today.limit > 0 ? Math.min((data.today.total / data.today.limit) * 100, 100) : 0;
  const monthProgress =
    data && data.month.limit > 0 ? Math.min((data.month.total / data.month.limit) * 100, 100) : 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Costs</h1>
      </div>
      <p className="-mt-2 mb-3 text-[12px] text-muted-foreground">
        Financial usage only: token volume and estimated spend.
      </p>
      <PageGuide
        useFor="tracking spend, token usage, and budget health over time."
        notFor="reviewing execution events or operational activity details."
        goTo="Activity for timeline-based job and agent outputs."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          label="Today's Spend"
          value={loading || !data ? "--" : formatCurrency(data.today.total)}
          secondary={loading || !data ? "" : `/ ${formatCurrency(data.today.limit)} limit`}
          progressValue={todayProgress}
          trend={todayProgress >= 100 ? "down" : "neutral"}
        />
        <StatCard
          label="Monthly Spend"
          value={loading || !data ? "--" : formatCurrency(data.month.total)}
          secondary={loading || !data ? "" : `/ ${formatCurrency(data.month.limit)} limit`}
          progressValue={monthProgress}
          trend={monthProgress >= 100 ? "down" : "neutral"}
        />
        <StatCard
          label="All-Time Spend"
          value={loading || !data ? "--" : formatCurrency(data.allTime)}
          secondary="Accumulated total"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-border/80 bg-card p-3">
          <h2 className="mb-2 text-[13px] font-medium">Daily Spend (14 days)</h2>
          <BarChart
            data={(data?.dailyHistory || []).map((item) => ({
              label: item.date.slice(5),
              value: item.total,
            }))}
            valueFormatter={(value) => `$${value.toFixed(2)}`}
            emptyMessage="No daily cost data"
          />
        </div>

        <div className="rounded-lg border border-border/80 bg-card p-3">
          <h2 className="mb-2 text-[13px] font-medium">Spend by Agent</h2>
          <BarChart
            orientation="horizontal"
            data={(data?.byAgent || []).map((item) => ({
              label: item.agent,
              value: item.total,
            }))}
            valueFormatter={(value) => `$${value.toFixed(2)}`}
            emptyMessage="No agent cost data"
          />
        </div>

        <div className="rounded-lg border border-border/80 bg-card p-3">
          <h2 className="mb-2 text-[13px] font-medium">Monthly Trend</h2>
          <BarChart
            data={(data?.monthlyHistory || []).map((item) => ({
              label: item.month,
              value: item.total,
            }))}
            valueFormatter={(value) => `$${value.toFixed(2)}`}
            emptyMessage="No monthly trend data"
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/80 bg-card p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium">Cost Log</h2>
          <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={exportCsv}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
        <DataTable
          rows={data?.recentEntries || []}
          columns={columns}
          emptyMessage={loading ? "Loading cost entries..." : "No cost entries yet"}
          defaultPageSize={20}
          getRowKey={(row) => String(row.id)}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Not shown here: job-by-job execution events and agent status transitions.
        </p>
      </div>
    </div>
  );
}
