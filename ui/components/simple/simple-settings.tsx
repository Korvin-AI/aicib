"use client";

import { useEffect, useMemo, useState } from "react";
import { useUIPreferences } from "@/lib/ui-preferences";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { OrgSettingsPanel } from "@/components/org-settings-panel";

interface SettingsPayload {
  company: {
    name: string;
    template: string;
    projectDir: string;
  };
  engine: {
    mode: "claude-code" | "claude-api";
    hasApiKey: boolean;
    maskedKey?: string;
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
  notifications: {
    summary: Array<{ status: string; count: number }>;
    preference: Record<string, unknown> | null;
  };
  safeguards: {
    pendingCount: number;
    externalActions: Array<{ outcome: string; count: number }>;
  };
}

const BASE_TABS = [
  { id: "profile", label: "Profile" },
  { id: "budget", label: "Budget" },
  { id: "notifications", label: "Notifications" },
  { id: "controls", label: "Controls" },
  { id: "account", label: "Account" },
] as const;

type TabId = (typeof BASE_TABS)[number]["id"] | "team";

export function SimpleSettings() {
  const { uiMode, setUiMode } = useUIPreferences();
  const { isCloudMode } = useAuth();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  const TABS = useMemo(() => {
    const tabs = [...BASE_TABS] as Array<{ id: TabId; label: string }>;
    if (isCloudMode) {
      tabs.splice(tabs.length - 1, 0, { id: "team", label: "Team" });
    }
    return tabs;
  }, [isCloudMode]);
  const [statusData, setStatusData] = useState<{
    costs?: { today?: number; month?: number };
  } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/status", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([settings, status]) => {
        setData(settings as SettingsPayload);
        setStatusData(status);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const notificationCounts = useMemo(() => {
    return (data?.notifications.summary || []).reduce<Record<string, number>>(
      (acc, row) => {
        acc[row.status] = row.count;
        return acc;
      },
      {}
    );
  }, [data]);

  function renderTab() {
    if (loading || !data) {
      return (
        <p style={{ fontSize: 13, color: "var(--s-text-tertiary)", padding: 24 }}>
          Loading settings...
        </p>
      );
    }

    switch (activeTab) {
      case "profile":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <SettingRow label="Company Name" value={data.company.name} />
            <SettingRow label="Template" value={data.company.template} />
            <SettingRow label="Project Directory" value={data.company.projectDir} mono />
          </div>
        );

      case "budget": {
        const dailySpend = statusData?.costs?.today ?? 0;
        const monthlySpend = statusData?.costs?.month ?? 0;
        const dailyLimit = data.settings.costLimitDaily;
        const monthlyLimit = data.settings.costLimitMonthly;
        const dailyPct = dailyLimit > 0 ? (dailySpend / dailyLimit) * 100 : 0;
        const monthlyPct = monthlyLimit > 0 ? (monthlySpend / monthlyLimit) * 100 : 0;

        return (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <BudgetCard
              label="Daily Limit"
              spent={dailySpend}
              limit={dailyLimit}
              percent={dailyPct}
            />
            <BudgetCard
              label="Monthly Limit"
              spent={monthlySpend}
              limit={monthlyLimit}
              percent={monthlyPct}
            />
          </div>
        );
      }

      case "notifications":
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <StatBox label="Pending" value={notificationCounts.pending || 0} />
            <StatBox label="Delivered" value={notificationCounts.delivered || 0} />
            <StatBox label="Read" value={notificationCounts.read || 0} />
          </div>
        );

      case "controls":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <SettingRow
              label="Safeguards"
              value={data.settings.safeguardsEnabled ? "Enabled" : "Disabled"}
            />
            <SettingRow
              label="Trust Mode"
              value={data.settings.trustEnabled ? "Enabled" : "Disabled"}
            />
            <SettingRow
              label="Scheduler"
              value={`${data.settings.schedulerEnabled ? "Enabled" : "Disabled"} · ${data.scheduler.state.status || "unknown"}`}
            />
            <SettingRow
              label="Pending Safeguards"
              value={String(data.safeguards.pendingCount)}
            />
          </div>
        );

      case "team":
        return <OrgSettingsPanel />;

      case "account":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <SettingRow
              label="Engine Mode"
              value={
                data.engine.mode === "claude-api"
                  ? "Anthropic API Key"
                  : "Claude Code Subscription"
              }
            />

            {/* Pro Mode Toggle */}
            <div
              style={{
                padding: 20,
                borderRadius: 10,
                border: "2px solid #3B82F6",
                backgroundColor: "#EFF6FF",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--s-text-primary)",
                    }}
                  >
                    Pro Mode
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--s-text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    Enable the full 10-page dashboard with advanced features
                  </div>
                </div>
                <Switch
                  checked={uiMode === "pro"}
                  onCheckedChange={(checked) =>
                    setUiMode(checked ? "pro" : "simple")
                  }
                />
              </div>
            </div>

            <SettingRow label="Version" value="v0.1.0" />
          </div>
        );
    }
  }

  return (
    <div
      style={{
        paddingTop: 32,
        paddingBottom: 32,
        animation: "s-fade-in 0.3s ease-out",
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: "var(--s-text-primary)",
          margin: "0 0 24px",
        }}
      >
        Settings
      </h1>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--s-border-light)",
          marginBottom: 24,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color:
                activeTab === tab.id
                  ? "#3B82F6"
                  : "var(--s-text-secondary)",
              border: "none",
              borderBottom:
                activeTab === tab.id
                  ? "2px solid #3B82F6"
                  : "2px solid transparent",
              background: "none",
              cursor: "pointer",
              transition: "all 0.15s ease",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="s-card" style={{ padding: 24 }}>
        {renderTab()}
      </div>
    </div>
  );
}

/* ── Helper Components ── */

function SettingRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid var(--s-border-light)",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--s-text-secondary)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--s-text-primary)",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          maxWidth: "60%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function BudgetCard({
  label,
  spent,
  limit,
  percent,
}: {
  label: string;
  spent: number;
  limit: number;
  percent: number;
}) {
  const clampedPct = Math.min(percent, 100);
  const barColor = clampedPct > 80 ? "#EF4444" : clampedPct > 50 ? "#F59E0B" : "#10B981";

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: "1px solid var(--s-border-light)",
        backgroundColor: "var(--s-surface-primary)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--s-text-primary)", marginTop: 4 }}>
        {formatCurrency(spent)}
      </div>
      <div style={{ fontSize: 12, color: "var(--s-text-tertiary)", marginTop: 2 }}>
        of {formatCurrency(limit)}
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: "#E5E7EB",
          marginTop: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${clampedPct}%`,
            backgroundColor: barColor,
            borderRadius: 2,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: "1px solid var(--s-border-light)",
        backgroundColor: "var(--s-surface-primary)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--s-text-primary)" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--s-text-tertiary)", marginTop: 4, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
    </div>
  );
}
