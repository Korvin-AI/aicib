"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatCard } from "@/components/stat-card";
import { formatCurrency, formatDateTime } from "@/lib/format";

interface SettingsPayload {
  company: {
    name: string;
    template: string;
    projectDir: string;
  };
  settings: {
    costLimitDaily: number;
    costLimitMonthly: number;
    schedulerEnabled: boolean;
    safeguardsEnabled: boolean;
    trustEnabled: boolean;
    notificationsEnabled: boolean;
  };
  scheduler: {
    state: Record<string, string>;
    schedules: Record<string, unknown>[];
  };
  mcpIntegrations: Record<string, unknown>[];
  notifications: {
    summary: Array<{ status: string; count: number }>;
    preference: Record<string, unknown> | null;
  };
  safeguards: {
    pendingCount: number;
    externalActions: Array<{ outcome: string; count: number }>;
  };
  companyEvents: Record<string, unknown>[];
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload: SettingsPayload & { error?: string }) => {
        if (payload.error) {
          setError(payload.error);
          return;
        }
        setData(payload);
      })
      .catch(() => {
        setError("Failed to load settings");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const mcpColumns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () => [
      { key: "server_name", label: "Server", sortable: true },
      { key: "status", label: "Status", sortable: true },
      {
        key: "use_count",
        label: "Uses",
        className: "text-right",
        headerClassName: "text-right",
      },
      {
        key: "error_count",
        label: "Errors",
        className: "text-right",
        headerClassName: "text-right",
      },
      {
        key: "last_used",
        label: "Last Used",
        render: (row) => formatDateTime(String(row.last_used || "")),
      },
    ],
    []
  );

  const scheduleColumns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () => [
      { key: "name", label: "Schedule", sortable: true },
      { key: "cron_expression", label: "Cron" },
      { key: "agent_target", label: "Agent" },
      {
        key: "next_run_at",
        label: "Next Run",
        render: (row) => formatDateTime(String(row.next_run_at || "")),
      },
      {
        key: "status",
        label: "Status",
        render: (row) => String(row.status || "idle"),
      },
    ],
    []
  );

  const eventsColumns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () => [
      { key: "name", label: "Event", sortable: true },
      { key: "event_type", label: "Type" },
      { key: "cron_expression", label: "Cron" },
      {
        key: "run_count",
        label: "Runs",
        className: "text-right",
        headerClassName: "text-right",
      },
      {
        key: "next_run_at",
        label: "Next",
        render: (row) => formatDateTime(String(row.next_run_at || "")),
      },
    ],
    []
  );

  const notificationCounts = (data?.notifications.summary || []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.status] = row.count;
      return acc;
    },
    {}
  );

  const externalActionTotals = (data?.safeguards.externalActions || []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.outcome] = row.count;
      return acc;
    },
    {}
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Settings</h1>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <section className="mb-4 rounded-lg border border-border/80 bg-card p-3">
        <h2 className="mb-2 text-[13px] font-medium">Company</h2>
        {loading || !data ? (
          <p className="text-[13px] text-muted-foreground">Loading company settings...</p>
        ) : (
          <div className="space-y-1 text-[13px]">
            <p>Name: <span className="text-muted-foreground">{data.company.name}</span></p>
            <p>Template: <span className="text-muted-foreground">{data.company.template}</span></p>
            <p>Project Dir: <span className="text-muted-foreground font-mono text-[12px]">{data.company.projectDir}</span></p>
          </div>
        )}
      </section>

      <section className="mb-4 grid gap-3 md:grid-cols-4">
        <StatCard label="Daily Limit" value={loading || !data ? "--" : formatCurrency(data.settings.costLimitDaily)} />
        <StatCard label="Monthly Limit" value={loading || !data ? "--" : formatCurrency(data.settings.costLimitMonthly)} />
        <StatCard label="Pending Safeguards" value={loading || !data ? "--" : String(data.safeguards.pendingCount)} />
        <StatCard
          label="Notifications Pending"
          value={loading || !data ? "--" : String(notificationCounts.pending || 0)}
        />
      </section>

      <section className="mb-4 rounded-lg border border-border/80 bg-card p-3">
        <h2 className="mb-2 text-[13px] font-medium">Scheduler</h2>
        <p className="mb-2 text-[12px] text-muted-foreground">
          Enabled: {String(data?.settings.schedulerEnabled ?? false)} · Daemon status: {data?.scheduler.state.status || "unknown"}
        </p>
        <DataTable
          rows={data?.scheduler.schedules || []}
          columns={scheduleColumns}
          emptyMessage={loading ? "Loading schedules..." : "No enabled schedules"}
          defaultPageSize={10}
          getRowKey={(row, index) => String(row.id || index)}
        />
      </section>

      <section className="mb-4 rounded-lg border border-border/80 bg-card p-3">
        <h2 className="mb-2 text-[13px] font-medium">MCP Integrations</h2>
        <DataTable
          rows={data?.mcpIntegrations || []}
          columns={mcpColumns}
          emptyMessage={loading ? "Loading integrations..." : "No integrations configured"}
          defaultPageSize={10}
          getRowKey={(row, index) =>
            String(row.server_name || row.added_at || row.last_used || `mcp-${index}`)
          }
        />
      </section>

      <section className="mb-4 rounded-lg border border-border/80 bg-card p-3">
        <h2 className="mb-2 text-[13px] font-medium">Notifications</h2>
        <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
          <span>Pending: {notificationCounts.pending || 0}</span>
          <span>Delivered: {notificationCounts.delivered || 0}</span>
          <span>Read: {notificationCounts.read || 0}</span>
          <span>Dismissed: {notificationCounts.dismissed || 0}</span>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Global preference: min push urgency{" "}
          {String(data?.notifications.preference?.["min_push_urgency"] || "-")},
          digest {String(data?.notifications.preference?.["digest_frequency"] || "-")}
        </p>
      </section>

      <section className="mb-4 rounded-lg border border-border/80 bg-card p-3">
        <h2 className="mb-2 text-[13px] font-medium">Safeguards & Trust</h2>
        <div className="flex flex-wrap gap-3 text-[12px] text-muted-foreground">
          <span>Safeguards enabled: {String(data?.settings.safeguardsEnabled ?? false)}</span>
          <span>Trust enabled: {String(data?.settings.trustEnabled ?? false)}</span>
          <span>Approved actions (30d): {externalActionTotals.approved || 0}</span>
          <span>Rejected actions (30d): {externalActionTotals.rejected || 0}</span>
        </div>
      </section>

      <section className="rounded-lg border border-border/80 bg-card p-3">
        <h2 className="mb-2 text-[13px] font-medium">Company Events</h2>
        <DataTable
          rows={data?.companyEvents || []}
          columns={eventsColumns}
          emptyMessage={loading ? "Loading events..." : "No enabled events"}
          defaultPageSize={10}
          getRowKey={(row, index) => String(row.id || index)}
        />
      </section>
    </div>
  );
}
