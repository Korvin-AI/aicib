"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBar } from "@/components/filter-bar";
import { Badge } from "@/components/ui/badge";
import { PageGuide } from "@/components/page-guide";
import { formatCurrency, formatDateTime, formatDurationMs } from "@/lib/format";

interface JournalPayload {
  tab: "ceo" | "agents" | "decisions";
  entries: Record<string, unknown>[];
  filters?: {
    agents?: string[];
    types?: string[];
    statuses?: string[];
    departments?: string[];
  };
}

function parseArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export default function JournalPage() {
  const [tab, setTab] = useState<"ceo" | "agents" | "decisions">("ceo");
  const [entries, setEntries] = useState<Record<string, unknown>[]>([]);
  const [filters, setFilters] = useState<JournalPayload["filters"]>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agent, setAgent] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [department, setDepartment] = useState("all");

  const load = useCallback(async () => {
    setError(null);

    const params = new URLSearchParams({ tab });
    if (tab === "agents") {
      params.set("agent", agent);
      params.set("type", type);
    }
    if (tab === "decisions") {
      params.set("status", status);
      params.set("department", department);
    }

    try {
      const res = await fetch(`/api/journal?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as JournalPayload;
      if (!res.ok) {
        setError((data as { error?: string }).error || "Failed to load journal");
        return;
      }
      setEntries(data.entries || []);
      setFilters(data.filters || {});
    } catch {
      setError("Network error while loading journal");
    } finally {
      setLoading(false);
    }
  }, [agent, department, status, tab, type]);

  useEffect(() => {
    load();
  }, [load]);

  const agentFilterItems = useMemo(
    () => [
      {
        key: "agent",
        label: "Agent",
        value: agent,
        options: [
          { value: "all", label: "All" },
          ...(filters?.agents || []).map((item) => ({ value: item, label: item })),
        ],
      },
      {
        key: "type",
        label: "Type",
        value: type,
        options: [
          { value: "all", label: "All" },
          ...(filters?.types || []).map((item) => ({ value: item, label: item })),
        ],
      },
    ],
    [agent, filters?.agents, filters?.types, type]
  );

  const decisionFilterItems = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        value: status,
        options: [
          { value: "all", label: "All" },
          ...(filters?.statuses || []).map((item) => ({ value: item, label: item })),
        ],
      },
      {
        key: "department",
        label: "Department",
        value: department,
        options: [
          { value: "all", label: "All" },
          ...(filters?.departments || []).map((item) => ({ value: item, label: item })),
        ],
      },
    ],
    [department, filters?.departments, filters?.statuses, status]
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Journal</h1>
      <PageGuide
        useFor="historical decisions, lessons learned, and session-level strategic summaries."
        notFor="daily execution monitoring or current project task tracking."
        goTo="Projects for project progress, and Activity for real-time execution timeline."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="ceo">CEO Sessions</TabsTrigger>
          <TabsTrigger value="agents">Agent Journals</TabsTrigger>
          <TabsTrigger value="decisions">Decision Log</TabsTrigger>
        </TabsList>

        <TabsContent value="ceo">
          <div className="space-y-3">
            {loading ? (
              <p className="text-[13px] text-muted-foreground">Loading CEO sessions...</p>
            ) : entries.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No CEO journal entries yet.</p>
            ) : (
              entries.map((entry, index) => (
                <div key={String(entry.id || index)} className="rounded-lg border border-border/80 bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-medium text-foreground">{String(entry.directive || "No directive")}</p>
                    <p className="text-[12px] text-muted-foreground">{formatCurrency(Number(entry.total_cost_usd || 0))}</p>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{String(entry.summary || "No summary")}</p>
                  {entry.deliverables ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">Deliverables: {String(entry.deliverables)}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{formatDateTime(String(entry.created_at || ""))}</span>
                    <span>Turns: {String(entry.num_turns || 0)}</span>
                    <span>Duration: {formatDurationMs(Number(entry.duration_ms || 0))}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="agents">
          <div className="mb-3 rounded-lg border border-border/80 bg-card p-3">
            <FilterBar
              filters={agentFilterItems}
              onChange={(key, value) => {
                if (key === "agent") setAgent(value);
                if (key === "type") setType(value);
              }}
            />
          </div>

          <div className="space-y-3">
            {loading ? (
              <p className="text-[13px] text-muted-foreground">Loading agent journals...</p>
            ) : entries.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No agent journal entries yet.</p>
            ) : (
              entries.map((entry, index) => {
                const tags = parseArray(entry.tags);
                return (
                  <div key={String(entry.id || index)} className="rounded-lg border border-border/80 bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {String(entry.agent_role || "agent")}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {String(entry.entry_type || "entry").replaceAll("_", " ")}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(String(entry.created_at || ""))}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] font-medium text-foreground">{String(entry.title || "Untitled")}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">{String(entry.content || "")}</p>
                    {tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <span
                            key={`${entry.id}-${tag}`}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>

        <TabsContent value="decisions">
          <div className="mb-3 rounded-lg border border-border/80 bg-card p-3">
            <FilterBar
              filters={decisionFilterItems}
              onChange={(key, value) => {
                if (key === "status") setStatus(value);
                if (key === "department") setDepartment(value);
              }}
            />
          </div>

          <div className="space-y-3">
            {loading ? (
              <p className="text-[13px] text-muted-foreground">Loading decision log...</p>
            ) : entries.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No decisions logged yet.</p>
            ) : (
              entries.map((entry, index) => (
                <div key={String(entry.id || index)} className="rounded-lg border border-border/80 bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium text-foreground">{String(entry.title || "Untitled")}</p>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {String(entry.status || "active")}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Decided by {String(entry.decided_by || "-")} {entry.department ? `(${String(entry.department)})` : ""}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">{String(entry.reasoning || "No reasoning provided")}</p>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {formatDateTime(String(entry.created_at || ""))}
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
