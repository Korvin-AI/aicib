"use client";

import { useCallback, useEffect, useState } from "react";
import { MarkdownView } from "@/components/markdown-view";
import { formatRoleName } from "@/lib/simple-mode";
import { formatRelativeTimeDetailed } from "@/lib/format";

interface Article {
  id: number;
  slug: string;
  title: string;
  section: string;
  content: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export function SimpleDocuments() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const loadArticles = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge?type=articles&section=all", {
        cache: "no-store",
      });
      const data = await res.json();
      setArticles((data.entries || []) as Article[]);
    } catch {}
  }, []);

  useEffect(() => {
    loadArticles().finally(() => setLoading(false));
  }, [loadArticles]);

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
      setScanMessage(
        `Imported ${data.imported} file(s), skipped ${data.skipped}.`
      );
      await loadArticles();
    } catch (err) {
      setScanMessage(
        `Scan failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setScanning(false);
    }
  }, [loadArticles]);

  // Detail view
  if (selectedArticle) {
    return (
      <div
        style={{
          paddingTop: 32,
          paddingBottom: 32,
          animation: "s-fade-in 0.2s ease-out",
        }}
      >
        <button
          onClick={() => setSelectedArticle(null)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            color: "#3B82F6",
            fontWeight: 500,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back to Documents
        </button>
        <div className="s-card" style={{ padding: 24 }}>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--s-text-primary)",
              margin: "0 0 4px",
            }}
          >
            {selectedArticle.title}
          </h1>
          <p
            style={{
              fontSize: 12,
              color: "var(--s-text-tertiary)",
              marginBottom: 20,
            }}
          >
            {selectedArticle.section} · v{selectedArticle.version} · Updated by{" "}
            {formatRoleName(selectedArticle.updated_by)}
          </p>
          <MarkdownView
            content={(selectedArticle.content || "No content").replace(
              /^#\s+.+\n*/,
              ""
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        paddingTop: 32,
        paddingBottom: 32,
        animation: "s-fade-in 0.3s ease-out",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--s-text-primary)",
            margin: 0,
          }}
        >
          Documents
        </h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            padding: "7px 16px",
            borderRadius: 8,
            border: "1px solid var(--s-border-light)",
            backgroundColor: "var(--s-surface-elevated)",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--s-text-secondary)",
            cursor: scanning ? "not-allowed" : "pointer",
            opacity: scanning ? 0.6 : 1,
          }}
        >
          {scanning ? "Scanning..." : "Scan Files"}
        </button>
      </div>

      {scanMessage && (
        <div
          style={{
            marginBottom: 16,
            padding: "8px 14px",
            borderRadius: 8,
            backgroundColor: "#F0FDF4",
            border: "1px solid #D1FAE5",
            fontSize: 12,
            color: "#059669",
          }}
        >
          {scanMessage}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <p
          style={{
            fontSize: 13,
            color: "var(--s-text-tertiary)",
            textAlign: "center",
            padding: 48,
          }}
        >
          Loading documents...
        </p>
      ) : articles.length === 0 ? (
        <div
          className="s-card"
          style={{
            padding: 48,
            textAlign: "center",
            fontSize: 13,
            color: "var(--s-text-tertiary)",
          }}
        >
          No documents yet. Your AI team will create them as they work.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {articles.map((article) => (
            <div
              key={article.id}
              className="s-card"
              onClick={() => setSelectedArticle(article)}
              style={{
                padding: 16,
                cursor: "pointer",
                transition: "box-shadow 0.15s ease, transform 0.15s ease",
                animation: "s-slide-up 0.3s ease-out",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow =
                  "var(--s-shadow-md)";
                (e.currentTarget as HTMLElement).style.transform =
                  "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow =
                  "var(--s-shadow-sm)";
                (e.currentTarget as HTMLElement).style.transform = "none";
              }}
            >
              {/* File icon */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: "#EFF6FF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
                    stroke="#3B82F6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                    stroke="#3B82F6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--s-text-primary)",
                  margin: "0 0 6px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {article.title}
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--s-text-tertiary)",
                  margin: 0,
                }}
              >
                Created by {formatRoleName(article.created_by)}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--s-text-tertiary)",
                  marginTop: 4,
                }}
              >
                Updated {formatRelativeTimeDetailed(article.updated_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
