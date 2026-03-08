"use client";

import { useUIPreferences } from "@/lib/ui-preferences";
import { SimpleDocuments } from "@/components/simple/simple-documents";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  BookOpen,
  FileText,
  BarChart3,
  Megaphone,
  Code,
  PenLine,
  FolderSync,
  Loader2,
} from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { MarkdownView } from "@/components/markdown-view";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Article {
  id: number;
  slug: string;
  title: string;
  section: string;
  content: string;
  version: number;
  created_by: string;
  updated_by: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Archive {
  id: number;
  project_name: string;
  description: string;
  status: string;
  total_cost_usd: number | null;
  completed_at: string | null;
}

interface ArticleDetail {
  article: Article;
  versions: Array<{ id: number; version: number; edited_by: string; created_at: string }>;
}

const OUTPUT_SECTIONS = new Set(["deliverables", "reports", "campaigns", "specs", "drafts"]);

const SECTION_ICONS: Record<string, typeof FileText> = {
  deliverables: FileText,
  reports: BarChart3,
  campaigns: Megaphone,
  specs: Code,
  drafts: PenLine,
};

function ProKnowledgePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [sections, setSections] = useState<Array<{ section: string; count: number }>>([]);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const [sectionFilter, setSectionFilter] = useState("all");
  const [search, setSearch] = useState("");

  const loadArticles = useCallback(async () => {
    const params = new URLSearchParams({ type: "articles", section: sectionFilter });
    if (search.trim()) params.set("search", search.trim());

    const res = await fetch(`/api/knowledge?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to load knowledge");
    }

    const entries = (data.entries || []) as Article[];
    setArticles(entries);
    setSections((data.sections || []) as Array<{ section: string; count: number }>);

    return entries;
  }, [search, sectionFilter]);

  const loadArchives = useCallback(async () => {
    const res = await fetch("/api/knowledge?type=archives", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to load archives");
    }

    setArchives((data.entries || []) as Archive[]);
  }, []);

  const loadArticleDetail = useCallback(async (id: number) => {
    const res = await fetch(`/api/knowledge/${id}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setDetail(null);
      return;
    }

    setDetail(data as ArticleDetail);
  }, []);

  useEffect(() => {
    Promise.all([loadArticles(), loadArchives()])
      .then(([entries]) => {
        if (entries && entries.length > 0) {
          setSelectedId((prev) => prev ?? Number(entries[0].id));
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load knowledge");
      })
      .finally(() => setLoading(false));
  }, [loadArchives, loadArticles]);

  useEffect(() => {
    if (!selectedId) return;
    loadArticleDetail(selectedId);
  }, [loadArticleDetail, selectedId]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanMessage(null);
    try {
      const res = await fetch("/api/knowledge?type=scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setScanMessage(`Scan failed: ${data.error || "Unknown error"}`);
        return;
      }
      setScanMessage(`Imported ${data.imported} file(s), skipped ${data.skipped}.`);
      const entries = await loadArticles();
      if (entries && entries.length > 0 && !selectedId) {
        setSelectedId(Number(entries[0].id));
      }
    } catch (err) {
      setScanMessage(`Scan failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setScanning(false);
    }
  }, [loadArticles, selectedId]);

  const { knowledgeArticles, outputArticles } = useMemo(() => {
    const knowledge = new Map<string, Article[]>();
    const outputs = new Map<string, Article[]>();

    for (const article of articles) {
      if (OUTPUT_SECTIONS.has(article.section)) {
        const existing = outputs.get(article.section) || [];
        existing.push(article);
        outputs.set(article.section, existing);
      } else {
        const existing = knowledge.get(article.section) || [];
        existing.push(article);
        knowledge.set(article.section, existing);
      }
    }

    return {
      knowledgeArticles: knowledge,
      outputArticles: outputs,
    };
  }, [articles]);

  const archiveColumns = useMemo<DataTableColumn<Archive>[]>(
    () => [
      { key: "project_name", label: "Project", sortable: true },
      { key: "status", label: "Status", sortable: true },
      {
        key: "total_cost_usd",
        label: "Cost",
        className: "text-right",
        headerClassName: "text-right",
        render: (row) => formatCurrency(row.total_cost_usd || 0),
      },
      {
        key: "completed_at",
        label: "Completed",
        render: (row) => formatDateTime(row.completed_at),
      },
    ],
    []
  );

  function renderSectionGroup(
    label: string,
    Icon: typeof BookOpen,
    grouped: Map<string, Article[]>
  ) {
    if (grouped.size === 0) return null;

    return (
      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        </div>
        <div className="space-y-3">
          {[...grouped.entries()].map(([section, rows]) => {
            const SectionIcon = SECTION_ICONS[section];
            return (
              <div key={section}>
                <div className="mb-1 flex items-center gap-1">
                  {SectionIcon ? <SectionIcon className="h-3 w-3 text-muted-foreground/70" /> : null}
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{section}</p>
                </div>
                <div className="space-y-1">
                  {rows.map((article) => (
                    <button
                      key={article.id}
                      onClick={() => setSelectedId(article.id)}
                      className={cn(
                        "w-full rounded px-2 py-1.5 text-left text-[12px] transition-colors",
                        selectedId === article.id
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      )}
                    >
                      {article.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Company Library</h1>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mb-3 rounded-lg border border-border/80 bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterBar
            filters={[
              {
                key: "section",
                label: "Section",
                value: sectionFilter,
                options: [
                  { value: "all", label: "All" },
                  ...sections.map((section) => ({
                    value: section.section,
                    label: `${section.section} (${section.count})`,
                  })),
                ],
              },
            ]}
            onChange={(key, value) => {
              if (key === "section") setSectionFilter(value);
            }}
          />

          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search articles"
              className="h-8 w-full rounded border border-border bg-background pl-8 pr-2 text-[12px]"
            />
          </div>

          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex h-8 items-center gap-1.5 rounded border border-border bg-background px-3 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderSync className="h-3.5 w-3.5" />
            )}
            Scan Files
          </button>
        </div>

        {scanMessage ? (
          <p className="mt-2 text-[12px] text-muted-foreground">{scanMessage}</p>
        ) : null}
      </div>

      <div className="grid flex-1 gap-3 lg:grid-cols-[320px_1fr]">
        <div className="rounded-lg border border-border/80 bg-card p-3">
          {loading ? (
            <p className="text-[13px] text-muted-foreground">Loading articles...</p>
          ) : knowledgeArticles.size === 0 && outputArticles.size === 0 ? (
            <p className="text-[13px] text-muted-foreground">No articles found.</p>
          ) : (
            <div className="space-y-5">
              {renderSectionGroup("Company Knowledge", BookOpen, knowledgeArticles)}

              {renderSectionGroup("Outputs", FileText, outputArticles)}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/80 bg-card p-3">
          {!detail ? (
            <p className="text-[13px] text-muted-foreground">Select an article to view details.</p>
          ) : (
            <>
              <div className="mb-3 border-b border-border/70 pb-3">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{detail.article.title}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span>Section: {detail.article.section}</span>
                  <span>Version: {detail.article.version}</span>
                  <span>Updated by: {detail.article.updated_by}</span>
                  <span>{formatDateTime(detail.article.updated_at)}</span>
                </div>
              </div>

              <MarkdownView content={(detail.article.content || "No content").replace(/^#\s+.+\n*/, "")} className="mb-4" />

              <div>
                <h3 className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Version History</h3>
                {detail.versions.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No version history.</p>
                ) : (
                  <div className="space-y-1">
                    {detail.versions.map((version) => (
                      <div key={version.id} className="rounded border border-border/70 px-2 py-1.5 text-[12px]">
                        <span className="font-medium">v{version.version}</span>
                        <span className="mx-1 text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{version.edited_by}</span>
                        <span className="mx-1 text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{formatDateTime(version.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/80 bg-card p-3">
        <h2 className="mb-3 text-[13px] font-medium">Project Archives</h2>
        <DataTable
          rows={archives}
          columns={archiveColumns}
          emptyMessage={loading ? "Loading archives..." : "No project archives"}
          defaultPageSize={10}
          getRowKey={(row) => String(row.id)}
        />
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const { uiMode } = useUIPreferences();

  if (uiMode === "simple") {
    return <SimpleDocuments />;
  }

  return <ProKnowledgePage />;
}
